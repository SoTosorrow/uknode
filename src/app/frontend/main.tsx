import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import '../../view/styles.css';
import { App } from '../../view/App.js';
import { createSessionStore } from '../../runtime/client/session.js';
import { createEditor } from '../../view/editor-store.js';
import { Autosave } from '../../runtime/client/autosave.js';

const VideoEditor = lazy(async () => ({ default: (await import('../../ext/ai-video/VideoEditor.js')).VideoEditor }));
const session = createSessionStore();
const editor = createEditor(session);
const saver = new Autosave(session);
const root = createRoot(document.getElementById('root')!);
const video = new URLSearchParams(location.search).get('view') === 'ai-video';
root.render(<>
  <nav className="canvas-switch" aria-label="切换画布">
    <a href={video ? '/' : undefined} aria-current={!video ? 'page' : undefined}>普通画布</a>
    <a href={video ? undefined : '/?view=ai-video'} aria-current={video ? 'page' : undefined}>视频流程</a>
  </nav>
  {video ? <Suspense fallback={null}><VideoEditor editor={editor} saver={saver} /></Suspense>
    : <App editor={editor} saver={saver} />}
</>);
function beforeUnload(event: BeforeUnloadEvent) {
  const state = session.getState();
  if (state.inFlight || Object.keys(state.pending).length) {
    event.preventDefault();
    event.returnValue = '';
  }
}
window.addEventListener('beforeunload', beforeUnload);
void saver.load();

if (import.meta.hot) import.meta.hot.dispose(() => { window.removeEventListener('beforeunload', beforeUnload); saver.dispose(); editor.dispose(); root.unmount(); });
