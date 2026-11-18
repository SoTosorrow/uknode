import { useStore } from 'zustand';
import { ReactFlowProvider } from '@xyflow/react';
import { DefaultEditor, type DefaultEditorProps } from './default-editor.js';
import { MembershipDialog } from './membership-dialog.js';

export function App(props: Omit<DefaultEditorProps, 'contextNodeId'>) {
  const contextNodeId = useStore(props.editor.view, state => state.contextNodeId);
  return <>
    <ReactFlowProvider><DefaultEditor {...props} contextNodeId={null} /></ReactFlowProvider>
    {contextNodeId !== null && <MembershipDialog editor={props.editor}>
      <ReactFlowProvider><DefaultEditor {...props} contextNodeId={contextNodeId} /></ReactFlowProvider>
    </MembershipDialog>}
  </>;
}
