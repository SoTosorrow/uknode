import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { SessionStore } from '../../runtime/client/session.js';
import { useVideoImages } from './images.js';
import { resolveVideoInputs, type VideoInput } from './inputs.js';
import { videoData } from './model.js';

type ReadInputs = (outputId: string) => VideoInput[];
const InputContext = createContext<ReadInputs | null>(null);

// The card and the details panel read the same result for this graph and image state.
export function VideoInputs({ session, children }: { session: SessionStore; children: ReactNode }) {
  const graph = useStore(session, useShallow(state => ({ edges: state.edges, attachments: state.attachments })));
  const { imageStatus } = useVideoImages();
  const readInputs = useMemo<ReadInputs>(() => {
    const results = new Map<string, VideoInput[]>();
    return outputId => {
      const previous = results.get(outputId);
      if (previous) return previous;
      const output = videoData(graph, outputId);
      const inputs = output?.kind === 'output' ? resolveVideoInputs(graph, outputId, output.inputOrder, imageStatus) : [];
      results.set(outputId, inputs);
      return inputs;
    };
  }, [graph, imageStatus]);
  return <InputContext.Provider value={readInputs}>{children}</InputContext.Provider>;
}

export function useVideoInputs(outputId: string) {
  const read = useContext(InputContext);
  if (!read) throw new Error('VideoInputs provider required');
  return read(outputId);
}
