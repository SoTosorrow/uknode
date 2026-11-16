import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { Editor } from './editor-store.js';
import type { NodeLayout } from '../runtime/document.js';

const noPreviews: Record<string, NodeLayout> = {};
const emptySelection = { nodes: [] as string[], edges: [] as string[] };

export function useEditorState(editor: Editor, contextNodeId: string | null) {
  const session = useStore(editor.session, useShallow(state => ({
    nodes: state.nodes, edges: state.edges, memberships: state.memberships, layouts: state.layouts,
    loaded: state.loaded, loading: state.loading, error: state.error, pending: state.pending, inFlight: state.inFlight,
    canUndo: state.past.length > 0, canRedo: state.future.length > 0,
  })));
  const view = useStore(editor.view, useShallow(state => {
    const active = state.contextNodeId === contextNodeId;
    const selection = active ? { nodes: state.selectedNodes, edges: state.selectedEdges } : state.mainSelection ?? emptySelection;
    return { ...state, active, contextNodeId,
      selectedNodes: selection.nodes, selectedEdges: selection.edges,
      previewLayouts: active ? state.previewLayouts : noPreviews,
    };
  }));
  return { ...session, ...view };
}

export function useMembershipState(editor: Editor) {
  const session = useStore(editor.session, useShallow(state => ({
    nodes: state.nodes, memberships: state.memberships, loaded: state.loaded, loading: state.loading,
  })));
  const view = useStore(editor.view, useShallow(state => ({
    contextNodeId: state.contextNodeId, navigation: state.navigation,
    closeScope: state.closeScope, goBack: state.goBack, addMembership: state.addMembership,
  })));
  return { ...session, ...view };
}

export type EditorUIState = ReturnType<typeof useEditorState>;
