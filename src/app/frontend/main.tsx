import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import '../../view/styles.css';
import { VideoEditor } from '../../ext/ai-video/VideoEditor.js';
import { createSessionStore } from '../../runtime/client/session.js';
import { createEditor } from '../../view/editor-store.js';
import { Autosave } from '../../runtime/client/autosave.js';

const session = createSessionStore();
const editor = createEditor(session);
const saver = new Autosave(session);
const root = createRoot(document.getElementById('root')!);
root.render(<VideoEditor editor={editor} saver={saver} />);
void saver.load();

if (import.meta.hot) import.meta.hot.dispose(() => { saver.dispose(); editor.dispose(); root.unmount(); });
