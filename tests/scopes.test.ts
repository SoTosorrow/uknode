import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import SQLite from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openDatabase, WriteError } from '../src/backend/database.js';
import { createGraphStore } from '../src/frontend/graph-store.js';
import { projectScope } from '../src/frontend/scope.js';
import { directMemberIds, descendantIds } from '../src/shared/memberships.js';
import { layoutKey, membershipKey, type GraphData } from '../src/shared/model.js';
import type { Change, ChangeBatch } from '../src/shared/protocol.js';

const batch = (expectedRevision: number, changes: Change[]): ChangeBatch => ({ batchId: randomUUID(), expectedRevision, changes });
const putMember = (containerId: string, memberId: string): Change => ({ type: 'membership.put', membership: { containerId, memberId } });
const dropMember = (containerId: string, memberId: string): Change => ({ type: 'membership.delete', membership: { containerId, memberId } });
const empty: GraphData = { revision: 0, nodes: [], edges: [], memberships: [], layouts: [] };

test('upgrading the original populated schema preserves global coordinates and enforces scoped uniqueness', t => {
  const dir = mkdtempSync(join(tmpdir(), 'uknode-upgrade-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const firstMigration = join(dir, 'migrations');
  mkdirSync(join(firstMigration, 'meta'), { recursive: true });
  const journal = JSON.parse(readFileSync('migrations/meta/_journal.json', 'utf8'));
  journal.entries = journal.entries.slice(0, 1);
  writeFileSync(join(firstMigration, 'meta/_journal.json'), JSON.stringify(journal));
  writeFileSync(join(firstMigration, '0000_initial.sql'), readFileSync('migrations/0000_initial.sql'));
  const file = join(dir, 'graph.sqlite'), id = randomUUID();
  const old = new SQLite(file);
  migrate(drizzle(old), { migrationsFolder: firstMigration, migrationsTable: 'base_schema_migrations' });
  old.prepare('INSERT INTO base_nodes VALUES (?, ?, ?)').run(id, 10, 20);
  old.prepare('INSERT INTO view_node_layouts VALUES (?, ?, ?)').run(id, -175.25, 48.5);
  old.prepare('INSERT INTO base_store_state VALUES (1, 7)').run();
  old.close();

  const upgraded = openDatabase(file);
  assert.deepEqual(upgraded.readGraph(), { revision: 7, nodes: [{ id }], edges: [], memberships: [], layouts: [{ contextNodeId: null, nodeId: id, x: -175.25, y: 48.5 }] });
  upgraded.applyBatch(batch(7, [{ type: 'layout.put', layout: { contextNodeId: id, nodeId: id, x: 100, y: 200 } }]));
  upgraded.close();
  const check = new SQLite(file);
  try {
    assert.deepEqual(check.pragma('foreign_key_check'), []);
    assert.equal(check.pragma('integrity_check', { simple: true }), 'ok');
    assert.equal(check.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM view_node_layouts').get()!.n, 2);
    assert.throws(() => check.prepare('INSERT INTO view_node_layouts VALUES (NULL, ?, 0, 0)').run(id), /UNIQUE/);
    assert.throws(() => check.prepare('INSERT INTO view_node_layouts VALUES (?, ?, 0, 0)').run(id, id), /UNIQUE/);
  } finally { check.close(); }
  const reopened = openDatabase(file);
  assert.equal(reopened.readGraph().layouts.length, 2);
  reopened.close();
});

test('multiple parents and indirect paths deduplicate; cycles roll back the complete transaction', t => {
  const db = openDatabase(':memory:'); t.after(() => db.close());
  const a = randomUUID(), b = randomUUID(), n = randomUUID(), other = randomUUID();
  db.applyBatch(batch(0, [a, b, n, other].map(id => ({ type: 'node.put', node: { id } }))));
  db.applyBatch(batch(1, [putMember(a, n), putMember(a, b), putMember(b, n)]));
  assert.deepEqual(new Set(directMemberIds(db.readGraph().memberships, a)), new Set([b, n]));
  assert.deepEqual(descendantIds(db.readGraph().memberships, a), new Set([b, n]));
  db.applyBatch(batch(2, [dropMember(a, n)]));
  assert(descendantIds(db.readGraph().memberships, a).has(n));

  const before = db.readGraph();
  const invalid = batch(3, [putMember(n, other), putMember(other, a), { type: 'node.put', node: { id: randomUUID() } }]);
  assert.throws(() => db.applyBatch(invalid), (e: unknown) => e instanceof WriteError && e.code === 'MEMBERSHIP_CYCLE');
  assert.deepEqual(db.readGraph(), before);
  assert.throws(() => db.applyBatch(batch(3, [putMember(n, n)])), /包含循环/);
  assert.throws(() => db.applyBatch(batch(3, [putMember(n, randomUUID())])), /不存在/);
  // Evaluate the final state: reverse a relationship in the same batch.
  const valid = { ...invalid, changes: [putMember(b, a), dropMember(a, b)] };
  const receipt = db.applyBatch(valid);
  assert.deepEqual(db.applyBatch(valid), receipt);
  assert.equal(db.readGraph().memberships.length, 2);
  db.applyBatch(batch(4, [putMember(b, a)]));
  assert.equal(db.readGraph().memberships.length, 2);
});

test('scope projection ignores stale layouts, preserves shared identity and only includes internal ordinary edges', t => {
  const db = openDatabase(':memory:'); t.after(() => db.close());
  const store = createGraphStore(); store.getState().hydrate(empty);
  const a = store.getState().createNode(10, 20), b = store.getState().createNode(300, 20);
  const n = store.getState().createNode(150, 200), outside = store.getState().createNode(700, 500);
  store.getState().addMembership(a, b); store.getState().addMembership(a, n); store.getState().addMembership(b, n);
  store.getState().createEdge(b, n); store.getState().createEdge(outside, n);
  const save = () => { const pending = store.getState().beginBatch(); if (pending) store.getState().acknowledge(db.applyBatch(pending)); };
  save();
  const originalGlobal = db.readGraph().layouts;

  store.getState().openScope(a);
  assert.equal(store.getState().beginBatch(), null);
  const first = projectScope(store.getState(), a);
  assert.deepEqual(new Set(first.nodeIds), new Set([b, n]));
  assert.equal(first.edges.length, 1);
  const moved = { ...first.layouts[n], x: 777, y: 888 };
  store.getState().previewPositions([moved]);
  assert.equal(store.getState().beginBatch(), null);
  store.getState().commitPositions([first.layouts[n]], [moved]); save();
  assert.deepEqual(db.readGraph().layouts.filter(p => p.contextNodeId === null), originalGlobal);
  store.getState().openScope(b);
  assert.notEqual(projectScope(store.getState(), b).layouts[n].x, 777);
  store.getState().undo(); save(); // Undo the first scoped move, even from another scope.
  assert(!db.readGraph().layouts.some(p => p.contextNodeId === a));
  store.getState().redo(); save();
  store.getState().goBack();
  assert.equal(store.getState().contextNodeId, a);
  assert.deepEqual(projectScope(store.getState(), a).layouts[n], moved);

  store.getState().removeMembership(a, n); save();
  assert(!projectScope(store.getState(), a).nodeIds.includes(n));
  assert(descendantIds(Object.values(store.getState().memberships), a).has(n));
  store.getState().removeMembership(a, b); save();
  assert.deepEqual(projectScope(store.getState(), a).nodeIds, []);
  assert(store.getState().layouts[layoutKey(moved)]); // Saved positions do not imply membership.
  store.getState().addMembership(a, n); save();
  assert.deepEqual(projectScope(store.getState(), a).layouts[n], moved);
  assert.equal(db.readGraph().nodes.length, 4);
});

test('dialog navigation preserves the main selection without writing or including the parent node', () => {
  const a = randomUUID(), b = randomUUID(), n = randomUUID();
  const store = createGraphStore();
  store.getState().hydrate({ ...empty, nodes: [a, b, n].map(id => ({ id })), memberships: [
    { containerId: a, memberId: b }, { containerId: b, memberId: n },
  ] });
  store.getState().select([a, n], []);
  store.getState().openScope(a);
  assert.deepEqual(projectScope(store.getState(), a).nodeIds, [b]);
  assert.deepEqual(store.getState().mainSelection?.nodes, [a, n]);
  store.getState().select([b], []);
  store.getState().openScope(b);
  assert.deepEqual(projectScope(store.getState(), b).nodeIds, [n]);
  store.getState().goBack();
  assert.equal(store.getState().contextNodeId, a);
  store.getState().closeScope();
  assert.deepEqual(store.getState().selectedNodes, [a, n]);
  assert.equal(store.getState().mainSelection, null);
  assert.deepEqual(store.getState().navigation, []);
  assert.equal(store.getState().beginBatch(), null);

  // Undoing creation of the open parent must also close the dialog safely.
  const parent = store.getState().createNode(0, 0);
  store.getState().select([b], []);
  store.getState().openScope(parent);
  store.getState().undo();
  assert.equal(store.getState().contextNodeId, null);
  assert.deepEqual(store.getState().selectedNodes, [b]);
});

test('bulk unlink removes only direct memberships and one undo restores them with their saved layouts', t => {
  const db = openDatabase(':memory:'); t.after(() => db.close());
  const a = randomUUID(), b = randomUUID(), n = randomUUID();
  const edge = { id: randomUUID(), source: b, target: n, label: '', directed: true };
  const position = { contextNodeId: a, nodeId: n, x: 340, y: 170 };
  db.applyBatch(batch(0, [
    ...[a, b, n].map(id => ({ type: 'node.put' as const, node: { id } })),
    putMember(a, b), putMember(a, n), putMember(b, n),
    { type: 'edge.put', edge }, { type: 'layout.put', layout: position },
  ]));
  const store = createGraphStore(); store.getState().hydrate(db.readGraph());
  store.getState().select([n], []);
  store.getState().openScope(a);
  store.getState().select([b, n], [edge.id]);
  store.getState().removeSelectedMemberships();
  const removal = store.getState().beginBatch()!;
  assert(removal.changes.every(c => c.type === 'membership.delete'));
  store.getState().acknowledge(db.applyBatch(removal));
  assert.deepEqual(projectScope(store.getState(), a).nodeIds, []);
  assert.equal(db.readGraph().nodes.length, 3);
  assert.deepEqual(db.readGraph().edges, [edge]);
  assert.deepEqual(db.readGraph().memberships, [{ containerId: b, memberId: n }]);
  assert.deepEqual(db.readGraph().layouts, [position]);
  store.getState().undo();
  const undo = store.getState().beginBatch()!; store.getState().acknowledge(db.applyBatch(undo));
  assert.deepEqual(new Set(projectScope(store.getState(), a).nodeIds), new Set([b, n]));
  assert.deepEqual(projectScope(store.getState(), a).layouts[n], position);
  store.getState().closeScope();
  assert.deepEqual(store.getState().selectedNodes, [n]);
});

test('deleting a container preserves children; one undo restores all memberships, edges and range layouts', t => {
  const db = openDatabase(':memory:'); t.after(() => db.close());
  const store = createGraphStore(); store.getState().hydrate(empty);
  const a = store.getState().createNode(0, 0), b = store.getState().createNode(200, 0), n = store.getState().createNode(300, 300);
  store.getState().addMembership(a, n); store.getState().addMembership(b, n);
  assert.match(store.getState().addMembership(n, a)!, /包含循环/);
  store.getState().createEdge(a, n);
  store.getState().openScope(a);
  const layout = projectScope(store.getState(), a).layouts[n];
  store.getState().commitPositions([layout], [{ ...layout, x: 999 }]);
  const save = () => { const pending = store.getState().beginBatch(); if (pending) store.getState().acknowledge(db.applyBatch(pending)); };
  save();
  const original = db.readGraph();
  store.getState().select([a], []); store.getState().deleteSelection(); save();
  assert(store.getState().nodes[n]);
  assert.equal(store.getState().contextNodeId, null);
  assert.deepEqual(db.readGraph().memberships, [{ containerId: b, memberId: n }]);
  assert(!db.readGraph().layouts.some(p => p.contextNodeId === a || p.nodeId === a));
  store.getState().undo(); save();
  const restored = db.readGraph();
  for (const key of ['nodes', 'edges', 'layouts', 'memberships'] as const) {
    assert.deepEqual(new Set(restored[key].map(x => JSON.stringify(x))), new Set(original[key].map(x => JSON.stringify(x))));
  }
  store.getState().redo(); save();
  assert.equal(db.readGraph().nodes.length, 2);
});

test('range creation coalesces atomically and deleting during an in-flight creation is retained for the next batch', t => {
  const db = openDatabase(':memory:'); t.after(() => db.close());
  const store = createGraphStore(); store.getState().hydrate(empty);
  const parent = store.getState().createNode(0, 0);
  const first = store.getState().beginBatch()!; store.getState().acknowledge(db.applyBatch(first));
  store.getState().openScope(parent);
  const unsent = store.getState().createNode(1, 2);
  store.getState().deleteSelection();
  assert.deepEqual(store.getState().pending, {});
  assert(!store.getState().nodes[unsent]);

  const child = store.getState().createNode(3, 4);
  const inFlight = store.getState().beginBatch()!;
  assert.deepEqual(new Set(inFlight.changes.map(c => c.type)), new Set(['node.put', 'layout.put', 'membership.put']));
  store.getState().deleteSelection();
  store.getState().openScope(null);
  store.getState().acknowledge(db.applyBatch(inFlight));
  const deletion = store.getState().beginBatch()!;
  assert.equal(deletion.changes.length, 3);
  store.getState().acknowledge(db.applyBatch(deletion));
  assert.deepEqual(db.readGraph().nodes, [{ id: parent }]);
  assert.deepEqual(db.readGraph().memberships, []);
  store.getState().undo();
  const undo = store.getState().beginBatch()!; store.getState().acknowledge(db.applyBatch(undo));
  assert(store.getState().nodes[child]);
  assert(store.getState().memberships[membershipKey({ containerId: parent, memberId: child })]);
});
