import { validSteps, type OutputData } from './model.js';
import type { VideoInput } from './inputs.js';

export interface VideoConfig {
  prompt: string;
  output_filename: string;
  references: Array<{ type: 'image'; path: string }>;
  steps: number;
}

export function buildConfig(output: OutputData, inputs: VideoInput[]): { config: VideoConfig | null; errors: string[] } {
  const errors: string[] = [], prompts: string[] = [], references: VideoConfig['references'] = [];
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(output.outputFilename)) errors.push('输出文件名需为 1–100 位字母、数字、下划线或短横线');
  for (const input of inputs) {
    if (input.kind === 'unavailable') errors.push(`节点 ${input.nodeId} · ${input.reason}`);
    else if (input.kind === 'image') references.push({ type: 'image', path: input.path });
    else prompts.push(input.text);
  }
  if (!inputs.some(input => input.kind === 'prompt' || (input.kind === 'unavailable' && input.sourceKind === 'prompt'))) {
    errors.push('至少连接一个填写了内容的提示词节点');
  }
  if (!validSteps(output.steps)) {
    errors.push('步数需为 1–1000 的整数');
    return { config: null, errors };
  }
  return { config: errors.length ? null : { prompt: prompts.join('\n'), output_filename: output.outputFilename, references, steps: output.steps }, errors };
}
