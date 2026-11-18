import { createStore } from 'zustand/vanilla';
import { nanoid } from 'nanoid';
import type { Project } from '../../core/model.js';
import { applyDocumentChanges, type DocumentObjects, type GraphData } from '../document.js';
import { changeKey, type Change, type ChangeBatch, type Receipt } from '../protocol.js';
import { invertChanges, type HistoryEntry } from './history.js';
import { attachmentKey } from '../attachments.js';

export interface SaveError { message: string; retryable: boolean; phase: 'load' | 'save' | 'validation' }
export interface SessionState extends DocumentObjects {
  project: Project | null;
  loaded: boolean;
  loading: boolean;
  loadVersion: number;
  revision: number;
  pending: Record<string, Change>;
  inFlight: ChangeBatch | null;
  error: SaveError | null;
  editMessage: string | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  allocateId: () => string;
  hydrate: (graph: GraphData) => void;
  edit: (changes: Change[], mergeKey?: string) => boolean;
  undo: () => void;
  redo: () => void;
  beginBatch: () => ChangeBatch | null;
  rejectValidation: (message: string) => void;
  acknowledge: (receipt: Receipt) => void;
}

function queueEdit(state: SessionState, changes: Change[]) {
  const pending = { ...state.pending };
  for (const change of changes) pending[changeKey(change)] = change;
  return { pending, error: state.error?.phase === 'validation' ? null : state.error };
}

export function createSessionStore() {
  return createStore<SessionState>((set, get) => ({
    nodes: {}, edges: {}, layouts: {}, project: null, attachments: {}, loaded: false, loading: true, loadVersion: 0, revision: 0,
    pending: {}, inFlight: null, error: null, editMessage: null, past: [], future: [],
    allocateId: () => nanoid(12),
    hydrate(graph) {
      set({
        nodes: Object.fromEntries(graph.nodes.map(n => [n.id, n])),
        edges: Object.fromEntries(graph.edges.map(e => [e.id, e])),
        layouts: Object.fromEntries(graph.layouts.map(p => [p.nodeId, p])),
        project: graph.project,
        attachments: Object.fromEntries(graph.attachments.map(a => [attachmentKey(a), a])),
        revision: graph.revision, loaded: true, loading: false, pending: {}, inFlight: null,
        loadVersion: get().loadVersion + 1,
        error: null, editMessage: null, past: [], future: [],
      });
    },
    edit(input, mergeKey) {
      const state = get();
      if (!state.loaded || state.loading || !input.length) return false;
      const { document, changes } = applyDocumentChanges(state, input);
      const previous = state.past.at(-1), time = Date.now();
      const merge = mergeKey && previous?.mergeKey === mergeKey && time - previous.time < 1000 && !state.future.length;
      const entry: HistoryEntry = { redo: changes, undo: merge ? previous.undo : invertChanges(state, changes), mergeKey, time };
      set({ ...document, ...queueEdit(state, changes),
        past: [...(merge ? state.past.slice(0, -1) : state.past), entry].slice(-100), future: [] });
      return true;
    },
    undo() {
      const state = get(), entry = state.past.at(-1);
      if (!entry || state.loading) return;
      const { document, changes } = applyDocumentChanges(state, entry.undo);
      set({ ...document, ...queueEdit(state, changes),
        past: state.past.slice(0, -1), future: [...state.future, entry] });
    },
    redo() {
      const state = get(), entry = state.future.at(-1);
      if (!entry || state.loading) return;
      const { document, changes } = applyDocumentChanges(state, entry.redo);
      set({ ...document, ...queueEdit(state, changes),
        past: [...state.past, entry], future: state.future.slice(0, -1) });
    },
    beginBatch() {
      const state = get();
      if (!state.loaded || state.error || state.inFlight || !Object.keys(state.pending).length) return null;
      const batch: ChangeBatch = { batchId: nanoid(12), expectedRevision: state.revision, changes: Object.values(state.pending) };
      set({ inFlight: batch, pending: {} });
      return batch;
    },
    rejectValidation(message) {
      const { inFlight, pending } = get();
      if (!inFlight) return;
      // The transaction was rolled back. Newer edits take precedence over the rejected values.
      const rejected = Object.fromEntries(inFlight.changes.map(change => [changeKey(change), change]));
      set({
        inFlight: null,
        pending: { ...rejected, ...pending },
        error: Object.keys(pending).length ? null : { phase: 'validation', message, retryable: false },
      });
    },
    acknowledge(receipt) {
      const state = get();
      if (!state.inFlight || state.inFlight.batchId !== receipt.batchId || receipt.revision !== state.inFlight.expectedRevision + 1) {
        throw new Error('保存回执不匹配，请重试核对；当前修改仍保留');
      }
      set({ inFlight: null, revision: receipt.revision, error: null });
    },
  }));
}

export type SessionStore = ReturnType<typeof createSessionStore>;
