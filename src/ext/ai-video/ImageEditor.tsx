import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import axios from 'axios';
import type { SessionStore } from '../../runtime/client/session.js';
import { defaultImageModel, imageSizeError, imageModels, imageQualities, imageSizes, type ImageOptions } from '../../integrations/openai/image-options.js';
import { updateVideoNode } from './actions.js';
import { useVideoImages } from './images.js';
import { videoData, type ImageData } from './model.js';

const api = '/api/ext/ai-video';
type Asset = { path: string; name: string };

function GenerationTime() {
  const [start] = useState(Date.now);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [start]);
  const elapsed = [Math.floor(seconds / 60), seconds % 60].map(value => String(value).padStart(2, '0')).join(':');
  return <div className="video-image-progress"><i aria-hidden="true" /><span role="status">生成中</span><time aria-label="已等待">{elapsed}</time></div>;
}

export function ImageEditor({ nodeId, session, data }: { nodeId: string; session: SessionStore; data: ImageData }) {
  const { imageStatus, mark, report } = useVideoImages();
  const [withReference, setWithReference] = useState(false);
  const [error, setError] = useState('');
  const savedSize = data.options?.size ?? '';
  const [draft, setDraft] = useState<{ base: string; width: string; height: string } | null>(null);
  const custom = draft?.base === savedSize ? draft : null;
  const isCustom = !!custom || (!!savedSize && !imageSizes.some(([, size]) => size === savedSize));
  const [width, height] = custom ? [custom.width, custom.height] : savedSize.split('x');
  const sizeError = isCustom ? imageSizeError(`${width}x${height}`) : undefined;
  const request = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const path = data.path;
  const status = imageStatus(nodeId, path);
  const busy = status === 'uploading' || status === 'generating';
  const editing = withReference && Boolean(path);
  useEffect(() => () => { request.current?.abort(); mark(nodeId, null); }, [mark, nodeId]);
  useLayoutEffect(() => () => report(nodeId, null), [report, nodeId, path]);

  async function replaceImage(file?: File) {
    if (request.current || (!file && sizeError)) return;
    if (file && file.size > 20 * 1024 * 1024) { setError('图片不能超过 20 MB'); return; }
    const controller = new AbortController();
    request.current = controller;
    mark(nodeId, file ? 'uploading' : 'generating');
    setError('');
    try {
      let asset: Asset;
      if (file) {
        const bitmap = await createImageBitmap(file);
        bitmap.close();
        const result = await axios.post<Asset>(`${api}/images`, file, {
          params: { name: file.name }, headers: { 'Content-Type': 'application/octet-stream' }, signal: controller.signal, timeout: 60000,
        });
        asset = result.data;
      } else {
        const result = await axios.post<Asset>(`${api}/images/generate`, {
          prompt: data.prompt.trim(), ...(data.options && { options: data.options }), ...(editing ? { reference: path } : {}),
        }, { signal: controller.signal });
        asset = result.data;
      }
      if (controller.signal.aborted) return;
      const current = videoData(session.getState(), nodeId);
      if (current?.kind === 'image' && current.path === path) updateVideoNode(session, nodeId, { ...current, ...asset });
      else setError('当前图片已更换，本次结果未应用');
    } catch (cause) {
      if (controller.signal.aborted) return;
      const fallback = file ? '上传失败，请检查图片后重试' : '生成失败，请重试';
      setError(axios.isAxiosError(cause) ? cause.response?.data?.message || fallback : fallback);
    } finally {
      request.current = null;
      if (!controller.signal.aborted) mark(nodeId, null);
    }
  }

  function setOption(key: keyof ImageOptions, value: string) {
    const options = { ...data.options, [key]: value };
    if (!value) delete options[key];
    updateVideoNode(session, nodeId, { ...data, options });
  }

  function editDimensions(width: string, height: string) {
    const size = `${width}x${height}`;
    const valid = !imageSizeError(size);
    setDraft({ base: valid ? size : savedSize, width, height });
    if (valid && size !== savedSize) setOption('size', size);
  }

  return <>
    <div className={`video-image-preview${path ? '' : ' is-empty'}${busy ? ' is-busy' : ''}`} aria-busy={busy}>
      {path && <img key={path} src={`${api}/${path}?thumbnail=1`} alt={data.name} draggable={false}
        onLoad={() => report(nodeId, { path, readable: true })} onError={() => report(nodeId, { path, readable: false })} />}
      {busy ? status === 'generating' ? <GenerationTime /> : <div className="video-image-progress" role="status">上传中…</div>
        : <div className="video-image-actions">
          {path && <button disabled={status !== 'ready'} onClick={() => { setPreviewOpen(true); dialog.current?.showModal(); }}>预览</button>}
          <button onClick={() => fileInput.current?.click()}>上传图片</button>
        </div>}
      <input hidden ref={fileInput} aria-label="选择图片文件" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy}
        onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void replaceImage(file); }} />
    </div>
    {data.name && <p className="video-file-name" title={data.name}>{data.name}</p>}
    <textarea className="video-image-prompt" aria-label="生图提示词" placeholder="描述要生成的图片…" maxLength={20000} value={data.prompt}
      onChange={event => updateVideoNode(session, nodeId, { ...data, prompt: event.target.value }, 'image-prompt')} />
    <div className="video-generation-controls">
      <label><input type="checkbox" role="switch" checked={editing} disabled={busy || (!editing && status !== 'ready')}
        onChange={event => setWithReference(event.target.checked)} />参考当前图片</label>
      <button disabled={busy || !!sizeError || !data.prompt.trim() || (editing && status !== 'ready')} onClick={() => void replaceImage()}>生成</button>
    </div>
    <details className="video-image-options">
      <summary>更多选项</summary>
      <label>画幅<select value={isCustom ? 'custom' : savedSize} onChange={event => {
        const size = event.target.value;
        if (size === 'custom') setDraft({ base: savedSize, width: width ?? '', height: height ?? '' });
        else { setDraft(null); setOption('size', size); }
      }}>
        <option value="">自动</option>
        {imageSizes.map(([ratio, size]) => <option key={size} value={size}>{ratio} · {size.replace('x', '×')}</option>)}
        <option value="custom">自定义尺寸</option>
      </select></label>
      {isCustom && <>
        <div className="video-dimensions">
          <label>宽<input aria-label="宽度（像素）" type="number" min={16} max={3840} step={16}
            value={width ?? ''} onChange={event => editDimensions(event.target.value, height ?? '')} /></label>
          <label>高<input aria-label="高度（像素）" type="number" min={16} max={3840} step={16}
            value={height ?? ''} onChange={event => editDimensions(width ?? '', event.target.value)} /></label>
        </div>
        {sizeError && <small className="video-error" role="status">{sizeError}</small>}
      </>}
      <label>质量<select value={data.options?.quality ?? ''} onChange={event => setOption('quality', event.target.value)}>
        <option value="">自动</option>
        {imageQualities.map(quality => <option key={quality} value={quality}>{{ low: '低', medium: '中', high: '高' }[quality]}</option>)}
      </select></label>
      <label>模型<select value={data.options?.model ?? defaultImageModel} onChange={event => setOption('model', event.target.value === defaultImageModel ? '' : event.target.value)}>
        {imageModels.map(model => <option key={model} value={model}>{model}{model === defaultImageModel ? '（默认）' : ''}</option>)}
      </select></label>
    </details>
    {status === 'unavailable' && <p className="video-error video-file-error" role="alert">图片读取失败，请重新上传或生成</p>}
    {error && <p className="video-error" role="alert">{error}</p>}
    <dialog ref={dialog} className="video-lightbox" aria-label="图片预览" onClose={() => setPreviewOpen(false)} onClick={event => { if (event.target === dialog.current) dialog.current?.close(); }}>
      <button aria-label="关闭图片预览" onClick={() => dialog.current?.close()}>关闭</button>
      {previewOpen && path && <img src={`${api}/${path}`} alt={data.name} onError={() => {
        report(nodeId, { path, readable: false });
        dialog.current?.close();
      }} />}
    </dialog>
  </>;
}
