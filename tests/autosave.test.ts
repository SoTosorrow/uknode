import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { createGraphStore } from '../src/frontend/graph-store.js';
import { Autosave } from '../src/frontend/autosave.js';
import { openDatabase } from '../src/backend/database.js';
import { createApp } from '../src/backend/routes.js';
import type { GraphData } from '../src/shared/model.js';

const empty: GraphData = { revision: 0, nodes: [], edges: [], layouts: [] };
const loadedStore = () => { const store = createGraphStore(); store.getState().hydrate(empty); return store; };

test('pending changes coalesce; creating then deleting unsent objects leaves no writes', () => {
  const store = loadedStore();
  const a = store.getState().createNode(0, 0), b = store.getState().createNode(100, 100);
  store.getState().createEdge(a, b);
  const edge = Object.keys(store.getState().edges)[0];
  store.getState().updateEdge(edge, { label: 'first' });
  store.getState().updateEdge(edge, { label: 'final' });
  const changes = Object.values(store.getState().pending);
  assert.equal(changes.filter(c => c.type === 'edge.put').length, 1);
  assert.equal(changes.find(c => c.type === 'edge.put')?.edge.label, 'final');
  store.getState().select([a, b], []); store.getState().deleteSelection();
  assert.deepEqual(store.getState().pending, {});
  assert.deepEqual(store.getState().nodes, {});
  assert.deepEqual(store.getState().edges, {});
  assert.deepEqual(store.getState().layouts, {});
});

test('acknowledging an in-flight create preserves the newer pending delete', () => {
  const store = loadedStore(), id = store.getState().createNode(1, 2);
  const batch = store.getState().beginBatch()!;
  store.getState().deleteSelection();
  assert.deepEqual(store.getState().pending, { [`node:${id}`]: { type: 'node.delete', id } });
  store.getState().acknowledge({ batchId: batch.batchId, revision: 1 });
  assert(!store.getState().nodes[id]);
  assert.deepEqual(store.getState().beginBatch()?.changes, [{ type: 'node.delete', id }]);
});

test('drag frames do not queue writes; drag and cascaded deletion undo restore the original objects', () => {
  const store = loadedStore();
  const a = randomUUID(), b = randomUUID(), edge = { id: randomUUID(), source: a, target: b, label: '', directed: false };
  const start = { nodeId: a, x: 1, y: 2 }, end = { nodeId: a, x: 60, y: 70 };
  store.getState().hydrate({ revision: 1, nodes: [{ id: a }, { id: b }], edges: [edge], layouts: [start, { nodeId: b, x: 100, y: 100 }] });
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
  const db = openDatabase(':memory:'), app = createApp(db), store = createGraphStore();
  const bodies: string[] = [];
  let loseResponse = true;
  const http = httpFor(app, async config => {
    if (config.url !== '/changes') return;
    bodies.push(config.data);
    if (loseResponse) { loseResponse = false; throw new AxiosError('lost response', 'ERR_NETWORK'); }
  });
  const saver = new Autosave(store, http);
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
  const db = openDatabase(':memory:'), app = createApp(db), store = createGraphStore();
  let release!: () => void;
  let entered!: () => void;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const saver = new Autosave(store, httpFor(app, async config => { if (config.url === '/changes') { entered(); await gate; } }));
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
  const db = openDatabase(':memory:'), app = createApp(db);
  const first = createGraphStore(), second = createGraphStore();
  const a = new Autosave(first, httpFor(app)), b = new Autosave(second, httpFor(app));
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
