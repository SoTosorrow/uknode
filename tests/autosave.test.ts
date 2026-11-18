import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nanoid } from 'nanoid';
import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { createTestEditor } from './fixtures.js';
import { Autosave } from '../src/runtime/client/autosave.js';
import { openTestGraph, testProject } from './fixtures.js';
import { videoStorage } from '../src/ext/ai-video/storage.js';
import { createVideoNode, updateVideoNode } from '../src/ext/ai-video/actions.js';
import { createApp } from '../src/app/backend/routes.js';
import type { GraphData } from '../src/runtime/document.js';

const empty: GraphData = { revision: 0, nodes: [], edges: [], project: testProject, attachments: [], layouts: [] };
const loadedStore = () => { const store = createTestEditor(); store.getState().hydrate(empty); return store; };

test('receipt validation rejects wrong batch or revision without clearing in-flight or newer edits', () => {
  const editor = loadedStore();
  const id = editor.getState().createNode(0, 0);
  const batch = editor.getState().beginBatch()!;
  editor.getState().commitPositions([{ nodeId: id, x: 0, y: 0 }], [{ nodeId: id, x: 5, y: 5 }]);
  const before = editor.session.getState();
  for (const receipt of [{ batchId: nanoid(12), revision: 1 }, { batchId: batch.batchId, revision: 2 }]) {
    assert.throws(() => editor.getState().acknowledge(receipt), /回执不匹配/);
    assert.equal(editor.session.getState(), before);
  }
  editor.getState().acknowledge({ batchId: batch.batchId, revision: 1 });
  assert.equal(editor.getState().inFlight, null);
  assert.equal(Object.keys(editor.getState().pending).length, 1);
});

test('pending changes coalesce; deleting unsent objects retains harmless final deletes', () => {
  const store = loadedStore();
  const a = store.getState().createNode(0, 0), b = store.getState().createNode(100, 100);
  store.getState().createEdge(a, b);
  const edge = Object.keys(store.getState().edges)[0];
  for (const id of [a, b, edge]) assert.match(id, /^[A-Za-z0-9_-]{12}$/);
  assert.equal(new Set([a, b, edge]).size, 3);
  store.getState().updateEdge(edge, { directed: true });
  store.getState().updateEdge(edge, { directed: false });
  const changes = Object.values(store.getState().pending);
  assert.equal(changes.filter(c => c.type === 'edge.put').length, 1);
  assert.equal(changes.find(c => c.type === 'edge.put')?.edge.directed, false);
  store.getState().select([a, b], []); store.getState().deleteSelection();
  const pending = Object.values(store.getState().pending);
  assert.equal(pending.length, 5);
  assert(pending.every(change => change.type.endsWith('.delete')));
  const service = openTestGraph(':memory:');
  try {
    service.applyBatch(store.getState().beginBatch()!);
    assert.deepEqual(service.readGraph(), { ...empty, project: service.project, revision: 1 });
  } finally { service.close(); }
  assert.deepEqual(store.getState().nodes, {});
  assert.deepEqual(store.getState().edges, {});
  assert.deepEqual(store.getState().layouts, {});
});

test('acknowledging an in-flight create preserves the newer pending delete', () => {
  const store = loadedStore(), id = store.getState().createNode(1, 2);
  const batch = store.getState().beginBatch()!;
  store.getState().deleteSelection();
  const expected = {
    [`node:${id}`]: { type: 'node.delete', id },
    [`layout:${id}`]: { type: 'layout.delete', layout: { nodeId: id } },
  };
  assert.deepEqual(store.getState().pending, expected);
  store.getState().acknowledge({ batchId: batch.batchId, revision: 1 });
  assert(!store.getState().nodes[id]);
  assert.deepEqual(new Set(store.getState().beginBatch()?.changes), new Set(Object.values(expected)));
});

test('drag frames do not queue writes; drag and cascaded deletion undo restore the original objects', () => {
  const store = loadedStore();
  const a = nanoid(12), b = nanoid(12), edge = { id: nanoid(12), source: a, target: b, directed: false };
  const start = { nodeId: a, x: 1, y: 2 }, end = { nodeId: a, x: 60, y: 70 };
  store.getState().hydrate({ revision: 1, nodes: [{ id: a }, { id: b }], edges: [edge], project: testProject, attachments: [], layouts: [start, { nodeId: b, x: 100, y: 100 }] });
  store.getState().previewPositions([{ ...start, x: 30 }]);
  assert.deepEqual(store.getState().pending, {});
  store.getState().commitPositions([start], [end]);
  store.getState().undo();
  assert.deepEqual(store.getState().layouts[a], start);
  store.getState().redo();
  assert.deepEqual(store.getState().layouts[a], end);
  store.getState().select([a], []); store.getState().deleteSelection();
  assert(!store.getState().edges[edge.id]);
  store.getState().undo();
  assert.deepEqual(store.getState().nodes[a], { id: a });
  assert.deepEqual(store.getState().layouts[a], end);
  assert.deepEqual(store.getState().edges[edge.id], edge);
});

function httpFor(app: ReturnType<typeof createApp>, projectId: string, after?: (config: InternalAxiosRequestConfig, response: AxiosResponse) => Promise<void>) {
  return axios.create({ adapter: async config => {
    const response = await app.inject({ method: config.method?.toUpperCase() as 'GET' | 'POST', url: `/api/projects/${projectId}${config.url}`, payload: config.data, headers: { host: 'localhost', 'content-type': 'application/json' } });
    const result: AxiosResponse = { data: response.json(), status: response.statusCode, statusText: response.statusMessage, headers: {}, config };
    if (result.status >= 400) throw new AxiosError('HTTP error', undefined, config, undefined, result);
    await after?.(config, result);
    return result;
  } });
}

test('a lost success response retries the identical batch and then saves newer edits once', async t => {
  const db = openTestGraph(':memory:'), app = createApp(db.service), store = createTestEditor();
  const bodies: string[] = [];
  let loseResponse = true;
  const http = httpFor(app, db.project.id, async config => {
    if (config.url !== '/changes') return;
    bodies.push(config.data);
    if (loseResponse) { loseResponse = false; throw new AxiosError('lost response', 'ERR_NETWORK'); }
  });
  const saver = new Autosave(store.session, http);
  t.after(async () => { saver.dispose(); await app.close(); });
  await saver.load();
  const id = store.getState().createNode(5, 6);
  await saver.flush();
  assert.equal(db.readGraph().revision, 1);
  assert.equal(store.getState().error?.retryable, true);
  const frozen = store.getState().inFlight;
  store.getState().commitPositions([{ nodeId: id, x: 5, y: 6 }], [{ nodeId: id, x: 20, y: 30 }]);
  assert.equal(store.getState().inFlight, frozen);
  await saver.retry();
  assert.equal(db.readGraph().revision, 1);
  assert.equal(bodies[0], bodies[1]);
  assert.equal(Object.keys(store.getState().pending).length, 1);
  await saver.flush();
  assert.equal(db.readGraph().revision, 2);
  assert.deepEqual(db.readGraph().layouts, [{ nodeId: id, x: 20, y: 30 }]);
  assert.deepEqual(store.getState().pending, {});
});

test('edits made while a response is pending remain in the next batch', async t => {
  const db = openTestGraph(':memory:'), app = createApp(db.service), store = createTestEditor();
  let release!: () => void;
  let entered!: () => void;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const saver = new Autosave(store.session, httpFor(app, db.project.id, async config => { if (config.url === '/changes') { entered(); await gate; } }));
  t.after(async () => { saver.dispose(); await app.close(); });
  await saver.load();
  const id = store.getState().createNode(1, 2);
  const sending = saver.flush();
  await enteredPromise;
  store.getState().commitPositions([{ nodeId: id, x: 1, y: 2 }], [{ nodeId: id, x: 3, y: 4 }]);
  release(); await sending;
  assert.equal(store.getState().layouts[id].x, 3);
  assert.equal(Object.keys(store.getState().pending).length, 1);
  await saver.flush();
  assert.equal(db.readGraph().layouts[0].x, 3);
  assert.equal(db.readGraph().revision, 2);
});

test('revision conflict preserves edits without enabling an unsafe retry', async t => {
  const db = openTestGraph(':memory:'), app = createApp(db.service);
  const first = createTestEditor(), second = createTestEditor();
  const a = new Autosave(first.session, httpFor(app, db.project.id)), b = new Autosave(second.session, httpFor(app, db.project.id));
  t.after(async () => { a.dispose(); b.dispose(); await app.close(); });
  await a.load(); await b.load();
  first.getState().createNode(0, 0); await a.flush();
  const localId = second.getState().createNode(5, 5); await b.flush();
  assert.equal(second.getState().error?.retryable, false);
  assert(second.getState().inFlight);
  assert(second.getState().nodes[localId]);
  await b.retry();
  assert.equal(db.readGraph().revision, 1);
  assert.equal(db.readGraph().nodes.length, 1);
});

for (const correctDuringRequest of [false, true]) {
  test(`a rejected batch uses corrected values and retains other edits (correction during request: ${correctDuringRequest})`, async t => {
    const db = openTestGraph(':memory:', videoStorage('.'));
    const app = createApp(db.service), editor = createTestEditor();
    const saver = new Autosave(editor.session, httpFor(app, db.project.id));
    t.after(async () => { saver.dispose(); await app.close(); });
    await saver.load();
    const id = createVideoNode(editor.session, 'output', { x: 3, y: 4 })!;
    const setSteps = (steps: number) => updateVideoNode(editor.session, id, {
      kind: 'output', steps, outputFilename: 'scene', inputOrder: [],
    });
    setSteps(1001);
    const sending = saver.flush();
    if (correctDuringRequest) setSteps(15);
    await sending;
    assert.equal(db.readGraph().revision, 0);
    assert.equal(editor.getState().inFlight, null);
    if (!correctDuringRequest) {
      assert.equal(editor.getState().error?.phase, 'validation');
      setSteps(15);
    }
    assert.equal(editor.getState().error, null);
    await saver.flush();
    assert.equal(db.readGraph().attachments[0].data.steps, 15);
    assert.equal(db.readGraph().nodes[0].id, id);
    assert.equal(db.readGraph().layouts[0].x, 3);
    assert.equal(db.readGraph().revision, 1);
  });
}
