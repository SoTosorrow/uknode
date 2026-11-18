import { createStore } from 'zustand/vanilla';
import type { BaseEdge } from '../core/model.js';
import { type NodeLayout } from '../runtime/document.js';
import type { Change } from '../runtime/protocol.js';
import type { SessionState, SessionStore } from '../runtime/client/session.js';

interface ViewState {
  previewLayouts: Record<string, NodeLayout>;
  selectedNodes: string[];
  selectedEdges: string[];
  createNode: (x: number, y: number) => string;
  createEdge: (source: string, target: string) => void;
  updateEdge: (id: string, update: Pick<BaseEdge, 'directed'>) => void;
  select: (nodes: string[], edges: string[]) => void;
  deleteSelection: () => void;
  previewPositions: (layouts: NodeLayout[]) => void;
  commitPositions: (before: NodeLayout[], after: NodeLayout[]) => void;
  undo: () => void;
  redo: () => void;
}

export type EditorState = SessionState & ViewState;
const emptyView = () => ({
  previewLayouts: {}, selectedNodes: [], selectedEdges: [],
});

export function createEditor(session: SessionStore) {
  const read = (): EditorState => ({ ...session.getState(), ...view.getState() });
  const view = createStore<ViewState>((set) => ({
    ...emptyView(),
    createNode(x, y) {
      const id = session.getState().allocateId();
      const changes: Change[] = [{ type: 'node.put', node: { id } }, { type: 'layout.put', layout: { nodeId: id, x, y } }];
      session.getState().edit(changes);
      read().select([id], []);
      return id;
    },
    createEdge(source, target) {
      if (!read().nodes[source] || !read().nodes[target]) return;
      const id = session.getState().allocateId();
      session.getState().edit([{ type: 'edge.put', edge: { id, source, target, directed: false } }]);
      read().select([], [id]);
    },
    updateEdge(id, update) {
      const edge = read().edges[id];
      if (!edge || edge.directed === update.directed) return;
      session.getState().edit([{ type: 'edge.put', edge: { ...edge, ...update } }]);
    },
    select(nodes, edges) {
      const state = read();
      if (nodes.join() !== state.selectedNodes.join() || edges.join() !== state.selectedEdges.join()) {
        set({ selectedNodes: nodes, selectedEdges: edges });
      }
    },
    deleteSelection() {
      const state = read();
      session.getState().edit([
        ...state.selectedNodes.map(id => ({ type: 'node.delete' as const, id })),
        ...state.selectedEdges.map(id => ({ type: 'edge.delete' as const, id })),
      ]);
    },
    previewPositions(updates) {
      const state = read(), previewLayouts = { ...state.previewLayouts };
      for (const layout of updates) if (state.nodes[layout.nodeId]) previewLayouts[layout.nodeId] = layout;
      set({ previewLayouts });
    },
    commitPositions(before, after) {
      const previous = new Map(before.map(layout => [layout.nodeId, layout]));
      const changed = after.filter(layout => {
        const old = previous.get(layout.nodeId);
        return read().nodes[layout.nodeId] && old && (old.x !== layout.x || old.y !== layout.y);
      });
      set({ previewLayouts: {} });
      session.getState().edit(changed.map(layout => ({ type: 'layout.put', layout })));
    },
    undo() {
      const state = session.getState();
      if (!state.past.length || state.loading) return;
      set({ selectedNodes: [], selectedEdges: [], previewLayouts: {} });
      state.undo();
    },
    redo() {
      const state = session.getState();
      if (!state.future.length || state.loading) return;
      set({ selectedNodes: [], selectedEdges: [], previewLayouts: {} });
      state.redo();
    },
  }));
  const unsubscribe = session.subscribe((state, previous) => {
    if (state.loadVersion !== previous.loadVersion) view.setState(emptyView());
    else if (state.nodes !== previous.nodes || state.edges !== previous.edges) {
      const { selectedNodes, selectedEdges } = view.getState();
      view.getState().select(selectedNodes.filter(id => state.nodes[id]), selectedEdges.filter(id => state.edges[id]));
    }
  });
  return { session, view, getState: read, dispose: unsubscribe };
}

export type Editor = ReturnType<typeof createEditor>;
