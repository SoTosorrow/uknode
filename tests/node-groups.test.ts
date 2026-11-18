import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionStore } from '../src/runtime/client/session.js';
import { openTestGraph } from './fixtures.js';
import { nanoid } from 'nanoid';
import type { Change } from '../src/runtime/protocol.js';
import { createApp } from '../src/app/backend/routes.js';

test('group edits, cascading removals and undo persist independently of graph structure', t => {
  const db = openTestGraph(':memory:');
  t.after(db.close);
  const session = createSessionStore();
  session.getState().hydrate(db.readGraph());
  const { edit, undo, redo } = session.getState();
  const save = () => session.getState().acknowledge(db.applyBatch(session.getState().beginBatch()!));
  const a = nanoid(12), b = nanoid(12), first = nanoid(12), second = nanoid(12);
  const edge = { id: nanoid(12), source: a, target: b, directed: true };
  edit([{ type: 'node.put', node: { id: a } }, { type: 'node.put', node: { id: b } }, { type: 'edge.put', edge }]);
  save();
  const graph = db.readGraph();
  edit([{ type: 'group.put', group: { id: first, name: '素材' } },
    { type: 'groupNode.set', nodeId: a, groupId: first }, { type: 'groupNode.set', nodeId: b, groupId: first }]);
  // The group is saved with its members even while a subsequent move is pending.
  const inFlight = session.getState().beginBatch()!;
  edit([{ type: 'groupNode.set', nodeId: a, groupId: second }, { type: 'group.put', group: { id: second, name: '分镜' } }]);
  session.getState().acknowledge(db.applyBatch(inFlight));
  save();
  const members = () => Object.fromEntries(db.readGraph().groupNodes.map(m => [m.nodeId, m.groupId]));
  assert.deepEqual(members(), { [a]: second, [b]: first });
  edit([{ type: 'group.delete', id: first }]); save();
  assert.deepEqual(members(), { [a]: second });
  assert.deepEqual(db.readGraph().nodes, graph.nodes);
  assert.deepEqual(db.readGraph().edges, [edge]);
  undo(); save();
  edit([{ type: 'node.delete', id: a }]); save();
  assert.deepEqual(members(), { [b]: first });
  undo(); save();
  assert.deepEqual(members(), { [a]: second, [b]: first });
  redo(); save(); undo(); save();
  edit([{ type: 'groupNode.set', nodeId: b, groupId: null }, { type: 'group.put', group: { id: first, name: '空组' } }]);
  save(); session.getState().hydrate(db.readGraph());
  assert.equal(session.getState().groups[first].name, '空组');
  assert.deepEqual(session.getState().groupByNode, { [a]: second });
});

test('HTTP group operations enforce project ownership and roll back invalid batches', async t => {
  const db = openTestGraph(':memory:'), app = createApp(db.service);
  t.after(() => app.close());
  const a = db.project.id, b = db.service.createProject('另一个项目', 'basic').id;
  const nodeA = nanoid(12), nodeB = nanoid(12), group = { id: nanoid(12), name: 'A 组' };
  const post = (projectId: string, changes: Change[]) => app.inject({
    method: 'POST', url: '/api/projects/' + projectId + '/changes', headers: { host: 'localhost' },
    payload: { changes, batchId: nanoid(12), expectedRevision: db.service.readGraph(projectId).revision },
  });
  assert.equal((await post(a, [{ type: 'groupNode.set', nodeId: nodeA, groupId: group.id },
    { type: 'node.put', node: { id: nodeA } }, { type: 'group.put', group }])).statusCode, 200);
  assert.equal((await post(b, [{ type: 'node.put', node: { id: nodeB } }])).statusCode, 200);
  for (const change of [
    { type: 'group.put', group: { ...group, name: 'B 改名' } }, { type: 'group.delete', id: group.id },
    { type: 'groupNode.set', nodeId: nodeB, groupId: group.id }, { type: 'groupNode.set', nodeId: nodeA, groupId: null },
    { type: 'groupNode.set', nodeId: nodeB, groupId: nanoid(12) },
  ] satisfies Change[]) {
    const response = await post(b, [{ type: 'group.put', group: { id: nanoid(12), name: '回滚' } }, change]);
    assert.equal(response.statusCode, 400);
    assert.deepEqual(db.service.readGraph(b).groups, []);
  }
  assert.deepEqual(db.readGraph().groupNodes, [{ nodeId: nodeA, groupId: group.id }]);
  assert.equal((await post(a, [{ type: 'group.delete', id: group.id }])).statusCode, 200);
  assert.deepEqual(db.readGraph().groupNodes, []);
  assert.deepEqual(db.readGraph().nodes, [{ id: nodeA }]);
});
