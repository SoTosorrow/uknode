import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import SQLite from 'better-sqlite3';
import { openDatabase } from '../src/storage/sqlite.js';
import { createGraphService } from '../src/runtime/server/batches.js';
import { createSessionStore } from '../src/runtime/client/session.js';
import { createApp } from '../src/app/backend/routes.js';
import { videoStorage } from '../src/ext/ai-video/storage.js';
import { registerVideoRoutes, maxImageBytes } from '../src/ext/ai-video/routes.js';
import { videoAttachment, videoData } from '../src/ext/ai-video/model.js';
import { buildConfig, inputsFor } from '../src/ext/ai-video/config.js';
import { createVideoNode, connectVideo, updateVideoNode, moveInput } from '../src/ext/ai-video/actions.js';
import type { Change } from '../src/runtime/protocol.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'uknode-video-')), filename = join(dir, 'graph.sqlite');
  const service = createGraphService(openDatabase(filename, [videoStorage(dir)]));
  const session = createSessionStore(); session.getState().hydrate(service.readGraph());
  t.after(() => { service.close(); rmSync(dir, { recursive: true, force: true }); });
  const create = (kind: 'image' | 'prompt' | 'output') => createVideoNode(session, kind, { x: 1, y: 2 }, null)!;
  const save = () => session.getState().acknowledge(service.applyBatch(session.getState().beginBatch()!));
  const image = (name: string) => {
    const path = `assets/${nanoid(12)}.png`; mkdirSync(join(dir, 'assets'), { recursive: true }); writeFileSync(join(dir, path), png);
    return { kind: 'image' as const, path, name };
  };
  return { dir, filename, service, session, create, save, image };
}

test('video inputs are many-to-one, ordered, reusable, persisted and exported as plain JSON', t => {
  const { service, session, create, save, image } = setup(t);
  const a = create('image'), b = create('image'), p = create('prompt'), q = create('prompt'), output = create('output'), other = create('output');
  const character = image('character.png'), ruins = image('ruins.png');
  updateVideoNode(session, a, character); updateVideoNode(session, b, ruins);
  updateVideoNode(session, p, { kind: 'prompt', text: '图1中的机械战甲在图2的废墟中穿行' });
  updateVideoNode(session, q, { kind: 'prompt', text: '跟随镜头' });
  updateVideoNode(session, output, { kind: 'output', outputFilename: 'mech_run', steps: 15, inputOrder: [] });
  for (const source of [b, a, q, p]) assert.equal(connectVideo(session, source, output), null);
  assert.equal(connectVideo(session, a, other), null);
  assert.equal(connectVideo(session, p, other), null);
  assert.match(connectVideo(session, a, output)!, /已经连接/);
  assert.match(connectVideo(session, output, a)!, /请从/);
  moveInput(session, output, a, -1); moveInput(session, output, p, -1);
  const expected = { prompt: '图1中的机械战甲在图2的废墟中穿行\n跟随镜头', output_filename: 'mech_run', references: [
    { type: 'image', path: character.path }, { type: 'image', path: ruins.path },
  ], steps: 15 };
  assert.deepEqual(buildConfig(session.getState(), output), { config: expected, errors: [] });
  save(); session.getState().hydrate(service.readGraph());
  assert.deepEqual(JSON.parse(JSON.stringify(buildConfig(session.getState(), output).config)), expected);
  assert.equal(buildConfig(session.getState(), other).config?.references.length, 1);
  // Parallel base edges are legal; one source node is consumed once by this business.
  session.getState().edit([{ type: 'edge.put', edge: { id: nanoid(12), source: a, target: output, directed: true } }]);
  assert.equal(inputsFor(session.getState(), output).length, 4);
  assert.deepEqual(buildConfig(session.getState(), output).config, expected);
});

for (const phase of ['unsent', 'in-flight', 'saved'] as const) test(`video node deletion and undo preserve attachments and images (${phase})`, t => {
  const { session, service, create, save, image, dir } = setup(t);
  const id = create('image'), data = image('character.png'); updateVideoNode(session, id, data);
  const receipt = phase === 'unsent' ? null : service.applyBatch(session.getState().beginBatch()!);
  if (phase === 'saved') session.getState().acknowledge(receipt!);
  session.getState().edit([{ type: 'node.delete', id }]);
  if (phase === 'in-flight') session.getState().acknowledge(receipt!);
  save();
  assert.deepEqual(service.readGraph().attachments, []);
  assert(existsSync(join(dir, data.path)));
  session.getState().undo(); save();
  assert.deepEqual(service.readGraph().attachments, [videoAttachment(id, data)]);
  session.getState().redo(); save(); assert.deepEqual(service.readGraph().attachments, []);
});

test('business validation and missing references roll back the entire graph transaction', t => {
  const { session, service, filename } = setup(t), id = nanoid(12);
  const send = (changes: Change[]) => service.applyBatch({ batchId: nanoid(12), expectedRevision: 0, changes });
  const node: Change = { type: 'node.put', node: { id } };
  const bad: Change[] = [
    { type: 'attachment.put', attachment: videoAttachment(id, { kind: 'output', outputFilename: 'x', steps: -1, inputOrder: [] }) },
    { type: 'attachment.put', attachment: videoAttachment(id, { kind: 'image', path: `assets/${nanoid(12)}.png`, name: 'missing.png' }) },
    { type: 'attachment.put', attachment: { namespace: 'unknown', nodeId: id, data: {} } },
    { type: 'attachment.put', attachment: videoAttachment(nanoid(12), { kind: 'prompt', text: 'no node' }) },
  ];
  for (const change of bad) {
    assert.throws(() => send([node, change]));
    assert.equal(service.readGraph().revision, 0); assert.deepEqual(service.readGraph().nodes, []);
  }
  assert.throws(() => session.getState().edit([bad.at(-1)!]), /节点不存在/);
  send([node, { type: 'attachment.put', attachment: videoAttachment(id, { kind: 'prompt', text: 'kept' }) }]);
  service.applyBatch({ batchId: nanoid(12), expectedRevision: 1, changes: [{ type: 'node.delete', id }] });
  assert.deepEqual(service.readGraph().attachments, []);
  const raw = new SQLite(filename, { readonly: true });
  try {
    assert.deepEqual((raw.pragma('table_info(base_nodes)') as Array<{ name: string }>).map(c => c.name), ['id', 'created_at', 'updated_at']);
    assert.deepEqual(raw.pragma('foreign_key_check'), []);
  } finally { raw.close(); }
});

test('prompt edits merge for undo; replacing an image keeps the previous file available', t => {
  const { session, service, create, save, image, dir } = setup(t);
  const p = create('prompt'); save();
  for (const text of ['镜', '镜头', '镜头跟随']) updateVideoNode(session, p, { kind: 'prompt', text }, 'text');
  assert.equal(session.getState().past.length, 2); save();
  session.getState().undo(); save(); assert.deepEqual(videoData(session.getState(), p), { kind: 'prompt', text: '' });
  session.getState().redo(); save();
  assert.deepEqual(service.readGraph().attachments[0].data, { kind: 'prompt', text: '镜头跟随' });
  const a = create('image'), first = image('one.png'), second = image('two.png');
  updateVideoNode(session, a, first); save(); updateVideoNode(session, a, second); save();
  session.getState().undo(); save(); assert.deepEqual(videoData(session.getState(), a), first);
  assert(existsSync(join(dir, first.path))); assert(existsSync(join(dir, second.path)));
});

test('incomplete, unsupported or undirected inputs block JSON rather than silently dropping data', t => {
  const { session, create } = setup(t);
  const image = create('image'), prompt = create('prompt'), output = create('output');
  connectVideo(session, image, output); connectVideo(session, prompt, output);
  let result = buildConfig(session.getState(), output);
  assert.equal(result.config, null); assert(result.errors.some(e => e.includes('尚未上传'))); assert(result.errors.some(e => e.includes('内容为空')));
  const edge = Object.values(session.getState().edges)[0];
  session.getState().edit([{ type: 'edge.put', edge: { ...edge, directed: false } }]);
  result = buildConfig(session.getState(), output); assert(result.errors.some(e => e.includes('方向')));
  updateVideoNode(session, output, { kind: 'output', outputFilename: '../bad', steps: null, inputOrder: [] });
  result = buildConfig(session.getState(), output); assert(result.errors.some(e => e.includes('文件名'))); assert(result.errors.some(e => e.includes('步数')));
});

test('binary image upload persists, serves safe previews, rejects invalid files and enforces the size limit', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'uknode-video-upload-'));
  const service = createGraphService(openDatabase(join(dir, 'graph.sqlite'), [videoStorage(dir)]));
  const app = createApp(service); registerVideoRoutes(app, dir);
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const headers = { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', 'content-type': 'application/octet-stream' };
  const response = await app.inject({ method: 'POST', url: '/api/ext/ai-video/images?name=character.png', headers, payload: png });
  assert.equal(response.statusCode, 201);
  const image = response.json<{ path: string; name: string }>(); assert.equal(image.name, 'character.png');
  const preview = await app.inject({ url: `/api/ext/ai-video/${image.path}`, headers: { host: headers.host } });
  assert.equal(preview.statusCode, 200); assert.deepEqual(preview.rawPayload, png); assert.equal(preview.headers['x-content-type-options'], 'nosniff');
  assert.equal((await app.inject({ method: 'POST', url: '/api/ext/ai-video/images?name=bad.png', headers, payload: '<script>bad</script>' })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/api/ext/ai-video/images?name=large.png', headers, payload: Buffer.alloc(maxImageBytes + 1) })).statusCode, 413);
  assert.equal((await app.inject({ url: '/api/ext/ai-video/assets/other-file.txt', headers: { host: headers.host } })).statusCode, 404);
  const id = nanoid(12);
  const changes = await app.inject({ method: 'POST', url: '/api/changes', headers: { ...headers, 'content-type': 'application/json' }, payload: {
    batchId: nanoid(12), expectedRevision: 0, changes: [{ type: 'node.put', node: { id } }, { type: 'attachment.put', attachment: videoAttachment(id, { kind: 'image', ...image }) }],
  } });
  assert.equal(changes.statusCode, 200); assert.deepEqual(service.readGraph().attachments[0].data, { kind: 'image', ...image });
});
