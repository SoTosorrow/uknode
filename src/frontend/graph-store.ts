import { createStore } from 'zustand/vanilla';
import { layoutKey, membershipKey, type BaseEdge, type GraphData, type NodeLayout } from '../shared/model.js';
import { descendantIds } from '../shared/memberships.js';
import { changeKey, type Change, type ChangeBatch, type Receipt } from '../shared/protocol.js';
import { invertChanges, recordHistory, type GraphObjects, type HistoryEntry } from './history.js';
import { scopeNodeIds } from './scope.js';

export interface SaveError { message: string; retryable: boolean; phase: 'load' | 'save' }

export interface GraphState extends GraphObjects {
  loaded: boolean;
  loading: boolean;
  revision: number;
  pending: Record<string, Change>;
  inFlight: ChangeBatch | null;
  knownObjects: Set<string>;
  previewLayouts: Record<string, NodeLayout>;
  contextNodeId: string | null;
  navigation: Array<string | null>;
  mainSelection: { nodes: string[]; edges: string[] } | null;
  dueAt: number;
  error: SaveError | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  selectedNodes: string[];
  selectedEdges: string[];
  hydrate: (graph: GraphData) => void;
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
  beginBatch: () => ChangeBatch | null;
  acknowledge: (receipt: Receipt) => void;
}

function applyToGraph(graph: GraphObjects, changes: Change[]): GraphObjects {
  const nodes = { ...graph.nodes }, edges = { ...graph.edges }, layouts = { ...graph.layouts }, memberships = { ...graph.memberships };
  // Match the backend's transaction order, including restoration of shared data.
  for (const change of changes) {
    switch (change.type) {
      case 'edge.delete': delete edges[change.id]; break;
      case 'membership.delete': delete memberships[membershipKey(change.membership)]; break;
      case 'layout.delete': delete layouts[layoutKey(change.layout)]; break;
      case 'node.delete':
        delete nodes[change.id];
        for (const edge of Object.values(edges)) {
          if (edge.source === change.id || edge.target === change.id) delete edges[edge.id];
        }
        for (const membership of Object.values(memberships)) {
          if (membership.containerId === change.id || membership.memberId === change.id) delete memberships[membershipKey(membership)];
        }
        for (const layout of Object.values(layouts)) {
          if (layout.nodeId === change.id || layout.contextNodeId === change.id) delete layouts[layoutKey(layout)];
        }
        break;
    }
  }
  for (const change of changes) {
    switch (change.type) {
      case 'node.put': nodes[change.node.id] = change.node; break;
      case 'edge.put': edges[change.edge.id] = change.edge; break;
      case 'membership.put': memberships[membershipKey(change.membership)] = change.membership; break;
      case 'layout.put': layouts[layoutKey(change.layout)] = change.layout; break;
    }
  }
  return { nodes, edges, layouts, memberships };
}

function enqueue(state: GraphState, changes: Change[]): Record<string, Change> {
  const pending = { ...state.pending };
  for (const change of changes) {
    const key = changeKey(change);
    if (change.type.endsWith('.delete')) {
      const creating = state.inFlight?.changes.some(c => changeKey(c) === key && c.type.endsWith('.put'));
      if (!state.knownObjects.has(key) && !creating) delete pending[key];
      else pending[key] = change;
    } else {
      pending[key] = change;
    }
  }
  return pending;
}

function validNavigation(state: GraphState, graph: GraphObjects) {
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

export function createGraphStore() {
  return createStore<GraphState>((set, get) => {
    function edit(changes: Change[], delay = 0, mergeKey?: string) {
      const state = get();
      if (!state.loaded || state.loading || !changes.length) return;
      const graph = applyToGraph(state, changes);
      set({
        ...graph, ...validNavigation(state, graph), pending: enqueue(state, changes), dueAt: Date.now() + delay,
        past: recordHistory(state.past, { redo: changes, undo: invertChanges(state, changes), mergeKey, time: Date.now() }),
        future: [],
      });
    }
    return {
      nodes: {}, edges: {}, layouts: {}, memberships: {}, loaded: false, loading: true, revision: 0,
      pending: {}, inFlight: null, knownObjects: new Set(), dueAt: 0,
      contextNodeId: null, navigation: [], mainSelection: null, previewLayouts: {},
      error: null, past: [], future: [], selectedNodes: [], selectedEdges: [],
      hydrate(graph) {
        set({
          nodes: Object.fromEntries(graph.nodes.map(n => [n.id, n])),
          edges: Object.fromEntries(graph.edges.map(e => [e.id, e])),
          layouts: Object.fromEntries(graph.layouts.map(p => [layoutKey(p), p])),
          memberships: Object.fromEntries(graph.memberships.map(m => [membershipKey(m), m])),
          revision: graph.revision, loaded: true, loading: false, pending: {}, inFlight: null,
          knownObjects: new Set([
            ...graph.nodes.map(n => `node:${n.id}`), ...graph.edges.map(e => `edge:${e.id}`),
            ...graph.memberships.map(m => `membership:${membershipKey(m)}`), ...graph.layouts.map(p => `layout:${layoutKey(p)}`),
          ]),
          contextNodeId: null, navigation: [], mainSelection: null, previewLayouts: {},
          dueAt: 0, error: null, past: [], future: [], selectedNodes: [], selectedEdges: [],
        });
      },
      createNode(x, y) {
        const id = crypto.randomUUID();
        const { contextNodeId } = get();
        const changes: Change[] = [{ type: 'node.put', node: { id } }, { type: 'layout.put', layout: { contextNodeId, nodeId: id, x, y } }];
        if (contextNodeId !== null) changes.push({ type: 'membership.put', membership: { containerId: contextNodeId, memberId: id } });
        edit(changes);
        get().select([id], []);
        return id;
      },
      createEdge(source, target) {
        if (!get().nodes[source] || !get().nodes[target]) return;
        const id = crypto.randomUUID();
        edit([{ type: 'edge.put', edge: { id, source, target, directed: false, label: '' } }]);
        get().select([], [id]);
      },
      updateEdge(id, update) {
        const edge = get().edges[id];
        if (!edge || Object.entries(update).every(([key, value]) => edge[key as keyof BaseEdge] === value)) return;
        edit([{ type: 'edge.put', edge: { ...edge, ...update } }], 'label' in update ? 500 : 0, 'label' in update ? `edge-label:${id}` : undefined);
      },
      addMembership(containerId, memberId) {
        const state = get();
        if (!state.loaded || state.loading) return '数据尚未读取完成';
        if (!state.nodes[containerId] || !state.nodes[memberId]) return '收录关系对应的节点不存在';
        if (containerId === memberId || descendantIds(Object.values(state.memberships), memberId).has(containerId)) return '收录会形成包含循环';
        const membership = { containerId, memberId };
        if (!state.memberships[membershipKey(membership)]) edit([{ type: 'membership.put', membership }]);
        return null;
      },
      removeMembership(containerId, memberId) {
        const membership = { containerId, memberId };
        if (get().memberships[membershipKey(membership)]) edit([{ type: 'membership.delete', membership }]);
      },
      removeSelectedMemberships() {
        const state = get();
        if (state.contextNodeId === null) return;
        const memberships = state.selectedNodes.map(memberId => ({ containerId: state.contextNodeId!, memberId }))
          .filter(m => state.memberships[membershipKey(m)]);
        edit(memberships.map(membership => ({ type: 'membership.delete', membership })));
      },
      openScope(id) {
        const state = get();
        if (id === null) { state.closeScope(); return; }
        if (!state.loaded || state.loading || id === state.contextNodeId || (id !== null && !state.nodes[id])) return;
        set({
          contextNodeId: id, navigation: [...state.navigation, state.contextNodeId],
          mainSelection: state.contextNodeId === null ? { nodes: [...state.selectedNodes], edges: [...state.selectedEdges] } : state.mainSelection,
          selectedNodes: [], selectedEdges: [], previewLayouts: {},
        });
      },
      closeScope() {
        const state = get();
        if (state.contextNodeId === null) return;
        const selection = state.mainSelection ?? { nodes: [], edges: [] };
        set({
          contextNodeId: null, navigation: [], mainSelection: null, previewLayouts: {},
          selectedNodes: selection.nodes.filter(id => state.nodes[id]),
          selectedEdges: selection.edges.filter(id => state.edges[id]),
        });
      },
      goBack() {
        const state = get();
        if (state.loading || !state.navigation.length) return;
        if (state.navigation.at(-1) === null) { state.closeScope(); return; }
        set({ contextNodeId: state.navigation.at(-1) ?? null, navigation: state.navigation.slice(0, -1), selectedNodes: [], selectedEdges: [], previewLayouts: {} });
      },
      select(nodes, edges) {
        const state = get();
        if (nodes.join() !== state.selectedNodes.join() || edges.join() !== state.selectedEdges.join()) {
          set({ selectedNodes: nodes, selectedEdges: edges });
        }
      },
      deleteSelection() {
        const state = get();
        const nodeIds = new Set(state.selectedNodes);
        const edgeIds = new Set(state.selectedEdges);
        for (const edge of Object.values(state.edges)) {
          if (nodeIds.has(edge.source) || nodeIds.has(edge.target)) edgeIds.add(edge.id);
        }
        edit([
          ...[...edgeIds].filter(id => state.edges[id]).map(id => ({ type: 'edge.delete' as const, id })),
          ...Object.values(state.memberships).filter(m => nodeIds.has(m.containerId) || nodeIds.has(m.memberId))
            .map(membership => ({ type: 'membership.delete' as const, membership })),
          ...Object.values(state.layouts).filter(p => nodeIds.has(p.nodeId) || (p.contextNodeId !== null && nodeIds.has(p.contextNodeId)))
            .map(({ contextNodeId, nodeId }) => ({ type: 'layout.delete' as const, layout: { contextNodeId, nodeId } })),
          ...[...nodeIds].filter(id => state.nodes[id]).map(id => ({ type: 'node.delete' as const, id })),
        ]);
      },
      previewPositions(updates) {
        const state = get(), previewLayouts = { ...state.previewLayouts };
        for (const layout of updates) if (state.nodes[layout.nodeId] && layout.contextNodeId === state.contextNodeId) previewLayouts[layoutKey(layout)] = layout;
        set({ previewLayouts });
      },
      commitPositions(before, after) {
        const previous = new Map(before.map(layout => [layoutKey(layout), layout]));
        const changed = after.filter(layout => {
          const old = previous.get(layoutKey(layout));
          return layout.contextNodeId === get().contextNodeId && get().nodes[layout.nodeId] && old && (old.x !== layout.x || old.y !== layout.y);
        });
        set({ previewLayouts: {} });
        edit(changed.map(layout => ({ type: 'layout.put', layout })));
      },
      undo() {
        const state = get(), entry = state.past.at(-1);
        if (!entry || state.loading) return;
        const graph = applyToGraph(state, entry.undo);
        set({ ...graph, ...validNavigation({ ...state, selectedNodes: [], selectedEdges: [] }, graph), pending: enqueue(state, entry.undo), dueAt: Date.now(), previewLayouts: {},
          past: state.past.slice(0, -1), future: [...state.future, entry] });
      },
      redo() {
        const state = get(), entry = state.future.at(-1);
        if (!entry || state.loading) return;
        const graph = applyToGraph(state, entry.redo);
        set({ ...graph, ...validNavigation({ ...state, selectedNodes: [], selectedEdges: [] }, graph), pending: enqueue(state, entry.redo), dueAt: Date.now(), previewLayouts: {},
          past: [...state.past, entry], future: state.future.slice(0, -1) });
      },
      beginBatch() {
        const state = get();
        if (!state.loaded || state.error || state.inFlight || !Object.keys(state.pending).length) return null;
        const batch: ChangeBatch = { batchId: crypto.randomUUID(), expectedRevision: state.revision, changes: Object.values(state.pending) };
        set({ inFlight: batch, pending: {} });
        return batch;
      },
      acknowledge(receipt) {
        const state = get();
        if (state.inFlight?.batchId !== receipt.batchId) return;
        const knownObjects = new Set(state.knownObjects);
        for (const change of state.inFlight.changes) {
          if (change.type.endsWith('.put')) knownObjects.add(changeKey(change));
          else knownObjects.delete(changeKey(change));
        }
        set({ inFlight: null, revision: receipt.revision, knownObjects, error: null });
      },
    };
  });
}

export type GraphStore = ReturnType<typeof createGraphStore>;
