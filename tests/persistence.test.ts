import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import SQLite from 'better-sqlite3';
import { openDatabase, WriteError } from '../src/backend/database.js';
import { createApp } from '../src/backend/routes.js';
import type { Change, ChangeBatch } from '../src/shared/protocol.js';

function batch(expectedRevision: number, changes: Change[]): ChangeBatch {
  return { batchId: randomUUID(), expectedRevision, changes };
}

test('migrations create the declared core tables; edits and cascades survive reopening', t => {
  const dir = mkdtempSync(join(tmpdir(), 'uknode-db-'));
  const filename = join(dir, 'graph.sqlite');
  let db = openDatabase(filename);
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const raw = new SQLite(filename, { readonly: true });
  try {
    const columns = raw.pragma('table_info(base_nodes)') as Array<{ name: string }>;
    assert.deepEqual(columns.map(c => c.name), ['id', 'created_at', 'updated_at']);
    const names = raw.prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name);
    assert(names.includes('base_schema_migrations'));
    assert(!names.some((name: string) => name.startsWith('cognition_')));
  } finally { raw.close(); }
  const a = randomUUID(), b = randomUUID(), edge = randomUUID(), parallel = randomUUID(), loop = randomUUID();
  db.applyBatch(batch(0, [
    { type: 'node.put', node: { id: a } }, { type: 'node.put', node: { id: b } },
    { type: 'layout.put', layout: { contextNodeId: null, nodeId: a, x: 10, y: 20 } },
    { type: 'layout.put', layout: { contextNodeId: null, nodeId: b, x: 100, y: 200 } },
    ...[edge, parallel].map(id => ({ type: 'edge.put' as const, edge: { id, source: a, target: b, label: '', directed: false } })),
    { type: 'edge.put', edge: { id: loop, source: b, target: b, label: 'self', directed: true } },
  ]));
  const original = db.readGraph();
  db.applyBatch(batch(1, [
    { type: 'layout.put', layout: { contextNodeId: null, nodeId: a, x: 33, y: 44 } },
    { type: 'edge.put', edge: { id: edge, source: a, target: b, label: '关联', directed: true } },
  ]));
  db.close(); db = openDatabase(filename);
  assert.equal(db.readGraph().revision, 2);
  assert.deepEqual(db.readGraph().layouts.find(p => p.nodeId === a), { contextNodeId: null, nodeId: a, x: 33, y: 44 });
  assert.equal(db.readGraph().edges.find(e => e.id === edge)?.label, '关联');
  assert.deepEqual(db.readGraph().nodes, original.nodes);
  db.applyBatch(batch(2, [{ type: 'node.delete', id: a }]));
  assert.deepEqual(db.readGraph().nodes, [{ id: b }]);
  assert.deepEqual(db.readGraph().edges.map(e => e.id), [loop]);
  assert.deepEqual(db.readGraph().layouts, [{ contextNodeId: null, nodeId: b, x: 100, y: 200 }]);
});

test('retries are idempotent even after a later write; mismatched batch reuse is rejected', t => {
  const db = openDatabase(':memory:'); t.after(() => db.close());
  const a = randomUUID();
  const initial = batch(0, [{ type: 'node.put', node: { id: a } }]);
  const receipt = db.applyBatch(initial);
  assert.deepEqual(db.applyBatch(initial), receipt);
  db.applyBatch(batch(1, [{ type: 'layout.put', layout: { contextNodeId: null, nodeId: a, x: 8, y: 9 } }]));
  assert.deepEqual(db.applyBatch(initial), receipt);
  assert.equal(db.readGraph().revision, 2);
  assert.throws(() => db.applyBatch({ ...initial, changes: [{ type: 'node.delete', id: a }] }), (e: unknown) => e instanceof WriteError && e.code === 'BATCH_MISMATCH');
  assert.throws(() => db.applyBatch(batch(0, [{ type: 'node.delete', id: a }])), (e: unknown) => e instanceof WriteError && e.code === 'REVISION_CONFLICT');
});

test('an invalid edge or duplicate change rolls back the entire batch', t => {
  const db = openDatabase(':memory:'); t.after(() => db.close());
  const id = randomUUID();
  const invalid = batch(0, [
    { type: 'node.put', node: { id } },
    { type: 'edge.put', edge: { id: randomUUID(), source: id, target: randomUUID(), label: '', directed: false } },
  ]);
  assert.throws(() => db.applyBatch(invalid), /端点不存在/);
  assert.deepEqual(db.readGraph(), { revision: 0, nodes: [], edges: [], memberships: [], layouts: [] });
  assert.throws(() => db.applyBatch(batch(0, [{ type: 'node.put', node: { id } }, { type: 'node.delete', id }])), /只能出现一次/);
  assert.equal(db.readGraph().revision, 0);
  // Failed transactions must not leave an idempotency receipt behind.
  db.applyBatch({ ...invalid, changes: [{ type: 'node.put', node: { id } }] });
  assert.equal(db.readGraph().revision, 1);
});

test('HTTP validates strict core fields, local origins, and revision conflicts', async t => {
  const db = openDatabase(':memory:');
  const app = createApp(db); t.after(() => app.close());
  const payload = batch(0, [{ type: 'node.put', node: { id: randomUUID() } }]);
  const headers = { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' };
  const send = (body: unknown, requestHeaders = headers) => app.inject({ method: 'POST', url: '/api/changes', headers: { 'content-type': 'application/json', ...requestHeaders }, payload: JSON.stringify(body) });
  assert.equal((await send({ ...payload, changes: [{ type: 'node.put', node: { id: randomUUID(), title: 'not allowed' } }] })).statusCode, 400);
  assert.equal((await send({ ...payload, expectedRevision: '0' })).statusCode, 400);
  assert.equal((await send(payload, { ...headers, origin: 'https://example.com' })).statusCode, 403);
  assert.equal((await send(payload, { ...headers, host: 'example.com' })).statusCode, 403);
  assert.equal((await send(payload)).statusCode, 200);
  const stale = await send(batch(0, [{ type: 'node.put', node: { id: randomUUID() } }]));
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().code, 'REVISION_CONFLICT');
  const read = await app.inject({ url: '/api/graph', headers });
  assert.equal(read.headers['cache-control'], 'no-store');
  assert.equal(read.json().nodes.length, 1);
});
