import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import SQLite from 'better-sqlite3';
import axios from 'axios';
import { WriteError } from '../src/runtime/errors.js';
import { openTestGraph } from './fixtures.js';
import { createSessionStore } from '../src/runtime/client/session.js';
import { createApp } from '../src/app/backend/routes.js';
import { videoStorage } from '../src/ext/ai-video/storage.js';
import { registerVideoRoutes, maxImageBytes } from '../src/ext/ai-video/routes.js';
import { videoAttachment, videoData } from '../src/ext/ai-video/model.js';
import { buildConfig } from '../src/ext/ai-video/config.js';
import { resolveVideoInputs, type ReadImageStatus } from '../src/ext/ai-video/inputs.js';
import type { DocumentObjects } from '../src/runtime/document.js';
import { createVideoNode, connectVideo, updateVideoNode, moveInput } from '../src/ext/ai-video/actions.js';
import type { Change } from '../src/runtime/protocol.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'uknode-video-')), filename = join(dir, 'graph.sqlite');
  const service = openTestGraph(filename, videoStorage(dir));
  const session = createSessionStore(); session.getState().hydrate(service.readGraph());
  t.after(() => { service.close(); rmSync(dir, { recursive: true, force: true }); });
  const create = (kind: 'image' | 'prompt' | 'output') => createVideoNode(session, kind, { x: 1, y: 2 })!;
  const save = () => session.getState().acknowledge(service.applyBatch(session.getState().beginBatch()!));
  const image = (name: string) => {
    const path = `assets/${nanoid(12)}.png`; mkdirSync(join(dir, 'assets'), { recursive: true }); writeFileSync(join(dir, path), png);
    return { kind: 'image' as const, path, name, prompt: '' };
  };
  return { dir, filename, service, session, create, save, image };
}

function readOutput(document: DocumentObjects, outputId: string, imageStatus: ReadImageStatus = () => 'ready') {
  const output = videoData(document, outputId);
  assert(output?.kind === 'output');
  const inputs = resolveVideoInputs(document, outputId, output.inputOrder, imageStatus);
  return { inputs, ...buildConfig(output, inputs) };
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
  assert.deepEqual(readOutput(session.getState(), output).config, expected);
  save(); session.getState().hydrate(service.readGraph());
  assert.deepEqual(JSON.parse(JSON.stringify(readOutput(session.getState(), output).config)), expected);
  assert.equal(readOutput(session.getState(), other).config?.references.length, 1);
  // Parallel base edges are legal; one source node is consumed once by this business.
  session.getState().edit([{ type: 'edge.put', edge: { id: nanoid(12), source: a, target: output, directed: true } }]);
  assert.equal(readOutput(session.getState(), output).inputs.length, 4);
  assert.deepEqual(readOutput(session.getState(), output).config, expected);

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
    { type: 'attachment.put', attachment: videoAttachment(id, { kind: 'image', path: `assets/${nanoid(12)}.png`, name: 'missing.png', prompt: '' }) },
    { type: 'attachment.put', attachment: { namespace: 'unknown', nodeId: id, data: {} } },
    { type: 'attachment.put', attachment: videoAttachment(nanoid(12), { kind: 'prompt', text: 'no node' }) },
  ];
  for (const change of bad) {
    assert.throws(() => send([node, change]));
    assert.equal(service.readGraph().revision, 0); assert.deepEqual(service.readGraph().nodes, []);
  }
  assert.throws(() => session.getState().edit([bad.at(-1)!]), e => e instanceof WriteError && e.code === 'MISSING_NODE');
  updateVideoNode(session, id, { kind: 'prompt', text: 'removed' });
  assert.match(session.getState().editMessage!, /节点已不存在/);
  assert.deepEqual(session.getState().pending, {});
  send([node, { type: 'attachment.put', attachment: { namespace: 'ai-video', nodeId: id, data: { kind: 'prompt', text: 'kept', extra: true } } }]);
  assert.deepEqual(service.readGraph().attachments, [videoAttachment(id, { kind: 'prompt', text: 'kept' })]);
  service.applyBatch({ batchId: nanoid(12), expectedRevision: 1, changes: [{ type: 'node.delete', id }] });
  assert.deepEqual(service.readGraph().attachments, []);
  const raw = new SQLite(filename, { readonly: true });
  try {
    assert.deepEqual((raw.pragma('table_info(base_nodes)') as Array<{ name: string }>).map(c => c.name), ['id', 'project_id', 'created_at', 'updated_at']);
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
  let result = readOutput(session.getState(), output);
  assert.equal(result.config, null); assert(result.errors.some(e => e.includes('尚未上传'))); assert(result.errors.some(e => e.includes('内容为空')));
  const edge = Object.values(session.getState().edges)[0];
  session.getState().edit([{ type: 'edge.put', edge: { ...edge, directed: false } }]);
  result = readOutput(session.getState(), output); assert(result.errors.some(e => e.includes('方向')));
  updateVideoNode(session, output, { kind: 'output', outputFilename: '../bad', steps: null, inputOrder: [] });
  result = readOutput(session.getState(), output); assert(result.errors.some(e => e.includes('文件名'))); assert(result.errors.some(e => e.includes('步数')));
});

test('a connected source losing its attachment stays visible; disconnect and undo derive the current inputs', t => {
  const { session, create } = setup(t);
  const prompt = create('prompt'), other = create('prompt'), output = create('output');
  for (const node of [prompt, other]) {
    updateVideoNode(session, node, { kind: 'prompt', text: node });
    connectVideo(session, node, output);
  }
  const read = () => readOutput(session.getState(), output);
  session.getState().edit([{ type: 'attachment.delete', attachment: { nodeId: prompt, namespace: 'ai-video' } }]);
  assert.equal(read().config, null);
  assert.deepEqual(read().inputs.map(input => input.nodeId), [prompt, other]);
  assert(read().errors.some(error => error.includes(prompt)));
  const edge = Object.values(session.getState().edges).find(edge => edge.source === prompt)!;
  session.getState().edit([{ type: 'edge.delete', id: edge.id }]);
  assert.equal(read().config?.prompt, other);
  session.getState().undo();
  assert.equal(read().config, null);
  session.getState().undo();
  assert.equal(read().config?.prompt, [prompt, other].join('\n'));
  session.getState().edit([{ type: 'node.delete', id: prompt }]);
  assert.deepEqual(read().inputs.map(input => input.nodeId), [other]);
  session.getState().undo();
  assert.equal(read().config?.prompt, [prompt, other].join('\n'));
});

test('only connected images affect export readiness, independently of image ordering and save state', t => {
  const { session, create, image } = setup(t);
  const reference = create('image'), unused = create('image'), prompt = create('prompt'), output = create('output');
  const asset = image('ref.png');
  updateVideoNode(session, reference, asset);
  updateVideoNode(session, prompt, { kind: 'prompt', text: '  run  ' });
  connectVideo(session, reference, output);
  connectVideo(session, prompt, output);
  for (const status of ['loading', 'uploading', 'generating', 'unavailable', 'ready'] as const) {
    const result = readOutput(session.getState(), output, (id, path) => {
      assert.equal(id, reference);
      assert.equal(path, asset.path);
      return status;
    });
    assert.equal(result.inputs[0].nodeId, reference);
    assert.equal(result.config?.prompt, status === 'ready' ? 'run' : undefined);
    assert.equal(result.errors.length, status === 'ready' ? 0 : 1);
    assert(result.errors.every(error => error.includes(reference) && !error.includes(unused)));
  }
});

test('binary image upload persists, serves safe previews, rejects invalid files and enforces the size limit', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'uknode-video-upload-'));
  const service = openTestGraph(join(dir, 'graph.sqlite'), videoStorage(dir));
  const app = createApp(service.service); registerVideoRoutes(app, dir);
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
  const changes = await app.inject({ method: 'POST', url: `/api/projects/${service.project.id}/changes`, headers: { ...headers, 'content-type': 'application/json' }, payload: {
    batchId: nanoid(12), expectedRevision: 0, changes: [{ type: 'node.put', node: { id } }, { type: 'attachment.put', attachment: videoAttachment(id, { kind: 'image', prompt: '', ...image }) }],
  } });
  assert.equal(changes.statusCode, 200); assert.deepEqual(service.readGraph().attachments[0].data, { kind: 'image', prompt: '', ...image });
});

test('image generation and edits share the server client and return normal video assets', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'uknode-image-generation-'));
  const app = createApp(openTestGraph(':memory:').service);
  registerVideoRoutes(app, dir);
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const key = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  t.after(() => { if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key; });
  const upstream = t.mock.method(axios, 'post', async () => ({ data: { data: [{ b64_json: png.toString('base64') }] } }));
  const headers = { host: '127.0.0.1:3000' };
  const generate = (payload: { prompt: string; reference?: string }) =>
    app.inject({ method: 'POST', url: '/api/ext/ai-video/images/generate', headers, payload });
  const response = await generate({ prompt: ' landscape ' });
  assert.equal(response.statusCode, 201);
  const asset = response.json<{ path: string }>();
  const [url, body, options] = upstream.mock.calls[0].arguments;
  assert.equal(url, 'https://api.openai.com/v1/images/generations');
  assert(body && typeof body === 'object' && 'prompt' in body && 'model' in body);
  assert.equal(body.prompt, 'landscape');
  assert.equal(options?.headers?.Authorization, 'Bearer test-key');
  const edit = await generate({ prompt: 'sunset', reference: asset.path });
  assert.equal(edit.statusCode, 201);
  const [editUrl, form] = upstream.mock.calls[1].arguments;
  assert.equal(editUrl, 'https://api.openai.com/v1/images/edits');
  assert(form instanceof FormData);
  assert.equal(form.get('prompt'), 'sunset');
  assert.equal(form.get('model'), body.model);
  const file = form.get('image') as File;
  assert.equal(file.type, 'image/png');
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), png);
  assert.notEqual(asset.path, edit.json().path);
  for (const path of [asset.path, edit.json().path]) {
    const image = await app.inject({ url: '/api/ext/ai-video/' + path, headers });
    assert.deepEqual(image.rawPayload, png);
  }
  for (const payload of [{ prompt: ' ' }, { prompt: 'edit', reference: '../outside.png' },
    { prompt: 'edit', reference: 'assets/missing00001.png' }]) {
    assert.equal((await generate(payload)).statusCode, 400);
  }
  assert.equal(upstream.mock.callCount(), 2);
  delete process.env.OPENAI_API_KEY;
  const missingKey = await generate({ prompt: 'landscape' });
  assert.equal(missingKey.statusCode, 502);
  assert.match(missingKey.json().message, /OPENAI_API_KEY/);
  assert.equal(upstream.mock.callCount(), 2);
});

test('image prompts persist independently of video prompts, including while repairing a missing file', t => {
  const { dir, create, image, service, session, save } = setup(t);
  const id = create('image'), prompt = create('prompt'), output = create('output');
  const data = { ...image('frame.png'), prompt: 'morning sky' };
  updateVideoNode(session, id, data);
  updateVideoNode(session, prompt, { kind: 'prompt', text: 'camera pans' });
  connectVideo(session, id, output); connectVideo(session, prompt, output);
  save(); session.getState().hydrate(service.readGraph());
  assert.deepEqual(videoData(session.getState(), id), data);
  assert.equal(readOutput(session.getState(), output).config?.prompt, 'camera pans');
  rmSync(join(dir, data.path));
  updateVideoNode(session, id, { ...data, prompt: 'sunset' }); save();
  assert.deepEqual(service.readGraph().attachments.find(a => a.nodeId === id)?.data, { ...data, prompt: 'sunset' });
});
