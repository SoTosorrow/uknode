import { useEffect, useState } from 'react';
import axios from 'axios';

type ImageReference = { projectId: string; projectName: string; nodeId: string };
type DirectoryListing = { directory: string; files: string[] };
const libraryUrl = '/api/ext/ai-video/library';

function FileReferences({ filename }: { filename: string }) {
  const [references, setReferences] = useState<ImageReference[]>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    axios.get<ImageReference[]>(libraryUrl + '/references', { params: { filename }, signal: controller.signal })
      .then(({ data }) => setReferences(data))
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [filename]);

  if (failed) return <p role="alert">无法读取节点引用</p>;
  if (!references) return <p role="status">正在查询引用…</p>;
  if (!references.length) return <p>当前没有节点使用</p>;
  return <ul aria-label="引用此文件的节点">{references.map(({ projectId, projectName, nodeId }) =>
    <li key={nodeId}><a href={'/?' + new URLSearchParams({ project: projectId, node: nodeId })}>
      {projectName} · <code>{nodeId}</code>
    </a></li>)}</ul>;
}

export default function AssetLibrary() {
  const [listing, setListing] = useState<DirectoryListing>();
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    axios.get<DirectoryListing>(libraryUrl, { signal: controller.signal })
      .then(({ data }) => setListing(data))
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, []);
  return <section className="home-overview asset-library" aria-label="视频素材库">
    <header className="overview-heading"><h2>素材库</h2></header>
    {failed ? <p role="alert">无法读取素材目录</p> : !listing ? <p role="status">读取中…</p> : <>
      <p><code>{listing.directory}</code></p>
      {listing.files.length ? <ul className="asset-files" aria-label="素材文件">{listing.files.map(filename =>
        <li key={filename}>
          <button aria-expanded={expanded === filename} onClick={() => setExpanded(expanded === filename ? null : filename)}>
            <code>{filename}</code>
          </button>
          {expanded === filename && <FileReferences filename={filename} />}
        </li>)}</ul> : <p>暂无素材</p>}
    </>}
  </section>;
}
