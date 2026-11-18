import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ReadImageStatus } from './inputs.js';

export type ImageOperation = 'uploading' | 'generating';
type ImageRead = { path: string; readable: boolean };
const ImageContext = createContext<{
  operations: ReadonlyMap<string, ImageOperation>;
  imageStatus: ReadImageStatus;
  report: (nodeId: string, read: ImageRead | null) => void;
  mark: (nodeId: string, operation: ImageOperation | null) => void;
} | null>(null);

export function VideoImages({ children }: { children: ReactNode }) {
  const [operations, setOperations] = useState(() => new Map<string, ImageOperation>());
  const mark = useCallback((nodeId: string, operation: ImageOperation | null) => {
    setOperations(previous => {
      if ((previous.get(nodeId) ?? null) === operation) return previous;
      const next = new Map(previous);
      if (operation) next.set(nodeId, operation);
      else next.delete(nodeId);
      return next;
    });
  }, []);
  const [reads, setReads] = useState(() => new Map<string, ImageRead>());
  const report = useCallback((nodeId: string, read: ImageRead | null) => {
    setReads(previous => {
      const last = previous.get(nodeId);
      if (last?.path === read?.path && last?.readable === read?.readable) return previous;
      const next = new Map(previous);
      if (read) next.set(nodeId, read);
      else next.delete(nodeId);
      return next;
    });
  }, []);
  const imageStatus = useCallback<ReadImageStatus>((nodeId, path) => {
    const operation = operations.get(nodeId);
    if (operation) return operation;
    const read = reads.get(nodeId);
    if (!read || read.path !== path) return 'loading';
    return read.readable ? 'ready' : 'unavailable';
  }, [operations, reads]);
  const active = operations.size > 0;
  useEffect(() => {
    if (!active) return;
    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [active]);
  return <ImageContext.Provider value={{ operations, mark, imageStatus, report }}>{children}</ImageContext.Provider>;
}

export function useVideoImages() {
  const images = useContext(ImageContext);
  if (!images) throw new Error('VideoImages provider required');
  return images;
}
