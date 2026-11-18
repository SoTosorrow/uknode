import { useMemo } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { Editor } from './editor-store.js';
import type { NodeLayout } from '../runtime/document.js';

const noPreviews: Record<string, NodeLayout> = {};
const emptySelection = { nodes: [] as string[], edges: [] as string[] };

// A canvas projects the shared document. Persistence and undo still see every attachment.
function useCanvasGraph(editor: Editor, namespace?: string) {
  const nodes = useStore(editor.session, state => state.nodes);
  const memberships = useStore(editor.session, state => state.memberships);
  const attached = useStore(editor.session, useShallow(state => Object.values(state.attachments)
    .filter(item => !namespace || item.namespace === namespace)
    .map(item => item.nodeId)));
  return useMemo(() => {
    const ids = new Set(attached);
    const visible = (id: string) => namespace ? ids.has(id) : !ids.has(id);
    return {
      nodes: Object.fromEntries(Object.entries(nodes).filter(([id]) => visible(id))),
      memberships: Object.fromEntries(Object.entries(memberships)
        .filter(([, relation]) => visible(relation.containerId) && visible(relation.memberId))),
    };
  }, [nodes, attached, memberships, namespace]);
}

export function useEditorState(editor: Editor, contextNodeId: string | null, namespace?: string) {
  const graph = useCanvasGraph(editor, namespace);
  const session = useStore(editor.session, useShallow(state => ({
    edges: state.edges, layouts: state.layouts, editMessage: state.editMessage,
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
  return { ...session, ...view, ...graph };
}

export function useMembershipState(editor: Editor) {
  const graph = useCanvasGraph(editor);
  const session = useStore(editor.session, useShallow(state => ({
    loaded: state.loaded, loading: state.loading,
  })));
  const view = useStore(editor.view, useShallow(state => ({
    contextNodeId: state.contextNodeId, navigation: state.navigation,
    closeScope: state.closeScope, goBack: state.goBack, addMembership: state.addMembership,
  })));
  return { ...session, ...view, ...graph };
}

export type EditorUIState = ReturnType<typeof useEditorState>;
