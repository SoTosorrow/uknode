import type { DocumentObjects } from '../../runtime/document.js';
import { validSteps, videoData, type VideoData } from './model.js';

export interface VideoConfig {
  prompt: string;
  output_filename: string;
  references: Array<{ type: 'image'; path: string }>;
  steps: number;
}
export interface VideoInput { nodeId: string; data: VideoData | undefined }
type VideoGraph = Pick<DocumentObjects, 'edges' | 'attachments'>;

function incomingEdges(document: VideoGraph, outputId: string) {
  return Object.values(document.edges).filter(edge => edge.target === outputId && videoData(document, edge.source));
}

export function inputsFor(document: VideoGraph, outputId: string): VideoInput[] {
  const output = videoData(document, outputId);
  const sources = new Set(incomingEdges(document, outputId).map(edge => edge.source));
  const saved = output?.kind === 'output' ? output.inputOrder.filter(id => sources.has(id)) : [];
  // External graph edits also get a deterministic order until explicitly reordered.
  const ordered = [...saved, ...[...sources].filter(id => !saved.includes(id)).sort()];
  return ordered.map(nodeId => ({ nodeId, data: videoData(document, nodeId) }));
}

export function buildConfig(document: VideoGraph, outputId: string): { config: VideoConfig | null; errors: string[] } {
  const output = videoData(document, outputId), errors: string[] = [];
  if (output?.kind !== 'output') return { config: null, errors: ['请选择配置节点'] };
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(output.outputFilename)) errors.push('输出文件名需为 1–100 位字母、数字、下划线或短横线');
  if (!validSteps(output.steps)) errors.push('步数需为 1–1000 的整数');
  if (incomingEdges(document, outputId).some(edge => !edge.directed)) errors.push('输入连线必须开启方向');
  const prompts: string[] = [], references: VideoConfig['references'] = [];
  for (const { nodeId, data } of inputsFor(document, outputId)) {
    if (data?.kind === 'image') {
      if (data.path) references.push({ type: 'image', path: data.path });
      else errors.push(`图片节点 ${nodeId} 尚未上传图片`);
    } else if (data?.kind === 'prompt') {
      if (data.text.trim()) prompts.push(data.text.trim());
      else errors.push(`提示词节点 ${nodeId} 内容为空`);
    } else errors.push(`节点 ${nodeId} 不能作为视频输入，请连接图片或提示词节点`);
  }
  if (!prompts.length) errors.push('至少连接一个填写了内容的提示词节点');
  return { config: errors.length ? null : { prompt: prompts.join('\n'), output_filename: output.outputFilename, references, steps: output.steps! }, errors };
}
