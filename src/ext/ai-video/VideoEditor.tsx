import { useCallback, useMemo } from 'react';
import type { Editor } from '../../view/editor-store.js';
import type { Autosave } from '../../runtime/client/autosave.js';
import { App } from '../../view/App.js';
import { createVideoNode, connectVideo } from './actions.js';
import { videoData, type VideoData } from './model.js';
import { VideoNode, VideoDetails } from './components.js';
import './styles.css';

export function VideoEditor({ editor, saver }: { editor: Editor; saver: Autosave }) {
  const renderNode = useCallback(({ id }: { id: string }) => <VideoNode nodeId={id} session={editor.session} />, [editor]);
  const renderDetails = useCallback(({ nodes, edges }: { nodes: string[]; edges: string[] }) =>
    nodes.length === 1 && !edges.length ? <VideoDetails nodeId={nodes[0]} session={editor.session} /> : null, [editor]);
  const nodeActions = useMemo(() => (['image', 'prompt', 'output'] as VideoData['kind'][]).map(kind => ({
    label: { image: '新增图片', prompt: '新增提示词', output: '新增配置' }[kind],
    create(position: { x: number; y: number }, contextNodeId: string | null) {
      const id = createVideoNode(editor.session, kind, position, contextNodeId);
      if (id) editor.getState().select([id], []);
    },
  })), [editor]);
  const onConnect = useCallback((source: string, target: string) => {
    const state = editor.session.getState();
    if (!videoData(state, source) && !videoData(state, target)) { editor.getState().createEdge(source, target); return null; }
    return connectVideo(editor.session, source, target);
  }, [editor]);
  return <App editor={editor} saver={saver} renderNode={renderNode} renderDetails={renderDetails} nodeActions={nodeActions} onConnect={onConnect} />;
}
