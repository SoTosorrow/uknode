import { useState } from 'react';
import { useStore } from 'zustand';
import type { SessionStore } from '../../runtime/client/session.js';
import { NodeControls } from '../../view/node-shell.js';
import { videoData, type PromptData, type OutputData } from './model.js';
import { updateVideoNode, moveInput } from './actions.js';
import { ImageEditor } from './ImageEditor.js';
import { useVideoInputs } from './input-view.js';
import { buildConfig } from './config.js';

type Props = { nodeId: string; session: SessionStore };
const titles = { image: '参考图片', prompt: '提示词', output: '视频配置' };

function PromptEditor({ nodeId, session, data }: Props & { data: PromptData }) {
  return <textarea className="video-prompt" aria-label="提示词" maxLength={20000} placeholder="描述画面、动作和镜头，例如：图1中的角色穿行在图2的场景中…"
    value={data.text} onChange={event => updateVideoNode(session, nodeId, { ...data, text: event.target.value }, 'text')} />;
}

function OutputEditor({ nodeId, session, data }: Props & { data: OutputData }) {
  const inputs = useVideoInputs(nodeId);
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
        const kind = input.kind === 'unavailable' ? input.sourceKind : input.kind;
        const label = kind === 'image' ? `图${++imageNumber}` : kind === 'prompt' ? `提示词${++promptNumber}` : '无效输入';
        const summary = input.kind === 'unavailable' ? `${input.reason} · ${input.nodeId}` : input.kind === 'image' ? input.name || input.path : input.text;
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
  const data = useStore(session, state => videoData(state, nodeId));
  return data?.kind === 'output' ? <OutputDetails key={nodeId} nodeId={nodeId} session={session} data={data} /> : null;
}

function OutputDetails({ session, nodeId, data }: Props & { data: OutputData }) {
  const inputs = useVideoInputs(nodeId);
  const saving = useStore(session, state => Boolean(state.loading || state.error || state.inFlight || Object.keys(state.pending).length));
  const [message, setMessage] = useState('');
  const { config, errors } = buildConfig(data, inputs);
  const json = config ? JSON.stringify(config, null, 2) : '';
  const disabled = !config || saving;
  function download() {
    const url = URL.createObjectURL(new Blob([json + '\n'], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `${config!.output_filename}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="video-export" aria-label="JSON 配置">
    <h3>JSON 配置</h3>
    {errors.length ? <ul className="video-error">{errors.map(error => <li key={error}>{error}</li>)}</ul>
      : <textarea aria-label="JSON 预览" readOnly value={json} spellCheck={false} />}
    <div className="video-export-actions"><button disabled={disabled} onClick={download}>下载 JSON</button>
      <button disabled={disabled} onClick={() => { void navigator.clipboard.writeText(json).then(() => setMessage('已复制'), () => setMessage('复制失败，请从预览框手动复制')); }}>复制 JSON</button></div>
    <p className="video-muted">图片路径相对于 data/ext/ai-video。等待保存完成后可导出。</p>
    <output aria-live="polite">{message}</output>
  </section>;
}
