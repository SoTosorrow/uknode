import { attachmentKey, type NodeAttachment } from '../../runtime/attachments.js';
import { WriteError } from '../../runtime/errors.js';
import type { DocumentObjects } from '../../runtime/document.js';

import { validImageOptions, type ImageOptions } from '../../integrations/openai/image-options.js';

export const namespace = 'ai-video';
export type ImageData = { kind: 'image'; path: string | null; name: string; prompt: string; options?: ImageOptions };
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
export function videoSummary(data: VideoData): string {
  if (data.kind === 'image') return data.name ? `图片 · ${data.name}` : '图片';
  if (data.kind === 'prompt') return data.text ? `提示词 · ${data.text}` : '提示词';
  return data.outputFilename ? `配置 · ${data.outputFilename}` : '配置';
}

export function initialData(kind: VideoData['kind']): VideoData {
  if (kind === 'image') return { kind, path: null, name: '', prompt: '' };
  if (kind === 'prompt') return { kind, text: '' };
  return { kind, outputFilename: 'video', steps: 15, inputOrder: [] };
}

// Validate business fields at the storage boundary, including direct service calls.
export function parseVideoData(value: Record<string, unknown>): VideoData {
  const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
  const { kind, name, path, outputFilename, steps, inputOrder } = value;
  const prompt = value.prompt === undefined ? '' : value.prompt;
  if (kind === 'image' && text(prompt, 20000) && text(name, 255) && (path === null || (typeof path === 'string' && assetPattern.test(path)))) {
    if (value.options === undefined) return { kind, name, path, prompt };
    if (validImageOptions(value.options)) return { kind, name, path, prompt, options: value.options };
  }
  if (kind === 'prompt' && text(value.text, 20000)) return { kind, text: value.text };
  if (kind === 'output' && text(outputFilename, 100)
    && Array.isArray(inputOrder) && inputOrder.length <= 10000
    && inputOrder.every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{12}$/.test(id))
    && new Set(inputOrder).size === inputOrder.length) {
    if (steps !== null && !validSteps(steps)) {
      throw new WriteError('INVALID_VIDEO_DATA', '步数需为 1–1000 的整数，修改后会重新保存');
    }
    return { kind, outputFilename, steps, inputOrder };
  }
  throw new WriteError('INVALID_VIDEO_DATA', '视频节点字段无效，请检查图片、提示词或输出参数');
}

export function validSteps(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 1000;
}
