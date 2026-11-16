import { useEffect } from 'react';
import { useStore } from 'zustand';
import { ReactFlowProvider } from '@xyflow/react';
import { DefaultEditor, type DefaultEditorProps } from './default-editor.js';
import { MembershipDialog } from './membership-dialog.js';

export function App(props: Omit<DefaultEditorProps, 'contextNodeId'>) {
  const contextNodeId = useStore(props.editor.view, state => state.contextNodeId);
  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      const current = props.editor.getState();
      if (current.inFlight || Object.keys(current.pending).length) { event.preventDefault(); event.returnValue = ''; }
    }
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [props.editor]);
  return <>
    <ReactFlowProvider><DefaultEditor {...props} contextNodeId={null} /></ReactFlowProvider>
    {contextNodeId !== null && <MembershipDialog editor={props.editor}>
      <ReactFlowProvider><DefaultEditor {...props} contextNodeId={contextNodeId} /></ReactFlowProvider>
    </MembershipDialog>}
  </>;
}
