import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import SQLite from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openTestGraph } from './fixtures.js';
import { WriteError } from '../src/runtime/errors.js';

test('removing edge descriptions preserves identities, directions, timestamps and relationships', t => {
  const dir = mkdtempSync(join(tmpdir(), 'uknode-description-migration-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const folder = join(dir, 'migrations'); mkdirSync(join(folder, 'meta'), { recursive: true });
  const journal = JSON.parse(readFileSync('migrations/meta/_journal.json', 'utf8'));
  journal.entries = journal.entries.slice(0, 2);
  writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries) copyFileSync(`migrations/${entry.tag}.sql`, join(folder, `${entry.tag}.sql`));
  const file = join(dir, 'graph.sqlite'), a = 'anchorNode01', b = 'anchorNode02';
  const old = new SQLite(file); old.pragma('foreign_keys = ON');
  migrate(drizzle(old), { migrationsFolder: folder, migrationsTable: 'base_schema_migrations' });
  for (const id of [a, b]) old.prepare('INSERT INTO base_nodes VALUES (?, 10, 20)').run(id);
  const edges = [
    { id: 'regularEdge1', source: a, target: b, directed: false },
    { id: 'parallelEdge', source: a, target: b, directed: true },
    { id: 'selfLoopEdge', source: b, target: b, directed: true },
  ];
  for (const edge of edges) old.prepare('INSERT INTO base_edges VALUES (?, ?, ?, ?, ?, 30, 40)')
    .run(edge.id, edge.source, edge.target, Number(edge.directed), '旧说明');
  old.prepare('INSERT INTO base_memberships VALUES (?, ?, 50)').run(a, b);
  old.prepare('INSERT INTO view_node_layouts VALUES (NULL, ?, 1, 2)').run(a);
  old.prepare('INSERT INTO view_node_layouts VALUES (?, ?, 3, 4)').run(a, b);
  old.prepare('INSERT INTO base_store_state VALUES (1, 7)').run();
  old.prepare('INSERT INTO base_batch_receipts VALUES (?, ?, 7)').run('oldBatch0001', 'old-format-hash');
  old.close();

  const service = openTestGraph(file);
  try {
    const graph = service.readGraph();
    assert.equal(graph.revision, 8);
    assert.deepEqual(new Set(graph.edges), new Set(edges));
    assert.deepEqual(graph.nodes, [{ id: a }, { id: b }]);
    assert.deepEqual(graph.memberships, [{ containerId: a, memberId: b }]);
    assert.deepEqual(graph.layouts, [{ contextNodeId: null, nodeId: a, x: 1, y: 2 }, { contextNodeId: a, nodeId: b, x: 3, y: 4 }]);
    assert.throws(() => service.applyBatch({ batchId: 'oldBatch0001', expectedRevision: 6, changes: [{ type: 'node.put', node: { id: a } }] }),
      error => error instanceof WriteError && error.code === 'REVISION_CONFLICT');
  } finally { service.close(); }
  const raw = new SQLite(file);
  try {
    assert.deepEqual((raw.pragma('table_info(base_edges)') as Array<{ name: string }>).map(c => c.name),
      ['id', 'source_node_id', 'target_node_id', 'directed', 'created_at', 'updated_at']);
    assert.deepEqual(raw.prepare('SELECT DISTINCT created_at, updated_at FROM base_edges').all(), [{ created_at: 30, updated_at: 40 }]);
    assert.deepEqual(raw.prepare('SELECT * FROM base_batch_receipts').all(), []);
    assert.deepEqual(raw.pragma('foreign_key_check'), []);
    assert.equal(raw.pragma('integrity_check', { simple: true }), 'ok');
  } finally { raw.close(); }
  const reopened = openTestGraph(file);
  try { assert.equal(reopened.readGraph().revision, 8); } finally { reopened.close(); }
});
