import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { Editor } from './editor-store.js';

export function useEditorState(editor: Editor) {
  const session = useStore(editor.session, useShallow(state => ({
    project: state.project, nodes: state.nodes, edges: state.edges, layouts: state.layouts, groups: state.groups, groupByNode: state.groupByNode, editMessage: state.editMessage,
    loaded: state.loaded, loading: state.loading, error: state.error, pending: state.pending, inFlight: state.inFlight,
    canUndo: state.past.length > 0, canRedo: state.future.length > 0,
  })));
  return { ...session, ...useStore(editor.view) };
}

export type EditorUIState = ReturnType<typeof useEditorState>;
