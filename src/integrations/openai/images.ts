// Server only. Callers supply image bytes and decide where to store the result.
import axios from 'axios';
import { defaultImageModel, type ImageOptions } from './image-options.js';

export interface GenerateImageRequest {
  prompt: string;
  reference?: File;
  options?: ImageOptions;
  signal?: AbortSignal;
}

export class ImageGenerationError extends Error {}

export async function generateImage({ prompt, reference, options = {}, signal }: GenerateImageRequest): Promise<Buffer> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new ImageGenerationError('请在服务端配置 OPENAI_API_KEY');
  const fields = { ...options, model: options.model ?? defaultImageModel, prompt, output_format: 'png' };
  let body: typeof fields | FormData = fields;
  if (reference) {
    body = new FormData();
    for (const [name, value] of Object.entries(fields)) body.set(name, value);
    body.set('image', reference);
  }
  const endpoint = reference ? 'edits' : 'generations';
  try {
    const response = await axios.post<{ data?: { b64_json?: string }[] }>(`https://api.openai.com/v1/images/${endpoint}`, body, {
      headers: { Authorization: `Bearer ${key}` }, maxRedirects: 0,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(300_000)]) : AbortSignal.timeout(300_000),
    });
    const encoded = response.data?.data?.[0]?.b64_json;
    if (!encoded) throw new ImageGenerationError('OpenAI 未返回图片');
    return Buffer.from(encoded, 'base64');
  } catch (error) {
    if (!axios.isAxiosError(error)) throw error;
    // Provider error bodies and Axios request configs can contain credentials.
    const status = error.response?.status;
    const code = error.response?.data?.error?.code;
    if (code === 'insufficient_quota' || code === 'billing_hard_limit_reached') throw new ImageGenerationError('OpenAI 账户可用额度不足');
    if (code === 'moderation_blocked' || code === 'content_policy_violation') throw new ImageGenerationError('OpenAI 拒绝了此次生成内容，请调整提示词或参考图');
    if (code === 'model_not_found') throw new ImageGenerationError('配置的 OpenAI 图片模型不可用');
    if (status === 401 || status === 403) throw new ImageGenerationError('OpenAI 未授权，请检查服务端密钥和模型权限');
    if (status === 429) throw new ImageGenerationError('OpenAI 额度不足或请求过于频繁');
    if (status === 400) throw new ImageGenerationError('OpenAI 未接受这次请求，请检查提示词和参考图');
    if (error.code === 'ERR_CANCELED') throw new ImageGenerationError('图片生成已中止或超时');
    throw new ImageGenerationError('无法从 OpenAI 获取图片，请检查网络和模型配置');
  }
}
