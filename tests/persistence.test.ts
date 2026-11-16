import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nanoid } from 'nanoid';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import SQLite from 'better-sqlite3';
import { openTestGraph } from './fixtures.js';
import { WriteError } from '../src/runtime/errors.js';
import { createApp } from '../src/app/backend/routes.js';
import { createTestEditor } from './fixtures.js';
import type { GraphData } from '../src/runtime/document.js';
import type { Change, ChangeBatch } from '../src/runtime/protocol.js';

function batch(expectedRevision: number, changes: Change[]): ChangeBatch {
  return { batchId: nanoid(12), expectedRevision, changes };
}

test('migrations create the declared core tables; edits and cascades survive reopening', t => {
  const dir = mkdtempSync(join(tmpdir(), 'uknode-db-'));
  const filename = join(dir, 'graph.sqlite');
  let db = openTestGraph(filename);
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const raw = new SQLite(filename, { readonly: true });
  try {
    const columns = raw.pragma('table_info(base_nodes)') as Array<{ name: string }>;
    assert.deepEqual(columns.map(c => c.name), ['id', 'created_at', 'updated_at']);
    const names = raw.prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name);
    assert(names.includes('base_schema_migrations'));
    assert(!names.some((name: string) => name.startsWith('cognition_')));
  } finally { raw.close(); }
  const a = nanoid(12), b = nanoid(12), edge = nanoid(12), parallel = nanoid(12), loop = nanoid(12);
  db.applyBatch(batch(0, [
    { type: 'node.put', node: { id: a } }, { type: 'node.put', node: { id: b } },
    { type: 'layout.put', layout: { contextNodeId: null, nodeId: a, x: 10, y: 20 } },
    { type: 'layout.put', layout: { contextNodeId: null, nodeId: b, x: 100, y: 200 } },
    ...[edge, parallel].map(id => ({ type: 'edge.put' as const, edge: { id, source: a, target: b, directed: false } })),
    { type: 'edge.put', edge: { id: loop, source: b, target: b, directed: true } },
  ]));
  const original = db.readGraph();
  db.applyBatch(batch(1, [
    { type: 'layout.put', layout: { contextNodeId: null, nodeId: a, x: 33, y: 44 } },
    { type: 'edge.put', edge: { id: edge, source: a, target: b, directed: true } },
  ]));
  db.close(); db = openTestGraph(filename);
  assert.equal(db.readGraph().revision, 2);
  assert.deepEqual(db.readGraph().layouts.find(p => p.nodeId === a), { contextNodeId: null, nodeId: a, x: 33, y: 44 });
  assert.equal(db.readGraph().edges.find(e => e.id === edge)?.directed, true);
  assert.deepEqual(db.readGraph().nodes, original.nodes);
  db.applyBatch(batch(2, [{ type: 'node.delete', id: a }]));
  assert.deepEqual(db.readGraph().nodes, [{ id: b }]);
  assert.deepEqual(db.readGraph().edges.map(e => e.id), [loop]);
  assert.deepEqual(db.readGraph().layouts, [{ contextNodeId: null, nodeId: b, x: 100, y: 200 }]);
});

test('retries are idempotent even after a later write; mismatched batch reuse is rejected', t => {
  const db = openTestGraph(':memory:'); t.after(() => db.close());
  const a = nanoid(12);
  const initial = batch(0, [{ type: 'node.put', node: { id: a } }]);
  const receipt = db.applyBatch(initial);
  const reordered = { changes: [{ node: { id: a }, type: 'node.put' as const }], expectedRevision: 0, batchId: initial.batchId };
  assert.deepEqual(db.applyBatch(reordered), receipt);
  assert.deepEqual(db.applyBatch(initial), receipt);
  db.applyBatch(batch(1, [{ type: 'layout.put', layout: { contextNodeId: null, nodeId: a, x: 8, y: 9 } }]));
  assert.deepEqual(db.applyBatch(initial), receipt);
  assert.equal(db.readGraph().revision, 2);
  assert.throws(() => db.applyBatch({ ...initial, changes: [{ type: 'node.delete', id: a }] }), (e: unknown) => e instanceof WriteError && e.code === 'BATCH_MISMATCH');
  assert.throws(() => db.applyBatch(batch(0, [{ type: 'node.delete', id: a }])), (e: unknown) => e instanceof WriteError && e.code === 'REVISION_CONFLICT');
});

test('an invalid edge or duplicate change rolls back the entire batch', t => {
  const db = openTestGraph(':memory:'); t.after(() => db.close());
  const id = nanoid(12);
  const invalid = batch(0, [
    { type: 'node.put', node: { id } },
    { type: 'edge.put', edge: { id: nanoid(12), source: id, target: nanoid(12), directed: false } },
  ]);
  assert.throws(() => db.applyBatch(invalid), /节点或范围不存在/);
  assert.deepEqual(db.readGraph(), { revision: 0, nodes: [], edges: [], memberships: [], layouts: [] });
  assert.throws(() => db.applyBatch(batch(0, [{ type: 'node.put', node: { id } }, { type: 'node.delete', id }])), /只能出现一次/);
  assert.equal(db.readGraph().revision, 0);
  // Failed transactions must not leave an idempotency receipt behind.
  db.applyBatch({ ...invalid, changes: [{ type: 'node.put', node: { id } }] });
  assert.equal(db.readGraph().revision, 1);
});

test('HTTP validates strict core fields, local origins, and revision conflicts', async t => {
  const db = openTestGraph(':memory:');
  const app = createApp(db); t.after(() => app.close());
  const payload = batch(0, [{ type: 'node.put', node: { id: nanoid(12) } }]);
  const headers = { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' };
  const send = (body: unknown, requestHeaders = headers) => app.inject({ method: 'POST', url: '/api/changes', headers: { 'content-type': 'application/json', ...requestHeaders }, payload: JSON.stringify(body) });
  assert.equal((await send({ ...payload, changes: [{ type: 'node.put', node: { id: nanoid(12), title: 'not allowed' } }] })).statusCode, 400);
  assert.equal((await send({ ...payload, changes: [{ type: 'edge.put', edge: { id: nanoid(12), source: nanoid(12), target: nanoid(12), directed: false, label: 'removed' } }] })).statusCode, 400);
  assert.equal((await send({ ...payload, expectedRevision: '0' })).statusCode, 400);
  assert.equal((await send(payload, { ...headers, origin: 'https://example.com' })).statusCode, 403);
  assert.equal((await send(payload, { ...headers, host: 'example.com' })).statusCode, 403);
  assert.equal((await send(payload)).statusCode, 200);
  const stale = await send(batch(0, [{ type: 'node.put', node: { id: nanoid(12) } }]));
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().code, 'REVISION_CONFLICT');
  const read = await app.inject({ url: '/api/graph', headers });
  assert.equal(read.headers['cache-control'], 'no-store');
  assert.equal(read.json().nodes.length, 1);
  const missing = await send(batch(1, [{ type: 'layout.put', layout: { contextNodeId: null, nodeId: nanoid(12), x: 0, y: 0 } }]));
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.json().code, 'MISSING_NODE');
  assert.equal(db.readGraph().revision, 1);
});

test('HTTP persists NanoIDs, including memberships, scoped layouts and delete undo', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'uknode-ids-'));
  const filename = join(dir, 'graph.sqlite');
  let app = createApp(openTestGraph(filename));
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const headers = { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' };
  const send = (payload: ChangeBatch) => app.inject({ method: 'POST', url: '/api/changes', headers, payload });
  const read = async () => (await app.inject({ url: '/api/graph', headers })).json<GraphData>();
  const store = createTestEditor();
  const save = async () => {
    const response = await send(store.getState().beginBatch()!);
    assert.equal(response.statusCode, 200, response.body);
    store.getState().acknowledge(response.json());
  };
  const parent = nanoid(12);
  assert.equal((await send(batch(0, [{ type: 'node.put', node: { id: parent } }]))).statusCode, 200);
  store.getState().hydrate(await read());
  store.getState().openScope(parent);
  const member = store.getState().createNode(15, 25);
  store.getState().openScope(member);
  const child = store.getState().createNode(35, 45);
  store.getState().createEdge(parent, member);
  const edge = Object.values(store.getState().edges)[0];
  await save();
  const original = await read();
  assert.deepEqual(new Set(original.memberships), new Set([
    { containerId: parent, memberId: member }, { containerId: member, memberId: child },
  ]));
  assert.deepEqual(new Set(original.layouts), new Set([
    { contextNodeId: parent, nodeId: member, x: 15, y: 25 },
    { contextNodeId: member, nodeId: child, x: 35, y: 45 },
  ]));
  assert.deepEqual(original.edges, [edge]);
  await app.close();
  app = createApp(openTestGraph(filename));
  assert.deepEqual(await read(), original);
  store.getState().select([member], []);
  store.getState().deleteSelection();
  await save();
  const deleted = await read();
  assert.deepEqual(new Set(deleted.nodes.map(n => n.id)), new Set([parent, child]));
  assert.deepEqual([deleted.edges, deleted.memberships, deleted.layouts], [[], [], []]);
  store.getState().undo();
  await save();
  const restored = await read();
  for (const key of ['nodes', 'edges', 'memberships', 'layouts'] as const) {
    assert.deepEqual(new Set<unknown>(restored[key]), new Set<unknown>(original[key]));
  }
  // Reject malformed identities before writing any part of a batch.
  for (const invalid of ['a'.repeat(11), 'a'.repeat(13), 'a'.repeat(12) + '\n', 'abcdefghijk:', 'abcdefghijk/', 'abcdefghijk中', '10000001-0000-4000-8000-000000000001']) {
    const payload = batch(restored.revision, [{ type: 'node.put', node: { id: invalid } }]);
    assert.equal((await send(payload)).statusCode, 400, invalid);
  }
  for (const change of [
    { type: 'edge.put', edge: { ...edge, source: 'invalid' } },
    { type: 'membership.put', membership: { containerId: member, memberId: 'invalid' } },
    { type: 'layout.put', layout: { contextNodeId: 'invalid', nodeId: member, x: 0, y: 0 } },
    { type: 'node.delete', id: 'invalid' },
  ] satisfies Change[]) {
    assert.equal((await send(batch(restored.revision, [change]))).statusCode, 400);
  }
  // Batch IDs use the same format as entity IDs.
  assert.equal((await send({ ...batch(restored.revision, [{ type: 'node.delete', id: child }]), batchId: '10000001-0000-4000-8000-000000000001' })).statusCode, 400);
  assert.deepEqual(await read(), restored);
});
