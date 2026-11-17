import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nanoid } from 'nanoid';
import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { createTestEditor } from './fixtures.js';
import { Autosave } from '../src/runtime/client/autosave.js';
import { openTestGraph } from './fixtures.js';
import { createApp } from '../src/app/backend/routes.js';
import type { GraphData } from '../src/runtime/document.js';

const empty: GraphData = { revision: 0, nodes: [], edges: [], memberships: [], attachments: [], layouts: [] };
const loadedStore = () => { const store = createTestEditor(); store.getState().hydrate(empty); return store; };

test('receipt validation rejects wrong batch or revision without clearing in-flight or newer edits', () => {
  const editor = loadedStore();
  const id = editor.getState().createNode(0, 0);
  const batch = editor.getState().beginBatch()!;
  editor.getState().commitPositions([{ contextNodeId: null, nodeId: id, x: 0, y: 0 }], [{ contextNodeId: null, nodeId: id, x: 5, y: 5 }]);
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
    assert.deepEqual(service.readGraph(), { ...empty, revision: 1 });
  } finally { service.close(); }
  assert.deepEqual(store.getState().nodes, {});
  assert.deepEqual(store.getState().edges, {});
  assert.deepEqual(store.getState().layouts, {});
});

test('ID collisions retry against loaded objects, pending creations and deleted session objects', () => {
  const a = 'nodeExisting', edgeId = 'edgeExisting', b = 'nodeCreated1', c = 'nodeCreated2', newEdge = 'edgeCreated1';
  const candidates = [a, edgeId, b, b, a, c, c, edgeId, b, newEdge];
  const store = createTestEditor(() => {
    const id = candidates.shift();
    assert(id, 'unexpected extra generation attempt');
    return id;
  });
  store.getState().hydrate({ ...empty, nodes: [{ id: a }], edges: [{ id: edgeId, source: a, target: a, directed: false }] });
  assert.equal(store.getState().createNode(10, 20), b);
  assert.equal(store.getState().createNode(30, 40), c);
  store.getState().select([b], []);
  store.getState().deleteSelection();
  store.getState().createEdge(a, c);
  assert.deepEqual(Object.keys(store.getState().edges), [edgeId, newEdge]);
  assert.equal(candidates.length, 0);
  store.getState().undo(); // Remove the new edge.
  store.getState().undo(); // Restore the deleted node under its original ID.
  assert.deepEqual(Object.keys(store.getState().nodes).sort(), [a, b, c].sort());
});

test('acknowledging an in-flight create preserves the newer pending delete', () => {
  const store = loadedStore(), id = store.getState().createNode(1, 2);
  const batch = store.getState().beginBatch()!;
  store.getState().deleteSelection();
  const expected = {
    [`node:${id}`]: { type: 'node.delete', id },
    [`layout:global:${id}`]: { type: 'layout.delete', layout: { contextNodeId: null, nodeId: id } },
  };
  assert.deepEqual(store.getState().pending, expected);
  store.getState().acknowledge({ batchId: batch.batchId, revision: 1 });
  assert(!store.getState().nodes[id]);
  assert.deepEqual(new Set(store.getState().beginBatch()?.changes), new Set(Object.values(expected)));
});

test('drag frames do not queue writes; drag and cascaded deletion undo restore the original objects', () => {
  const store = loadedStore();
  const a = nanoid(12), b = nanoid(12), edge = { id: nanoid(12), source: a, target: b, directed: false };
  const start = { contextNodeId: null, nodeId: a, x: 1, y: 2 }, end = { contextNodeId: null, nodeId: a, x: 60, y: 70 };
  store.getState().hydrate({ revision: 1, nodes: [{ id: a }, { id: b }], edges: [edge], memberships: [], attachments: [], layouts: [start, { contextNodeId: null, nodeId: b, x: 100, y: 100 }] });
  store.getState().previewPositions([{ ...start, x: 30 }]);
  assert.deepEqual(store.getState().pending, {});
  store.getState().commitPositions([start], [end]);
  store.getState().undo();
  assert.deepEqual(store.getState().layouts[`global:${a}`], start);
  store.getState().redo();
  assert.deepEqual(store.getState().layouts[`global:${a}`], end);
  store.getState().select([a], []); store.getState().deleteSelection();
  assert(!store.getState().edges[edge.id]);
  store.getState().undo();
  assert.deepEqual(store.getState().nodes[a], { id: a });
  assert.deepEqual(store.getState().layouts[`global:${a}`], end);
  assert.deepEqual(store.getState().edges[edge.id], edge);
});

function httpFor(app: ReturnType<typeof createApp>, after?: (config: InternalAxiosRequestConfig, response: AxiosResponse) => Promise<void>) {
  return axios.create({ adapter: async config => {
    const response = await app.inject({ method: config.method?.toUpperCase() as 'GET' | 'POST', url: `/api${config.url}`, payload: config.data, headers: { host: 'localhost', 'content-type': 'application/json' } });
    const result: AxiosResponse = { data: response.json(), status: response.statusCode, statusText: response.statusMessage, headers: {}, config };
    if (result.status >= 400) throw new AxiosError('HTTP error', undefined, config, undefined, result);
    await after?.(config, result);
    return result;
  } });
}

test('a lost success response retries the identical batch and then saves newer edits once', async t => {
  const db = openTestGraph(':memory:'), app = createApp(db), store = createTestEditor();
  const bodies: string[] = [];
  let loseResponse = true;
  const http = httpFor(app, async config => {
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
  store.getState().commitPositions([{ contextNodeId: null, nodeId: id, x: 5, y: 6 }], [{ contextNodeId: null, nodeId: id, x: 20, y: 30 }]);
  assert.equal(store.getState().inFlight, frozen);
  await saver.retry();
  assert.equal(db.readGraph().revision, 1);
  assert.equal(bodies[0], bodies[1]);
  assert.equal(Object.keys(store.getState().pending).length, 1);
  await saver.flush();
  assert.equal(db.readGraph().revision, 2);
  assert.deepEqual(db.readGraph().layouts, [{ contextNodeId: null, nodeId: id, x: 20, y: 30 }]);
  assert.deepEqual(store.getState().pending, {});
});

test('edits made while a response is pending remain in the next batch', async t => {
  const db = openTestGraph(':memory:'), app = createApp(db), store = createTestEditor();
  let release!: () => void;
  let entered!: () => void;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const saver = new Autosave(store.session, httpFor(app, async config => { if (config.url === '/changes') { entered(); await gate; } }));
  t.after(async () => { saver.dispose(); await app.close(); });
  await saver.load();
  const id = store.getState().createNode(1, 2);
  const sending = saver.flush();
  await enteredPromise;
  store.getState().commitPositions([{ contextNodeId: null, nodeId: id, x: 1, y: 2 }], [{ contextNodeId: null, nodeId: id, x: 3, y: 4 }]);
  release(); await sending;
  assert.equal(store.getState().layouts[`global:${id}`].x, 3);
  assert.equal(Object.keys(store.getState().pending).length, 1);
  await saver.flush();
  assert.equal(db.readGraph().layouts[0].x, 3);
  assert.equal(db.readGraph().revision, 2);
});

test('revision conflict preserves edits without enabling an unsafe retry', async t => {
  const db = openTestGraph(':memory:'), app = createApp(db);
  const first = createTestEditor(), second = createTestEditor();
  const a = new Autosave(first.session, httpFor(app)), b = new Autosave(second.session, httpFor(app));
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
