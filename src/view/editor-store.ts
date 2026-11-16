import { createStore } from 'zustand/vanilla';
import { membershipKey, type BaseEdge } from '../core/model.js';
import { GraphError } from '../core/graph.js';
import { deleteDocumentObjects, layoutKey, type DocumentObjects, type NodeLayout } from '../runtime/document.js';
import type { Change } from '../runtime/protocol.js';
import type { SessionState, SessionStore } from '../runtime/client/session.js';
import { scopeNodeIds } from './scope.js';

interface ViewState {
  previewLayouts: Record<string, NodeLayout>;
  contextNodeId: string | null;
  navigation: Array<string | null>;
  mainSelection: { nodes: string[]; edges: string[] } | null;
  selectedNodes: string[];
  selectedEdges: string[];
  createNode: (x: number, y: number) => string;
  createEdge: (source: string, target: string) => void;
  updateEdge: (id: string, update: Partial<Pick<BaseEdge, 'label' | 'directed'>>) => void;
  addMembership: (containerId: string, memberId: string) => string | null;
  removeMembership: (containerId: string, memberId: string) => void;
  removeSelectedMemberships: () => void;
  openScope: (id: string | null) => void;
  closeScope: () => void;
  goBack: () => void;
  select: (nodes: string[], edges: string[]) => void;
  deleteSelection: () => void;
  previewPositions: (layouts: NodeLayout[]) => void;
  commitPositions: (before: NodeLayout[], after: NodeLayout[]) => void;
  undo: () => void;
  redo: () => void;
}

export type EditorState = SessionState & ViewState;
const emptyView = () => ({
  contextNodeId: null, navigation: [], mainSelection: null, previewLayouts: {}, selectedNodes: [], selectedEdges: [],
});

function validNavigation(state: ViewState, graph: DocumentObjects) {
  const navigation = state.navigation.filter(id => id === null || graph.nodes[id]);
  let contextNodeId = state.contextNodeId;
  if (contextNodeId !== null && !graph.nodes[contextNodeId]) contextNodeId = navigation.pop() ?? null;
  const visible = new Set(scopeNodeIds(graph, contextNodeId));
  const closing = state.contextNodeId !== null && contextNodeId === null;
  const selection = closing && state.mainSelection ? state.mainSelection : { nodes: state.selectedNodes, edges: state.selectedEdges };
  return {
    contextNodeId, navigation,
    mainSelection: closing ? null : state.mainSelection,
    selectedNodes: selection.nodes.filter(id => visible.has(id)),
    selectedEdges: selection.edges.filter(id => graph.edges[id] && visible.has(graph.edges[id].source) && visible.has(graph.edges[id].target)),
  };
}

export function createEditor(session: SessionStore) {
  const read = (): EditorState => ({ ...session.getState(), ...view.getState() });
  const view = createStore<ViewState>((set) => ({
    ...emptyView(),
    createNode(x, y) {
      const id = session.getState().allocateId();
      const { contextNodeId } = read();
      const changes: Change[] = [{ type: 'node.put', node: { id } }, { type: 'layout.put', layout: { contextNodeId, nodeId: id, x, y } }];
      if (contextNodeId !== null) changes.push({ type: 'membership.put', membership: { containerId: contextNodeId, memberId: id } });
      session.getState().edit(changes);
      read().select([id], []);
      return id;
    },
    createEdge(source, target) {
      if (!read().nodes[source] || !read().nodes[target]) return;
      const id = session.getState().allocateId();
      session.getState().edit([{ type: 'edge.put', edge: { id, source, target, directed: false, label: '' } }]);
      read().select([], [id]);
    },
    updateEdge(id, update) {
      const edge = read().edges[id];
      if (!edge || Object.entries(update).every(([key, value]) => edge[key as keyof BaseEdge] === value)) return;
      session.getState().edit([{ type: 'edge.put', edge: { ...edge, ...update } }], 'label' in update ? 500 : 0, 'label' in update ? `edge-label:${id}` : undefined);
    },
    addMembership(containerId, memberId) {
      const state = read();
      if (!state.loaded || state.loading) return '数据尚未读取完成';
      const membership = { containerId, memberId };
      try {
        if (!state.memberships[membershipKey(membership)]) session.getState().edit([{ type: 'membership.put', membership }]);
      } catch (error) {
        if (error instanceof GraphError) return error.message;
        throw error;
      }
      return null;
    },
    removeMembership(containerId, memberId) {
      const membership = { containerId, memberId };
      if (read().memberships[membershipKey(membership)]) session.getState().edit([{ type: 'membership.delete', membership }]);
    },
    removeSelectedMemberships() {
      const state = read();
      if (state.contextNodeId === null) return;
      const memberships = state.selectedNodes.map(memberId => ({ containerId: state.contextNodeId!, memberId }))
        .filter(m => state.memberships[membershipKey(m)]);
      session.getState().edit(memberships.map(membership => ({ type: 'membership.delete', membership })));
    },
    openScope(id) {
      const state = read();
      if (id === null) { state.closeScope(); return; }
      if (!state.loaded || state.loading || id === state.contextNodeId || (id !== null && !state.nodes[id])) return;
      set({
        contextNodeId: id, navigation: [...state.navigation, state.contextNodeId],
        mainSelection: state.contextNodeId === null ? { nodes: [...state.selectedNodes], edges: [...state.selectedEdges] } : state.mainSelection,
        selectedNodes: [], selectedEdges: [], previewLayouts: {},
      });
    },
    closeScope() {
      const state = read();
      if (state.contextNodeId === null) return;
      const selection = state.mainSelection ?? { nodes: [], edges: [] };
      set({
        contextNodeId: null, navigation: [], mainSelection: null, previewLayouts: {},
        selectedNodes: selection.nodes.filter(id => state.nodes[id]),
        selectedEdges: selection.edges.filter(id => state.edges[id]),
      });
    },
    goBack() {
      const state = read();
      if (state.loading || !state.navigation.length) return;
      if (state.navigation.at(-1) === null) { state.closeScope(); return; }
      set({ contextNodeId: state.navigation.at(-1) ?? null, navigation: state.navigation.slice(0, -1), selectedNodes: [], selectedEdges: [], previewLayouts: {} });
    },
    select(nodes, edges) {
      const state = read();
      if (nodes.join() !== state.selectedNodes.join() || edges.join() !== state.selectedEdges.join()) {
        set({ selectedNodes: nodes, selectedEdges: edges });
      }
    },
    deleteSelection() {
      const state = read();
      session.getState().edit(deleteDocumentObjects(state, state.selectedNodes, state.selectedEdges));
    },
    previewPositions(updates) {
      const state = read(), previewLayouts = { ...state.previewLayouts };
      for (const layout of updates) if (state.nodes[layout.nodeId] && layout.contextNodeId === state.contextNodeId) previewLayouts[layoutKey(layout)] = layout;
      set({ previewLayouts });
    },
    commitPositions(before, after) {
      const previous = new Map(before.map(layout => [layoutKey(layout), layout]));
      const changed = after.filter(layout => {
        const old = previous.get(layoutKey(layout));
        return layout.contextNodeId === read().contextNodeId && read().nodes[layout.nodeId] && old && (old.x !== layout.x || old.y !== layout.y);
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
    else if (state.nodes !== previous.nodes || state.edges !== previous.edges || state.memberships !== previous.memberships) {
      view.setState(validNavigation(view.getState(), state));
    }
  });
  return { session, view, getState: read, dispose: unsubscribe };
}

export type Editor = ReturnType<typeof createEditor>;
