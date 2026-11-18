import type { SessionStore } from '../../runtime/client/session.js';
import { WriteError } from '../../runtime/errors.js';
import { initialData, videoAttachment, videoData, type VideoData } from './model.js';
import { inputsFor } from './config.js';

export function createVideoNode(session: SessionStore, kind: VideoData['kind'], position: { x: number; y: number }) {
  const state = session.getState();
  if (!state.loaded || state.loading) return null;
  const id = state.allocateId();
  state.edit([
    { type: 'node.put', node: { id } },
    { type: 'layout.put', layout: { nodeId: id, contextNodeId: null, ...position } },
    { type: 'attachment.put', attachment: videoAttachment(id, initialData(kind)) },
  ]);
  return id;
}

export function connectVideo(session: SessionStore, source: string, target: string): string | null {
  const state = session.getState(), from = videoData(state, source), to = videoData(state, target);
  if (!state.loaded || state.loading) return '数据尚未读取完成';
  if ((from?.kind !== 'image' && from?.kind !== 'prompt') || to?.kind !== 'output') return '请从图片或提示词节点的右侧，连接到配置节点的左侧';
  if (Object.values(state.edges).some(edge => edge.source === source && edge.target === target)) return '这两个节点已经连接';
  const order = inputsFor(state, target).map(input => input.nodeId);
  state.edit([
    { type: 'edge.put', edge: { id: state.allocateId(), source, target, directed: true } },
    { type: 'attachment.put', attachment: videoAttachment(target, { ...to, inputOrder: [...order, source] }) },
  ]);
  return null;
}

export function updateVideoNode(session: SessionStore, nodeId: string, data: VideoData, field?: string) {
  try {
    session.getState().edit([{ type: 'attachment.put', attachment: videoAttachment(nodeId, data) }], field ? `ai-video:${nodeId}:${field}` : undefined);
  } catch (error) {
    if (!(error instanceof WriteError)) throw error;
    session.setState({ editMessage: error.message });
  }
}

export function moveInput(session: SessionStore, outputId: string, nodeId: string, offset: number) {
  const state = session.getState(), output = videoData(state, outputId);
  if (output?.kind !== 'output') return;
  const inputOrder = inputsFor(state, outputId).map(input => input.nodeId), index = inputOrder.indexOf(nodeId), next = index + offset;
  if (index < 0 || next < 0 || next >= inputOrder.length) return;
  [inputOrder[index], inputOrder[next]] = [inputOrder[next], inputOrder[index]];
  updateVideoNode(session, outputId, { ...output, inputOrder });
}
