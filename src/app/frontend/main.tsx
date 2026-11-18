import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { useStore } from 'zustand';
import axios from 'axios';
import '@xyflow/react/dist/style.css';
import '../../view/styles.css';
import { Home } from './Home.js';
import { App } from '../../view/App.js';
import { createSessionStore } from '../../runtime/client/session.js';
import { createEditor, type Editor } from '../../view/editor-store.js';
import { Autosave } from '../../runtime/client/autosave.js';

const VideoEditor = lazy(async () => ({ default: (await import('../../ext/ai-video/VideoEditor.js')).VideoEditor }));
const query = new URLSearchParams(location.search);
const initialNodeId = query.get('node') ?? undefined;

function ProjectPage({ editor, saver }: { editor: Editor; saver: Autosave }) {
  const project = useStore(editor.session, state => state.project);
  const error = useStore(editor.session, state => state.error);
  if (!project) return <main className="home"><a href="/">返回首页</a>
    {error ? <p role="alert">{error.message} <button onClick={() => void saver.load()}>重新读取</button></p> : <p role="status">读取中…</p>}
  </main>;
  return project.business === 'ai-video'
    ? <Suspense fallback={<p role="status">读取中…</p>}><VideoEditor editor={editor} saver={saver} initialNodeId={initialNodeId} /></Suspense>
    : <App editor={editor} saver={saver} initialNodeId={initialNodeId} />;
}

const root = createRoot(document.getElementById('root')!);
const projectId = query.get('project');
if (projectId) {
  const session = createSessionStore();
  const editor = createEditor(session);
  const saver = new Autosave(session, axios.create({ baseURL: '/api/projects/' + encodeURIComponent(projectId), timeout: 10000 }));
  function beforeUnload(event: BeforeUnloadEvent) {
    const state = session.getState();
    if (state.inFlight || Object.keys(state.pending).length) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
  window.addEventListener('beforeunload', beforeUnload);
  root.render(<ProjectPage editor={editor} saver={saver} />);
  void saver.load();
  if (import.meta.hot) import.meta.hot.dispose(() => { window.removeEventListener('beforeunload', beforeUnload); saver.dispose(); editor.dispose(); });
} else {
  root.render(<Home />);
}
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
