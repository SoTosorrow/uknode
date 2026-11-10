import { createStore } from 'zustand/vanilla';
import type { BaseEdge, GraphData, NodeLayout } from '../shared/model.js';
import { changeKey, type Change, type ChangeBatch, type Receipt } from '../shared/protocol.js';
import { invertChanges, recordHistory, type GraphObjects, type HistoryEntry } from './history.js';

export interface SaveError { message: string; retryable: boolean; phase: 'load' | 'save' }

export interface GraphState extends GraphObjects {
  loaded: boolean;
  loading: boolean;
  revision: number;
  pending: Record<string, Change>;
  inFlight: ChangeBatch | null;
  knownNodes: Set<string>;
  knownEdges: Set<string>;
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
  const nodes = { ...graph.nodes }, edges = { ...graph.edges }, layouts = { ...graph.layouts };
  for (const change of changes) {
    switch (change.type) {
      case 'node.put': nodes[change.node.id] = change.node; break;
      case 'edge.put': edges[change.edge.id] = change.edge; break;
      case 'layout.put': layouts[change.layout.nodeId] = change.layout; break;
      case 'edge.delete': delete edges[change.id]; break;
      case 'node.delete':
        delete nodes[change.id];
        delete layouts[change.id];
        for (const edge of Object.values(edges)) {
          if (edge.source === change.id || edge.target === change.id) delete edges[edge.id];
        }
        break;
    }
  }
  return { nodes, edges, layouts };
}

function enqueue(state: GraphState, changes: Change[]): Record<string, Change> {
  const pending = { ...state.pending };
  for (const change of changes) {
    const key = changeKey(change);
    if (change.type === 'node.delete' || change.type === 'edge.delete') {
      const known = change.type === 'node.delete' ? state.knownNodes : state.knownEdges;
      const creating = state.inFlight?.changes.some(c => changeKey(c) === key && c.type.endsWith('.put'));
      if (!known.has(change.id) && !creating) delete pending[key];
      else pending[key] = change;
      if (change.type === 'node.delete') delete pending[`layout:${change.id}`];
    } else {
      pending[key] = change;
    }
  }
  return pending;
}

export function createGraphStore() {
  return createStore<GraphState>((set, get) => {
    function edit(changes: Change[], delay = 0, mergeKey?: string, inverse?: Change[]) {
      const state = get();
      if (!state.loaded || state.loading || !changes.length) return;
      set({
        ...applyToGraph(state, changes), pending: enqueue(state, changes), dueAt: Date.now() + delay,
        past: recordHistory(state.past, { redo: changes, undo: inverse ?? invertChanges(state, changes), mergeKey, time: Date.now() }),
        future: [],
      });
    }
    return {
      nodes: {}, edges: {}, layouts: {}, loaded: false, loading: true, revision: 0,
      pending: {}, inFlight: null, knownNodes: new Set(), knownEdges: new Set(), dueAt: 0,
      error: null, past: [], future: [], selectedNodes: [], selectedEdges: [],
      hydrate(graph) {
        set({
          nodes: Object.fromEntries(graph.nodes.map(n => [n.id, n])),
          edges: Object.fromEntries(graph.edges.map(e => [e.id, e])),
          layouts: Object.fromEntries(graph.layouts.map(p => [p.nodeId, p])),
          revision: graph.revision, loaded: true, loading: false, pending: {}, inFlight: null,
          knownNodes: new Set(graph.nodes.map(n => n.id)), knownEdges: new Set(graph.edges.map(e => e.id)),
          dueAt: 0, error: null, past: [], future: [], selectedNodes: [], selectedEdges: [],
        });
      },
      createNode(x, y) {
        const id = crypto.randomUUID();
        edit([{ type: 'node.put', node: { id } }, { type: 'layout.put', layout: { nodeId: id, x, y } }]);
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
          ...[...nodeIds].filter(id => state.nodes[id]).map(id => ({ type: 'node.delete' as const, id })),
        ]);
        get().select([], []);
      },
      previewPositions(updates) {
        const layouts = { ...get().layouts };
        for (const layout of updates) if (get().nodes[layout.nodeId]) layouts[layout.nodeId] = layout;
        set({ layouts });
      },
      commitPositions(before, after) {
        const previous = new Map(before.map(layout => [layout.nodeId, layout]));
        const changed = after.filter(layout => {
          const old = previous.get(layout.nodeId);
          return get().nodes[layout.nodeId] && old && (old.x !== layout.x || old.y !== layout.y);
        });
        edit(changed.map(layout => ({ type: 'layout.put', layout })), 0, undefined,
          changed.map(layout => ({ type: 'layout.put', layout: previous.get(layout.nodeId)! })));
      },
      undo() {
        const state = get(), entry = state.past.at(-1);
        if (!entry || state.loading) return;
        set({ ...applyToGraph(state, entry.undo), pending: enqueue(state, entry.undo), dueAt: Date.now(),
          past: state.past.slice(0, -1), future: [...state.future, entry], selectedNodes: [], selectedEdges: [] });
      },
      redo() {
        const state = get(), entry = state.future.at(-1);
        if (!entry || state.loading) return;
        set({ ...applyToGraph(state, entry.redo), pending: enqueue(state, entry.redo), dueAt: Date.now(),
          past: [...state.past, entry], future: state.future.slice(0, -1), selectedNodes: [], selectedEdges: [] });
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
        const knownNodes = new Set(state.knownNodes), knownEdges = new Set(state.knownEdges);
        for (const change of state.inFlight.changes) {
          if (change.type === 'node.put') knownNodes.add(change.node.id);
          if (change.type === 'node.delete') knownNodes.delete(change.id);
          if (change.type === 'edge.put') knownEdges.add(change.edge.id);
          if (change.type === 'edge.delete') knownEdges.delete(change.id);
        }
        set({ inFlight: null, revision: receipt.revision, knownNodes, knownEdges, error: null });
      },
    };
  });
}

export type GraphStore = ReturnType<typeof createGraphStore>;
