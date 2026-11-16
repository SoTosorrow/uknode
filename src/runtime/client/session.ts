import { createStore } from 'zustand/vanilla';
import { nanoid } from 'nanoid';
import { membershipKey } from '../../core/model.js';
import { applyDocumentChanges, layoutKey, type DocumentObjects, type GraphData } from '../document.js';
import { changeKey, type Change, type ChangeBatch, type Receipt } from '../protocol.js';
import { invertChanges, type HistoryEntry } from './history.js';

export interface SaveError { message: string; retryable: boolean; phase: 'load' | 'save' }
export interface SessionState extends DocumentObjects {
  loaded: boolean;
  loading: boolean;
  loadVersion: number;
  revision: number;
  pending: Record<string, Change>;
  inFlight: ChangeBatch | null;
  error: SaveError | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  allocateId: () => string;
  hydrate: (graph: GraphData) => void;
  edit: (changes: Change[]) => boolean;
  undo: () => void;
  redo: () => void;
  beginBatch: () => ChangeBatch | null;
  acknowledge: (receipt: Receipt) => void;
}

function enqueue(state: SessionState, changes: Change[]): Record<string, Change> {
  const pending = { ...state.pending };
  for (const change of changes) pending[changeKey(change)] = change;
  return pending;
}

export function createSessionStore(generateId = () => nanoid(12)) {
  return createStore<SessionState>((set, get) => {
    // IDs remain reserved while deleted objects can still be restored by undo.
    const usedIds = new Set<string>();
    return {
      nodes: {}, edges: {}, layouts: {}, memberships: {}, loaded: false, loading: true, loadVersion: 0, revision: 0,
      pending: {}, inFlight: null, error: null, past: [], future: [],
      allocateId() {
        let id = generateId();
        while (usedIds.has(id)) id = generateId();
        usedIds.add(id);
        return id;
      },
      hydrate(graph) {
        usedIds.clear();
        for (const object of [...graph.nodes, ...graph.edges]) usedIds.add(object.id);
        set({
          nodes: Object.fromEntries(graph.nodes.map(n => [n.id, n])),
          edges: Object.fromEntries(graph.edges.map(e => [e.id, e])),
          layouts: Object.fromEntries(graph.layouts.map(p => [layoutKey(p), p])),
          memberships: Object.fromEntries(graph.memberships.map(m => [membershipKey(m), m])),
          revision: graph.revision, loaded: true, loading: false, pending: {}, inFlight: null,
          loadVersion: get().loadVersion + 1,
          error: null, past: [], future: [],
        });
      },
      edit(input) {
        const state = get();
        if (!state.loaded || state.loading || !input.length) return false;
        const { document, changes } = applyDocumentChanges(state, input);
        for (const change of changes) {
          if (change.type === 'node.put') usedIds.add(change.node.id);
          if (change.type === 'edge.put') usedIds.add(change.edge.id);
        }
        set({ ...document, pending: enqueue(state, changes),
          past: [...state.past, { redo: changes, undo: invertChanges(state, changes) }].slice(-100), future: [] });
        return true;
      },
      undo() {
        const state = get(), entry = state.past.at(-1);
        if (!entry || state.loading) return;
        const { document, changes } = applyDocumentChanges(state, entry.undo);
        set({ ...document, pending: enqueue(state, changes),
          past: state.past.slice(0, -1), future: [...state.future, entry] });
      },
      redo() {
        const state = get(), entry = state.future.at(-1);
        if (!entry || state.loading) return;
        const { document, changes } = applyDocumentChanges(state, entry.redo);
        set({ ...document, pending: enqueue(state, changes),
          past: [...state.past, entry], future: state.future.slice(0, -1) });
      },
      beginBatch() {
        const state = get();
        if (!state.loaded || state.error || state.inFlight || !Object.keys(state.pending).length) return null;
        const batch: ChangeBatch = { batchId: nanoid(12), expectedRevision: state.revision, changes: Object.values(state.pending) };
        set({ inFlight: batch, pending: {} });
        return batch;
      },
      acknowledge(receipt) {
        const state = get();
        if (!state.inFlight || state.inFlight.batchId !== receipt.batchId || receipt.revision !== state.inFlight.expectedRevision + 1) {
          throw new Error('保存回执不匹配，请重试核对；当前修改仍保留');
        }
        set({ inFlight: null, revision: receipt.revision, error: null });
      },
    };
  });
}

export type SessionStore = ReturnType<typeof createSessionStore>;
