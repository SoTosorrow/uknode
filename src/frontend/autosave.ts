import axios, { type AxiosInstance } from 'axios';
import type { GraphData } from '../shared/model.js';
import type { Receipt } from '../shared/protocol.js';
import type { GraphStore } from './graph-store.js';

// Axios handles HTTP, JSON, timeout and cancellation. This class only coordinates
// the application's frozen in-flight batch and the next pending changes.
export class Autosave {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private busy = false;
  private controller: AbortController | undefined;
  private disposed = false;
  private generation = 0;
  private unsubscribe: () => void;

  constructor(private store: GraphStore, private http: AxiosInstance = axios.create({ baseURL: '/api', timeout: 10_000 })) {
    this.unsubscribe = store.subscribe(() => this.schedule());
  }

  async load() {
    if (this.disposed) return;
    const generation = ++this.generation;
    this.controller?.abort();
    this.controller = new AbortController();
    clearTimeout(this.timer);
    this.store.setState({ loading: true, error: null });
    try {
      const { data } = await this.http.get<GraphData>('/graph', { signal: this.controller.signal });
      if (generation !== this.generation || this.disposed) return;
      this.store.getState().hydrate(data);
    } catch (error) {
      if (generation === this.generation && !this.disposed) this.fail(error, 'load');
    } finally {
      if (generation === this.generation) this.store.setState({ loading: false });
    }
  }

  private schedule() {
    clearTimeout(this.timer);
    const state = this.store.getState();
    if (this.disposed || this.busy || state.loading || !state.loaded || state.error || state.inFlight || !Object.keys(state.pending).length) return;
    this.timer = setTimeout(() => { void this.flush(); }, Math.max(0, state.dueAt - Date.now()));
  }

  async flush() {
    clearTimeout(this.timer);
    const state = this.store.getState();
    if (this.disposed || this.busy || state.loading || state.error) return;
    this.busy = true;
    const generation = this.generation;
    const batch = state.inFlight ?? state.beginBatch();
    if (!batch) { this.busy = false; return; }
    this.controller = new AbortController();
    try {
      const { data } = await this.http.post<Receipt>('/changes', batch, { signal: this.controller.signal });
      if (generation !== this.generation || this.disposed) return;
      if (data.batchId !== batch.batchId || data.revision !== batch.expectedRevision + 1) {
        throw new Error('保存回执不匹配，请重试核对；当前修改仍保留');
      }
      this.store.getState().acknowledge(data);
    } catch (error) {
      if (generation === this.generation && !this.disposed) this.fail(error, 'save');
    } finally {
      this.busy = false;
      this.schedule();
    }
  }

  async retry() {
    const state = this.store.getState();
    if (this.busy || !state.error?.retryable) return;
    if (!state.loaded || state.error.phase === 'load') return this.load();
    this.store.setState({ error: null });
    await this.flush();
  }

  private fail(error: unknown, phase: 'load' | 'save') {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    const body = axios.isAxiosError<{ message?: string }>(error) ? error.response?.data : undefined;
    const message = typeof body?.message === 'string' ? body.message
      : error instanceof Error && !axios.isAxiosError(error) ? error.message
      : '请求失败，尚未确认的修改保留在本页，请重试';
    this.store.setState({ error: { message, phase, retryable: status === undefined || status >= 500 || status === 429 } });
  }

  dispose() {
    this.disposed = true;
    ++this.generation;
    clearTimeout(this.timer);
    this.controller?.abort();
    this.unsubscribe();
  }
}
