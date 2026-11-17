import { attachmentKey, type NodeAttachment } from '../../runtime/attachments.js';
import type { DocumentObjects } from '../../runtime/document.js';

export const namespace = 'ai-video';
export type ImageData = { kind: 'image'; path: string | null; name: string };
export type PromptData = { kind: 'prompt'; text: string };
export type OutputData = { kind: 'output'; outputFilename: string; steps: number | null; inputOrder: string[] };
export type VideoData = ImageData | PromptData | OutputData;
export const assetPattern = /^assets\/[A-Za-z0-9_-]{12}\.(png|jpg|webp)$/;

export function videoAttachment(nodeId: string, data: VideoData): NodeAttachment {
  return { namespace, nodeId, data };
}
export function videoData(document: Pick<DocumentObjects, 'attachments'>, nodeId: string): VideoData | undefined {
  return document.attachments[attachmentKey({ namespace, nodeId })]?.data as VideoData | undefined;
}
export function initialData(kind: VideoData['kind']): VideoData {
  if (kind === 'image') return { kind, path: null, name: '' };
  if (kind === 'prompt') return { kind, text: '' };
  return { kind, outputFilename: 'video', steps: 15, inputOrder: [] };
}

// Validate business fields at the storage boundary, including direct service calls.
export function parseVideoData(value: Record<string, unknown>): VideoData {
  const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
  const keys = Object.keys(value).sort().join(',');
  if (value.kind === 'image' && keys === 'kind,name,path' && text(value.name, 255)
    && (value.path === null || (typeof value.path === 'string' && assetPattern.test(value.path)))) return value as ImageData;
  if (value.kind === 'prompt' && keys === 'kind,text' && text(value.text, 20000)) return value as PromptData;
  if (value.kind === 'output' && keys === 'inputOrder,kind,outputFilename,steps' && text(value.outputFilename, 100)
    && (value.steps === null || (Number.isInteger(value.steps) && Number(value.steps) >= 1 && Number(value.steps) <= 1000))
    && Array.isArray(value.inputOrder) && value.inputOrder.length <= 10000
    && value.inputOrder.every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{12}$/.test(id))
    && new Set(value.inputOrder).size === value.inputOrder.length) return value as OutputData;
  throw new Error('视频节点字段无效，请检查图片、提示词或输出参数');
}
