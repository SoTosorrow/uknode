import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyGraphChanges, GraphError } from '../src/core/graph.js';
import type { GraphObjects } from '../src/core/model.js';
import { createSessionStore } from '../src/runtime/client/session.js';
import { createEditor } from '../src/view/editor-store.js';
import { openTestGraph, testProject } from './fixtures.js';

for (const phase of ['unsent', 'in-flight', 'saved'] as const) {
  test(`headless node deletion expands once for saving and undo (${phase})`, t => {
    const service = openTestGraph(':memory:'); t.after(() => service.close());
    const session = createSessionStore(); session.getState().hydrate(service.readGraph());
    const parent = 'parentNode01', child = 'childNode001', other = 'otherNode001';
    session.getState().edit([
      ...[parent, child, other].map(id => ({ type: 'node.put' as const, node: { id } })),
      { type: 'edge.put', edge: { id: 'sharedEdge01', source: parent, target: child, directed: true } },
      { type: 'layout.put', layout: { nodeId: parent, x: 1, y: 2 } },
    ]);
    const original = session.getState();
    const receipt = phase === 'unsent' ? null : service.applyBatch(session.getState().beginBatch()!);
    if (phase === 'saved') session.getState().acknowledge(receipt!);
    session.getState().edit([{ type: 'node.delete', id: parent }]);
    if (phase === 'in-flight') session.getState().acknowledge(receipt!);
    const save = () => session.getState().acknowledge(service.applyBatch(session.getState().beginBatch()!));
    save();
    assert.deepEqual(new Set(service.readGraph().nodes.map(n => n.id)), new Set([child, other]));
    assert.deepEqual(service.readGraph().edges, []);
    assert.deepEqual(service.readGraph().layouts, []);
    session.getState().undo(); save();
    for (const key of ['nodes', 'edges', 'layouts'] as const) {
      assert.deepEqual(new Set<unknown>(service.readGraph()[key]), new Set<unknown>(Object.values(original[key])));
    }
    session.getState().redo(); save();
    assert.equal(service.readGraph().nodes.length, 2);
    assert.deepEqual(service.readGraph().edges, []);
  });
}

test('layout edits preserve graph references and do not change canvas selection', t => {
  const session = createSessionStore();
  session.getState().hydrate({ revision: 0, nodes: [{ id: 'anchorNode01' }], edges: [], project: testProject, attachments: [], groups: [], groupNodes: [], layouts: [] });
  const editor = createEditor(session); t.after(editor.dispose);
  const before = session.getState();
  let viewUpdates = 0;
  const unsubscribe = editor.view.subscribe(() => viewUpdates++); t.after(unsubscribe);
  session.getState().edit([{ type: 'layout.put', layout: { nodeId: 'anchorNode01', x: 10, y: 20 } }]);
  for (const key of ['nodes', 'edges'] as const) assert.equal(session.getState()[key], before[key]);
  assert.equal(viewUpdates, 0);
  session.getState().undo(); session.getState().redo();
  assert.equal(viewUpdates, 0);
});

test('deleting a node and explicitly rewiring its edge preserves the new relation and undo', t => {
  const service = openTestGraph(':memory:'); t.after(() => service.close());
  const session = createSessionStore(); session.getState().hydrate(service.readGraph());
  const a = 'anchorNode01', b = 'anchorNode02', c = 'anchorNode03', edge = 'rewireEdge01';
  session.getState().edit([
    ...[a, b, c].map(id => ({ type: 'node.put' as const, node: { id } })),
    { type: 'edge.put', edge: { id: edge, source: a, target: b, directed: false } },
  ]);
  const save = () => session.getState().acknowledge(service.applyBatch(session.getState().beginBatch()!));
  save();
  session.getState().edit([{ type: 'node.delete', id: a }, { type: 'edge.put', edge: { id: edge, source: c, target: b, directed: true } }]); save();
  assert.equal(service.readGraph().edges[0].source, c);
  session.getState().undo(); save();
  assert.equal(service.readGraph().edges[0].source, a);
  assert.equal(service.readGraph().nodes.length, 3);
});

test('the core rejects missing endpoints', () => {
  const empty: GraphObjects = { nodes: {}, edges: {} };
  assert.throws(() => applyGraphChanges(empty, [{ type: 'edge.put', edge: {
    id: 'e', source: 'a', target: 'b', directed: true,
  } }]), error => error instanceof GraphError && error.code === 'MISSING_ENDPOINT');
});

test('a headless session saves and undoes; selection and drag previews never change session state', t => {
  const service = openTestGraph(':memory:'); t.after(() => service.close());
  const session = createSessionStore();
  session.getState().hydrate(service.readGraph());
  const parent = session.getState().allocateId(), child = session.getState().allocateId();
  session.getState().edit([
    { type: 'node.put', node: { id: parent } }, { type: 'node.put', node: { id: child } },
  ]);
  session.getState().acknowledge(service.applyBatch(session.getState().beginBatch()!));
  assert.equal(service.readGraph().nodes.length, 2);
  const editor = createEditor(session); t.after(editor.dispose);
  const before = session.getState();
  editor.getState().select([parent], []);
  editor.getState().select([child], []);
  editor.getState().previewPositions([{ nodeId: child, x: 25, y: 50 }]);
  assert.equal(session.getState(), before);
  assert(!('selectedNodes' in before));
  editor.getState().undo();
  session.getState().acknowledge(service.applyBatch(session.getState().beginBatch()!));
  assert.deepEqual(service.readGraph().nodes, []);
  session.getState().redo();
  session.getState().acknowledge(service.applyBatch(session.getState().beginBatch()!));
  assert.deepEqual(new Set(service.readGraph().nodes.map(n => n.id)), new Set([parent, child]));
  session.getState().hydrate(service.readGraph());
  assert.deepEqual(editor.getState().selectedNodes, []);
  assert.deepEqual(editor.getState().previewLayouts, {});
});
