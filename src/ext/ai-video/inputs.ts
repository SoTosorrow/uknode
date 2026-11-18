import { edgesTo } from '../../core/graph.js';
import type { DocumentObjects } from '../../runtime/document.js';
import { videoData } from './model.js';

type VideoGraph = Pick<DocumentObjects, 'edges' | 'attachments'>;
export type ImageStatus = 'loading' | 'generating' | 'uploading' | 'ready' | 'unavailable';
export type ReadImageStatus = (nodeId: string, path: string | null) => ImageStatus;

type Source = { nodeId: string; directed: boolean };
export type VideoInput = { nodeId: string } & (
  | { kind: 'image'; path: string; name: string }
  | { kind: 'prompt'; text: string }
  | { kind: 'unavailable'; sourceKind: 'image' | 'prompt' | 'unsupported'; reason: string }
);

export function orderedSources(graph: Pick<VideoGraph, 'edges'>, outputId: string, order: string[]): Source[] {
  const sources = new Map<string, Source>();
  for (const edge of edgesTo(graph, outputId)) {
    // Consume a source once, while retaining direction errors on parallel edges.
    const existing = sources.get(edge.source);
    if (existing) existing.directed &&= edge.directed;
    else sources.set(edge.source, { nodeId: edge.source, directed: edge.directed });
  }
  const ordered: Source[] = [];
  for (const id of order) {
    const source = sources.get(id);
    if (source) {
      ordered.push(source);
      sources.delete(id);
    }
  }
  for (const id of [...sources.keys()].sort()) ordered.push(sources.get(id)!);
  return ordered;
}

export function resolveVideoInputs(graph: VideoGraph, outputId: string, order: string[], imageStatus: ReadImageStatus): VideoInput[] {
  return orderedSources(graph, outputId, order).map(({ nodeId, directed }): VideoInput => {
    const data = videoData(graph, nodeId);
    const sourceKind = data?.kind === 'image' || data?.kind === 'prompt' ? data.kind : 'unsupported';
    const unavailable = (reason: string): VideoInput => ({ nodeId, kind: 'unavailable', sourceKind, reason });
    if (!directed) return unavailable('输入连线必须开启方向');
    if (data?.kind === 'prompt') {
      const text = data.text.trim();
      return text ? { nodeId, kind: 'prompt', text } : unavailable('提示词内容为空');
    }
    if (data?.kind === 'image') {
      const status = imageStatus(nodeId, data.path);
      if (status === 'generating') return unavailable('参考图片正在生成');
      if (status === 'uploading') return unavailable('参考图片正在上传');
      if (!data.path) return unavailable('尚未上传图片');
      if (status === 'loading') return unavailable('正在读取参考图片');
      if (status === 'unavailable') return unavailable('参考图片不可用，请查看图片节点');
      return { nodeId, kind: 'image', path: data.path, name: data.name };
    }
    return unavailable('该节点无法提供图片或提示词');
  });
}
