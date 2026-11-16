import { useStore } from 'zustand';
import type { Editor, EditorState } from './editor-store.js';

export function useEditorState(editor: Editor): EditorState {
  const session = useStore(editor.session);
  const view = useStore(editor.view);
  return { ...session, ...view };
}
