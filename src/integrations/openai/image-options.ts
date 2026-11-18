// Shared by the image picker, storage validation and the Images API adapter.
export const imageModels = ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'] as const;
export const defaultImageModel = imageModels[0];
export const imageSizes = [
  ['1:1', '1024x1024'], ['16:9', '1536x864'], ['9:16', '864x1536'],
  ['4:3', '1280x960'],
] as const;
export const imageQualities = ['low', 'medium', 'high'] as const;

export interface ImageOptions {
  model?: typeof imageModels[number];
  size?: string;
  quality?: typeof imageQualities[number];
}

export function imageSizeError(size: string): string | undefined {
  if (!/^[1-9]\d{0,3}x[1-9]\d{0,3}$/.test(size)) return '请填写以像素为单位的宽度和高度';
  const [w, h] = size.split('x').map(Number);
  if (w % 16 || h % 16) return '宽和高都须是 16 的倍数';
  if (Math.max(w, h) > 3840) return '每条边最多 3840 像素';
  if (Math.max(w, h) > 3 * Math.min(w, h)) return '宽高比须在 1:3 至 3:1 之间';
  if (w * h < 655360 || w * h > 8294400) return '总像素须在 655,360 至 8,294,400 之间';
}

export const imageOptionsSchema = {
  type: 'object', additionalProperties: false,
  properties: { model: { enum: imageModels }, size: { type: 'string', maxLength: 9 }, quality: { enum: imageQualities } },
};

export function validImageOptions(value: unknown): value is ImageOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, field]) => {
    if (key === 'size') return typeof field === 'string' && !imageSizeError(field);
    if (key === 'model') return imageModels.some(model => model === field);
    if (key === 'quality') return imageQualities.some(quality => quality === field);
    return false;
  });
}
