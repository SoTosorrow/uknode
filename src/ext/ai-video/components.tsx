import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { SessionStore } from '../../runtime/client/session.js';
import { NodeControls } from '../../view/node-shell.js';
import { videoData, type ImageData, type PromptData, type OutputData } from './model.js';
import { updateVideoNode, moveInput } from './actions.js';
import { useUploads } from './uploads.js';
import { buildConfig, inputsFor } from './config.js';

type Props = { nodeId: string; session: SessionStore };
const titles = { image: '参考图片', prompt: '提示词', output: '视频配置' };
const assetUrl = (path: string) => `/api/ext/ai-video/${path}`;

function ImageEditor({ nodeId, session, data }: Props & { data: ImageData }) {
  const [error, setError] = useState('');
  const { nodeIds, mark } = useUploads();
  const busy = nodeIds.has(nodeId);
  const request = useRef<AbortController | null>(null), dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => () => { request.current?.abort(); mark(nodeId, false); }, [mark, nodeId]);
  async function upload(file: File) {
    if (file.size > 20 * 1024 * 1024) { setError('图片不能超过 20 MB'); return; }
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    mark(nodeId, true); setError('');
    try {
      // Verify the browser can actually decode the selected image before upload.
      const bitmap = await createImageBitmap(file); bitmap.close();
      const response = await axios.post<{ path: string; name: string }>('/api/ext/ai-video/images', file, {
        params: { name: file.name }, headers: { 'Content-Type': 'application/octet-stream' }, signal: controller.signal, timeout: 60000,
      });
      if (!controller.signal.aborted) updateVideoNode(session, nodeId, { kind: 'image', ...response.data });
    } catch (cause) {
      if (!controller.signal.aborted) setError(axios.isAxiosError(cause) ? cause.response?.data?.message ?? '上传失败，请重试' : '无法读取这张图片');
    } finally { if (!controller.signal.aborted) mark(nodeId, false); }
  }
  return <>
    {data.path ? <button className="video-image-preview" aria-label="放大图片" onClick={() => dialog.current?.showModal()}>
      <img src={assetUrl(data.path)} alt={data.name} draggable={false} onError={() => setError('图片读取失败，请重新上传')} />
    </button> : <div className="video-image-empty">上传一张参考图片</div>}
    {data.name && <p className="video-file-name" title={data.name}>{data.name}</p>}
    <label className="video-upload">{busy ? '上传中…' : data.path ? '替换图片' : '上传图片'}
      <input aria-label="上传图片" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => {
        const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file);
      }} />
    </label>
    <small className="video-muted">PNG / JPEG / WebP · 最大 20 MB</small>
    {error && <p className="video-error" role="alert">{error}</p>}
    <dialog ref={dialog} className="video-lightbox" aria-label="图片预览" onClick={event => { if (event.target === dialog.current) dialog.current?.close(); }}>
      <button aria-label="关闭图片预览" onClick={() => dialog.current?.close()}>关闭</button>
      {data.path && <img src={assetUrl(data.path)} alt={data.name} />}
    </dialog>
  </>;
}

function PromptEditor({ nodeId, session, data }: Props & { data: PromptData }) {
  return <textarea className="video-prompt" aria-label="提示词" maxLength={20000} placeholder="描述画面、动作和镜头，例如：图1中的角色穿行在图2的场景中…"
    value={data.text} onChange={event => updateVideoNode(session, nodeId, { ...data, text: event.target.value }, 'text')} />;
}

function OutputEditor({ nodeId, session, data }: Props & { data: OutputData }) {
  const document = useStore(session, useShallow(state => ({ edges: state.edges, attachments: state.attachments })));
  const inputs = inputsFor(document, nodeId);
  let imageNumber = 0, promptNumber = 0;
  return <>
    <label className="video-field">输出文件名<input aria-label="输出文件名" maxLength={100} value={data.outputFilename}
      onChange={event => updateVideoNode(session, nodeId, { ...data, outputFilename: event.target.value }, 'filename')} /></label>
    <label className="video-field">步数<input aria-label="步数" type="number" value={data.steps ?? ''}
      onChange={event => { const value = event.target.value === '' ? null : Number(event.target.value);
        updateVideoNode(session, nodeId, { ...data, steps: value }, 'steps');
      }} /></label>
    <div className="video-input-heading">前序输入 <span>{inputs.length}</span></div>
    {!inputs.length && <p className="video-muted">把图片和提示词连到左侧连接点</p>}
    <ol className="video-inputs" aria-label="前序输入">
      {inputs.map((input, index) => {
        const label = input.data?.kind === 'image' ? `图${++imageNumber}` : input.data?.kind === 'prompt' ? `提示词${++promptNumber}` : '无效输入';
        const summary = input.data?.kind === 'image' ? input.data.name || '未上传' : input.data?.kind === 'prompt' ? input.data.text || '未填写' : input.nodeId;
        return <li key={input.nodeId} data-input-id={input.nodeId}><span className="video-input-label">{label}</span><span className="video-input-summary" title={summary}>{summary}</span>
          <button aria-label={`上移${label}`} disabled={index === 0} onClick={() => moveInput(session, nodeId, input.nodeId, -1)}>↑</button>
          <button aria-label={`下移${label}`} disabled={index === inputs.length - 1} onClick={() => moveInput(session, nodeId, input.nodeId, 1)}>↓</button>
        </li>;
      })}
    </ol>
    <p className="video-muted">图片按顺序编号，提示词按顺序合并。选中本节点查看并导出 JSON。</p>
  </>;
}

export function VideoNode({ nodeId, session }: Props) {
  const data = useStore(session, state => videoData(state, nodeId));
  const loading = useStore(session, state => state.loading);
  if (!data) return nodeId;
  return <article className={`video-node video-node-${data.kind}`}>
    <header><span>{titles[data.kind]}</span><code>{nodeId}</code></header>
    <NodeControls><fieldset disabled={loading}>
      {data.kind === 'image' ? <ImageEditor nodeId={nodeId} session={session} data={data} />
        : data.kind === 'prompt' ? <PromptEditor nodeId={nodeId} session={session} data={data} />
          : <OutputEditor nodeId={nodeId} session={session} data={data} />}
    </fieldset></NodeControls>
  </article>;
}

export function VideoDetails({ nodeId, session }: Props) {
  const state = useStore(session, useShallow(state => ({ edges: state.edges, attachments: state.attachments,
    pending: state.pending, inFlight: state.inFlight, loading: state.loading, error: state.error })));
  const uploads = useUploads();
  const [message, setMessage] = useState('');
  const data = videoData(state, nodeId);
  if (data?.kind !== 'output') return null;
  const { config, errors } = buildConfig(state, nodeId), json = config ? JSON.stringify(config, null, 2) : '';
  const waitingForImage = inputsFor(state, nodeId).some(input => uploads.nodeIds.has(input.nodeId));
  const disabled = waitingForImage || !config || state.loading || Boolean(state.error || state.inFlight || Object.keys(state.pending).length);
  function download() {
    const url = URL.createObjectURL(new Blob([json + '\n'], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `${config!.output_filename}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="video-export" aria-label="JSON 配置">
    <h3>JSON 配置</h3>
    {waitingForImage ? <p role="status">参考图片正在上传，完成后更新配置。</p> : errors.length ? <ul className="video-error">{errors.map(error => <li key={error}>{error}</li>)}</ul>
      : <textarea aria-label="JSON 预览" readOnly value={json} spellCheck={false} />}
    <div className="video-export-actions"><button disabled={disabled} onClick={download}>下载 JSON</button>
      <button disabled={disabled} onClick={() => { void navigator.clipboard.writeText(json).then(() => setMessage('已复制'), () => setMessage('复制失败，请从预览框手动复制')); }}>复制 JSON</button></div>
    <p className="video-muted">图片路径相对于 data/ext/ai-video。等待保存完成后可导出。</p>
    <output aria-live="polite">{message}</output>
  </section>;
}
