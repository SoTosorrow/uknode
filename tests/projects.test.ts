import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nanoid } from 'nanoid';
import { openTestGraph } from './fixtures.js';
import { createApp } from '../src/app/backend/routes.js';
import { videoStorage } from '../src/ext/ai-video/storage.js';
import { videoAttachment } from '../src/ext/ai-video/model.js';
import type { Change } from '../src/runtime/protocol.js';

test('projects isolate nodes, layouts, edges, attachments and batch receipts', t => {
  const db = openTestGraph(':memory:', videoStorage('.'));
  t.after(db.close);
  const a = db.project, b = db.service.createProject('第二部', a.business);
  const first = nanoid(12), second = nanoid(12), edgeId = nanoid(12), batchId = nanoid(12);
  for (const [id, nodeId] of [[a.id, first], [b.id, second]]) {
    db.service.applyBatch(id, { expectedRevision: 0, batchId, changes: [
      { type: 'node.put', node: { id: nodeId } },
      { type: 'layout.put', layout: { nodeId, x: 1, y: 2 } },
      { type: 'attachment.put', attachment: videoAttachment(nodeId, { kind: 'prompt', text: id }) },
    ] });
  }
  const edge = { id: edgeId, source: first, target: first, directed: true };
  db.service.applyBatch(a.id, { expectedRevision: 1, batchId: nanoid(12), changes: [{ type: 'edge.put', edge }] });
  const graphA = db.service.readGraph(a.id), graphB = db.service.readGraph(b.id);
  assert.deepEqual(graphA.nodes, [{ id: first }]);
  assert.deepEqual(graphB.nodes, [{ id: second }]);
  assert.equal(graphA.revision, 2); assert.equal(graphB.revision, 1);
  assert.deepEqual(graphA.edges, [edge]); assert.deepEqual(graphB.edges, []);
  assert.deepEqual(graphB.layouts, [{ nodeId: second, x: 1, y: 2 }]);
  assert.deepEqual(graphB.attachments, [videoAttachment(second, { kind: 'prompt', text: b.id })]);
  const foreign: Change[] = [
    { type: 'node.put', node: { id: first } }, { type: 'node.delete', id: first },
    { type: 'layout.put', layout: { nodeId: first, x: 0, y: 0 } }, { type: 'layout.delete', layout: { nodeId: first } },
    { type: 'attachment.put', attachment: videoAttachment(first, { kind: 'prompt', text: 'changed' }) },
    { type: 'attachment.delete', attachment: { namespace: a.business, nodeId: first } },
    { type: 'edge.put', edge: { id: nanoid(12), source: second, target: first, directed: true } },
    { type: 'edge.put', edge: { id: edgeId, source: second, target: second, directed: true } },
    { type: 'edge.delete', id: edgeId },
  ];
  for (const change of foreign) {
    assert.throws(() => db.service.applyBatch(b.id, { expectedRevision: 1, batchId: nanoid(12),
      changes: [{ type: 'node.put', node: { id: nanoid(12) } }, change] }), /本项目/);
  }
  assert.deepEqual(db.service.readGraph(a.id), graphA);
  assert.deepEqual(db.service.readGraph(b.id), graphB);
});

test('project routes create and list projects, reject empty names and report missing projects', async t => {
  const db = openTestGraph(':memory:'), app = createApp(db.service), headers = { host: 'localhost' };
  t.after(() => app.close());
  const create = (name: string) => app.inject({ method: 'POST', url: '/api/projects', headers, payload: { business: 'basic', name } });
  assert.equal((await create('  ')).statusCode, 400);
  const response = await create('  场景  ');
  assert.equal(response.statusCode, 201);
  const project = response.json();
  assert.equal(project.name, '场景');
  const list = await app.inject({ url: '/api/projects', headers });
  assert(list.json().some((item: { id: string }) => item.id === project.id));
  assert.equal((await app.inject({ url: '/api/projects/missing/graph', headers })).statusCode, 404);
});
