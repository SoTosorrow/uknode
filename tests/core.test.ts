import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyGraphChanges, deleteGraphObjects, GraphError } from '../src/core/graph.js';
import { membershipKey, type GraphObjects } from '../src/core/model.js';
import { descendantIds } from '../src/core/traversal.js';
import { createSessionStore } from '../src/runtime/client/session.js';
import { createEditor } from '../src/view/editor-store.js';
import { openTestGraph } from './fixtures.js';

test('the graph core operates without an editor; batch validation and deletion preserve shared members', () => {
  const empty: GraphObjects = { nodes: {}, edges: {}, memberships: {} };
  const a = 'anchorParent', b = 'anchorChild1', c = 'anchorChild2';
  const graph = applyGraphChanges(empty, [
    { type: 'edge.put', edge: { id: 'edgeCycleOne', source: a, target: a, directed: true, label: '' } },
    ...[a, b, c].map(id => ({ type: 'node.put' as const, node: { id } })),
    ...[{ containerId: a, memberId: b }, { containerId: a, memberId: c }, { containerId: b, memberId: c }]
      .map(membership => ({ type: 'membership.put' as const, membership })),
  ]);
  assert.deepEqual(empty, { nodes: {}, edges: {}, memberships: {} });
  assert.deepEqual(descendantIds(Object.values(graph.memberships), a), new Set([b, c]));
  assert.throws(() => applyGraphChanges(graph, [
    { type: 'membership.put', membership: { containerId: c, memberId: a } },
  ]), error => error instanceof GraphError && error.code === 'MEMBERSHIP_CYCLE');
  const reversed = applyGraphChanges(graph, [
    { type: 'membership.put', membership: { containerId: b, memberId: a } },
    { type: 'membership.delete', membership: { containerId: a, memberId: b } },
  ]);
  assert.equal(Object.keys(reversed.memberships).length, 3);
  const deleted = applyGraphChanges(graph, deleteGraphObjects(graph, [a]));
  assert.deepEqual(Object.keys(deleted.nodes).sort(), [b, c].sort());
  assert.deepEqual(deleted.edges, {});
  assert.deepEqual(Object.values(deleted.memberships), [{ containerId: b, memberId: c }]);
  assert(graph.memberships[membershipKey({ containerId: a, memberId: b })]);
  assert.throws(() => applyGraphChanges(graph, [{ type: 'node.delete', id: a },
    { type: 'edge.put', edge: { id: 'missingEdge1', source: a, target: b, directed: false, label: '' } },
  ]), error => error instanceof GraphError && error.code === 'MISSING_ENDPOINT');
});

test('a headless session saves and undoes; editor navigation and drag previews never change session state', t => {
  const service = openTestGraph(':memory:'); t.after(() => service.close());
  const session = createSessionStore();
  session.getState().hydrate(service.readGraph());
  const parent = session.getState().allocateId(), child = session.getState().allocateId();
  session.getState().edit([
    { type: 'node.put', node: { id: parent } }, { type: 'node.put', node: { id: child } },
    { type: 'membership.put', membership: { containerId: parent, memberId: child } },
  ]);
  session.getState().acknowledge(service.applyBatch(session.getState().beginBatch()!));
  assert.equal(service.readGraph().nodes.length, 2);
  const editor = createEditor(session); t.after(editor.dispose);
  const before = session.getState();
  editor.getState().select([parent], []);
  editor.getState().openScope(parent);
  editor.getState().select([child], []);
  editor.getState().previewPositions([{ contextNodeId: parent, nodeId: child, x: 25, y: 50 }]);
  assert.equal(session.getState(), before);
  assert(!('selectedNodes' in before));
  assert(!('contextNodeId' in before));
  editor.getState().undo();
  assert.equal(editor.getState().contextNodeId, null);
  session.getState().acknowledge(service.applyBatch(session.getState().beginBatch()!));
  assert.deepEqual(service.readGraph().nodes, []);
  session.getState().redo();
  session.getState().acknowledge(service.applyBatch(session.getState().beginBatch()!));
  assert.deepEqual(new Set(service.readGraph().nodes.map(n => n.id)), new Set([parent, child]));
  session.getState().hydrate(service.readGraph());
  assert.deepEqual(editor.getState().selectedNodes, []);
  assert.deepEqual(editor.getState().previewLayouts, {});
});
