import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { App } from './App.js';
import { createGraphStore } from './graph-store.js';
import { Autosave } from './autosave.js';

const store = createGraphStore();
const saver = new Autosave(store);
const root = createRoot(document.getElementById('root')!);
root.render(<App store={store} saver={saver} />);
void saver.load();

if (import.meta.hot) import.meta.hot.dispose(() => { saver.dispose(); root.unmount(); });
