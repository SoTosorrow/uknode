import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useReactFlow, useViewport } from '@xyflow/react';
import type { GraphState } from './graph-store.js';
import type { Autosave } from './autosave.js';

type IconName = 'plus' | 'minus' | 'trash' | 'undo' | 'redo' | 'fit' | 'check' | 'chevron';
const icons: Record<IconName, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" />,
  undo: <path d="M8 5 3 10l5 5M3 10h11a5 5 0 0 1 0 10h-3" />,
  redo: <path d="m16 5 5 5-5 5M21 10H10a5 5 0 0 0 0 10h3" />,
  fit: <path d="M9 4H4v5M15 4h5v5M4 15v5h5M20 15v5h-5" />,
  check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>,
  chevron: <path d="m6 9 6 6 6-6" />,
};

export function Icon({ name }: { name: IconName }) {
  return <svg className="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name]}</svg>;
}

export function CanvasControls() {
  const { zoom } = useViewport();
  const flow = useReactFlow();
  return <div className="canvas-controls surface" role="group" aria-label="画布缩放">
    <button aria-label="缩小" title="缩小" disabled={zoom <= 0.25} onClick={() => void flow.zoomOut()}><Icon name="minus" /></button>
    <output aria-label="缩放比例">{Math.round(zoom * 100)}%</output>
    <button aria-label="放大" title="放大" disabled={zoom >= 2} onClick={() => void flow.zoomIn()}><Icon name="plus" /></button>
    <span className="control-divider" />
    <button aria-label="适应画布" title="适应画布" onClick={() => void flow.fitView({ padding: 0.25, maxZoom: 1 })}><Icon name="fit" /></button>
  </div>;
}

export function DetailsPanel({ state, saver }: { state: GraphState; saver: Autosave }) {
  const [collapsed, setCollapsed] = useState(false);
  const nodeIds = state.selectedNodes.filter(id => state.nodes[id]);
  const edgeIds = state.selectedEdges.filter(id => state.edges[id]);
  const node = nodeIds.length === 1 && !edgeIds.length ? state.nodes[nodeIds[0]] : undefined;
  const edge = edgeIds.length === 1 && !nodeIds.length ? state.edges[edgeIds[0]] : undefined;
  const layout = node && state.layouts[node.id];
  if (!nodeIds.length && !edgeIds.length) return null;
  const title = node ? '节点详情' : edge ? '连线详情' : '选中对象';
  return <aside className={`details-panel surface${collapsed ? ' is-collapsed' : ''}`} aria-label="对象详情">
    <div className="details-header">
      <h2>{title}</h2>
      <button className="collapse-button" aria-label={collapsed ? '展开详情' : '折叠详情'} aria-expanded={!collapsed} aria-controls="details-content" title={collapsed ? '展开详情' : '折叠详情'} onClick={() => setCollapsed(value => !value)}><Icon name="chevron" /></button>
    </div>
    <div id="details-content" className="details-content" hidden={collapsed}>
      {node ? <>
        <div className="detail-field"><span>节点 ID</span><code className="full-id">{node.id}</code></div>
        <dl className="coordinate-row"><div><dt>X</dt><dd>{Number((layout?.x ?? 0).toFixed(1))}</dd></div><div><dt>Y</dt><dd>{Number((layout?.y ?? 0).toFixed(1))}</dd></div></dl>
      </> : edge ? <>
        <dl className="endpoint-list">
          <div><dt>起点</dt><dd><code title={edge.source}>{edge.source.slice(0, 8)}</code></dd></div>
          <div><dt>终点</dt><dd><code title={edge.target}>{edge.target.slice(0, 8)}</code></dd></div>
        </dl>
        <label className="detail-field">连线说明<textarea disabled={state.loading} maxLength={300} value={edge.label} placeholder="添加连线说明" onChange={event => state.updateEdge(edge.id, { label: event.target.value })} onBlur={() => void saver.flush()} /></label>
        <label className="direction-field"><input type="checkbox" disabled={state.loading} checked={edge.directed} onChange={event => state.updateEdge(edge.id, { directed: event.target.checked })} />有方向</label>
      </> : <>
        <p className="selection-count">{nodeIds.length} 个节点 · {edgeIds.length} 条连线</p>
        <p className="detail-hint">拖动选区可一起移动，或使用“删除选中”。</p>
      </>}
    </div>
  </aside>;
}

export interface CanvasMenuState {
  x: number;
  y: number;
  position: { x: number; y: number };
  nodeIds: string[];
}

export function CanvasMenu({ menu, disabled, onCreate, onDelete, onClose }: {
  menu: CanvasMenuState;
  disabled: boolean;
  onCreate: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: menu.x, y: menu.y });
  useLayoutEffect(() => {
    const element = ref.current!;
    const bounds = element.getBoundingClientRect();
    setPosition({
      x: Math.max(12, Math.min(menu.x, window.innerWidth - bounds.width - 12)),
      y: Math.max(12, Math.min(menu.y, window.innerHeight - bounds.height - 12)),
    });
    element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }, [menu]);
  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (!ref.current?.contains(event.target as globalThis.Node)) onClose();
    }
    window.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', dismiss, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);
  return <div ref={ref} className="context-menu surface" role="menu" aria-label="画布右键菜单" style={{ left: position.x, top: position.y }} onContextMenu={event => event.preventDefault()} onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); onClose(); return; }
    const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    if (!buttons.length || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
    buttons[next].focus();
  }}>
    <button role="menuitem" disabled={disabled} onClick={onCreate}><Icon name="plus" />新增节点</button>
    <button role="menuitem" disabled={disabled || !menu.nodeIds.length} onClick={onDelete}><Icon name="trash" />删除节点{menu.nodeIds.length > 1 && <span className="menu-count">{menu.nodeIds.length}</span>}</button>
  </div>;
}
