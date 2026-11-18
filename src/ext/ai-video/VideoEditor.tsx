import { useCallback, useMemo } from 'react';
import type { Editor } from '../../view/editor-store.js';
import type { Autosave } from '../../runtime/client/autosave.js';
import { ReactFlowProvider } from '@xyflow/react';
import { DefaultEditor } from '../../view/default-editor.js';
import { createVideoNode, connectVideo } from './actions.js';
import { namespace, type VideoData } from './model.js';
import { VideoNode, VideoDetails } from './components.js';
import { useUploads, VideoUploads } from './uploads.js';
import './styles.css';

type Props = { editor: Editor; saver: Autosave };

export function VideoEditor(props: Props) {
  return <VideoUploads><VideoCanvas {...props} /></VideoUploads>;
}

function VideoCanvas({ editor, saver }: Props) {
  const uploads = useUploads();
  const renderNode = useCallback(({ id }: { id: string }) => <VideoNode nodeId={id} session={editor.session} />, [editor]);
  const renderDetails = useCallback(({ nodes, edges }: { nodes: string[]; edges: string[] }) =>
    nodes.length === 1 && !edges.length ? <VideoDetails nodeId={nodes[0]} session={editor.session} /> : null, [editor]);
  const nodeActions = useMemo(() => (['image', 'prompt', 'output'] as VideoData['kind'][]).map(kind => ({
    label: { image: '新增图片', prompt: '新增提示词', output: '新增配置' }[kind],
    create(position: { x: number; y: number }) {
      const id = createVideoNode(editor.session, kind, position);
      if (id) editor.getState().select([id], []);
    },
  })), [editor]);
  return <ReactFlowProvider>
    <DefaultEditor editor={editor} saver={saver} contextNodeId={null} namespace={namespace} activity={uploads.nodeIds.size ? '上传中' : undefined}
      renderNode={renderNode} renderDetails={renderDetails} nodeActions={nodeActions}
      onConnect={(source, target) => connectVideo(editor.session, source, target)} />
  </ReactFlowProvider>;
}
