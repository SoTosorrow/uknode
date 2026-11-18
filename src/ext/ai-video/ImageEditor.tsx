import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import axios from 'axios';
import type { SessionStore } from '../../runtime/client/session.js';
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
  const request = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const path = data.path;
  const status = imageStatus(nodeId, path);
  const busy = status === 'uploading' || status === 'generating';
  const editing = withReference && Boolean(path);
  useEffect(() => () => { request.current?.abort(); mark(nodeId, null); }, [mark, nodeId]);
  useLayoutEffect(() => () => report(nodeId, null), [report, nodeId, path]);

  async function replaceImage(file?: File) {
    if (request.current) return;
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
          prompt: data.prompt.trim(), ...(editing ? { reference: path } : {}),
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

  return <>
    <div className={`video-image-preview${path ? '' : ' is-empty'}${busy ? ' is-busy' : ''}`} aria-busy={busy}>
      {path && <img key={path} src={`${api}/${path}`} alt={data.name} draggable={false}
        onLoad={() => report(nodeId, { path, readable: true })} onError={() => report(nodeId, { path, readable: false })} />}
      {busy ? status === 'generating' ? <GenerationTime /> : <div className="video-image-progress" role="status">上传中…</div>
        : <div className="video-image-actions">
          {path && <button disabled={status !== 'ready'} onClick={() => dialog.current?.showModal()}>放大图片</button>}
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
      <button disabled={busy || !data.prompt.trim() || (editing && status !== 'ready')} onClick={() => void replaceImage()}>生成</button>
    </div>
    {status === 'unavailable' && <p className="video-error video-file-error" role="alert">图片读取失败，请重新上传或生成</p>}
    {error && <p className="video-error" role="alert">{error}</p>}
    <dialog ref={dialog} className="video-lightbox" aria-label="图片预览" onClick={event => { if (event.target === dialog.current) dialog.current?.close(); }}>
      <button aria-label="关闭图片预览" onClick={() => dialog.current?.close()}>关闭</button>
      {path && <img src={`${api}/${path}`} alt={data.name} />}
    </dialog>
  </>;
}
