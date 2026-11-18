import { ReactFlowProvider } from '@xyflow/react';
import { DefaultEditor, type DefaultEditorProps } from './default-editor.js';

export function App(props: DefaultEditorProps) {
  return <ReactFlowProvider><DefaultEditor {...props} /></ReactFlowProvider>;
}
