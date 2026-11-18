import { useEffect, useState, type FormEvent } from 'react';
import axios from 'axios';
import type { Project } from '../../core/model.js';
import type { GraphData } from '../../runtime/document.js';
import { namespace, videoSummary, type VideoData } from '../../ext/ai-video/model.js';
import './home.css';

function errorMessage(error: unknown) {
  return axios.isAxiosError(error) ? error.response?.data?.message ?? '无法连接本地服务' : '读取失败';
}

function Overview({ project }: { project: Project }) {
  const [graph, setGraph] = useState<GraphData>();
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    axios.get<GraphData>('/api/projects/' + project.id + '/graph', { signal: controller.signal })
      .then(({ data }) => setGraph(data)).catch(e => { if (!controller.signal.aborted) setError(errorMessage(e)); });
    return () => controller.abort();
  }, [project.id]);
  const summaries = new Map(graph?.attachments.filter(a => a.namespace === namespace)
    .map(a => [a.nodeId, videoSummary(a.data as VideoData)]));
  return <section className="home-overview" aria-label="项目概览">
    <header className="overview-heading"><h2>{project.name}</h2><a href={'/?project=' + project.id}>进入画布 →</a></header>
    {error ? <p role="alert">{error}</p> : !graph ? <p role="status">读取中…</p> : <>
      <h3>节点 <span>{graph.nodes.length}</span></h3>
      {graph.nodes.length ? <ul className="overview-list" aria-label="节点">{graph.nodes.map(({ id }) =>
        <li key={id} id={'node-' + id}><code>{id}</code><span>{summaries.get(id)}</span></li>)}</ul> : <p>暂无节点</p>}
      <h3>连线 <span>{graph.edges.length}</span></h3>
      {graph.edges.length ? <ul className="overview-list" aria-label="连线">{graph.edges.map(edge => <li key={edge.id}>
        <a href={'#node-' + edge.source}><code>{edge.source}</code></a>
        <span aria-label={edge.directed ? '有向' : '无向'}>{edge.directed ? '→' : '—'}</span>
        <a href={'#node-' + edge.target}><code>{edge.target}</code></a>
      </li>)}</ul> : <p>暂无连线</p>}
    </>}
  </section>;
}

const query = new URLSearchParams(location.search);
export function Home() {
  const [business, setBusiness] = useState(query.get('business') === 'basic' ? 'basic' : namespace);
  const [projects, setProjects] = useState<Project[]>();
  const [selectedId, select] = useState(query.get('selected'));
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    axios.get<Project[]>('/api/projects', { signal: controller.signal }).then(({ data }) => setProjects(data))
      .catch(e => { if (!controller.signal.aborted) setError(errorMessage(e)); });
    return () => controller.abort();
  }, []);
  const items = projects?.filter(p => p.business === business);
  const selected = items?.find(p => p.id === selectedId) ?? items?.[0];
  async function create(event: FormEvent) {
    event.preventDefault();
    if (creating || !name.trim()) return;
    setCreating(true); setError('');
    try {
      const { data } = await axios.post<Project>('/api/projects', { business, name: name.trim() });
      setProjects(previous => [...(previous ?? []), data]);
      select(data.id); setName('');
    } catch (e) { setError(errorMessage(e)); }
    finally { setCreating(false); }
  }
  return <main className="home">
    <header className="home-heading"><strong>uknode</strong><h1>业务选择</h1></header>
    <div className="business-options" role="group" aria-label="选择业务">
      <button aria-pressed={business === namespace} disabled={creating} onClick={() => setBusiness(namespace)}>视频流程</button>
      <button aria-pressed={business === 'basic'} disabled={creating} onClick={() => setBusiness('basic')}>普通画布</button>
    </div>
    {error && <p role="alert">{error}</p>}
    <div className="project-browser">
      <section className="project-list" aria-label="项目">
        <h2>项目</h2>
        <form onSubmit={create}><input aria-label="项目名称" placeholder="项目名称" maxLength={100} value={name}
          onChange={e => setName(e.target.value)} /><button disabled={!projects || creating || !name.trim()}>新建项目</button></form>
        {!projects && !error && <p role="status">读取中…</p>}
        {items?.map(project => <button className="project-option" key={project.id} aria-pressed={selected?.id === project.id}
          onClick={() => select(project.id)}>{project.name}</button>)}
      </section>
      {selected ? <Overview key={selected.id} project={selected} /> : projects && <p>创建项目后可查看节点和连线。</p>}
    </div>
  </main>;
}
