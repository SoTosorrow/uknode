import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

const UploadContext = createContext<{
  nodeIds: ReadonlySet<string>;
  mark: (nodeId: string, uploading: boolean) => void;
} | null>(null);

export function VideoUploads({ children }: { children: ReactNode }) {
  const [nodeIds, setNodeIds] = useState<ReadonlySet<string>>(() => new Set());
  const mark = useCallback((nodeId: string, uploading: boolean) => {
    setNodeIds(previous => {
      if (previous.has(nodeId) === uploading) return previous;
      const next = new Set(previous);
      if (uploading) next.add(nodeId);
      else next.delete(nodeId);
      return next;
    });
  }, []);
  const active = nodeIds.size > 0;
  useEffect(() => {
    if (!active) return;
    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [active]);
  return <UploadContext.Provider value={{ nodeIds, mark }}>{children}</UploadContext.Provider>;
}

export function useUploads() {
  const uploads = useContext(UploadContext);
  if (!uploads) throw new Error('VideoUploads provider required');
  return uploads;
}
