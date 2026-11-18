import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useReactFlow, useViewport } from '@xyflow/react';

type IconName = 'plus' | 'minus' | 'trash' | 'undo' | 'redo' | 'fit' | 'check' | 'chevron' | 'close';
const icons: Record<IconName, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" />,
  undo: <path d="M8 5 3 10l5 5M3 10h11a5 5 0 0 1 0 10h-3" />,
  redo: <path d="m16 5 5 5-5 5M21 10H10a5 5 0 0 0 0 10h3" />,
  fit: <path d="M9 4H4v5M15 4h5v5M4 15v5h5M20 15v5h-5" />,
  check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>,
  chevron: <path d="m6 9 6 6 6-6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
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

export function DetailsPanel({ title, visible = true, children }: { title: string; visible?: boolean; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const contentId = useId();
  if (!visible) return null;
  return <aside className={`details-panel surface${collapsed ? ' is-collapsed' : ''}`} aria-label="对象详情">
    <div className="details-header">
      <h2>{title}</h2>
      <button className="collapse-button" aria-label={collapsed ? '展开详情' : '折叠详情'} aria-expanded={!collapsed} aria-controls={contentId} title={collapsed ? '展开详情' : '折叠详情'} onClick={() => setCollapsed(value => !value)}><Icon name="chevron" /></button>
    </div>
    <div id={contentId} className="details-content" hidden={collapsed}>
      {children}
    </div>
  </aside>;
}

export interface CanvasMenuState {
  x: number;
  y: number;
  position: { x: number; y: number };
  nodeIds: string[];
}

export function CanvasMenu({ menu, disabled, onCreate, additionalCreates, children, onDelete, onClose }: {
  menu: CanvasMenuState;
  disabled: boolean;
  onCreate?: () => void;
  children?: ReactNode;
  additionalCreates?: Array<{ label: string; run: () => void }>;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: menu.x, y: menu.y });
  useLayoutEffect(() => {
    const element = ref.current!;
    const bounds = element.getBoundingClientRect();
    const parent = element.parentElement!.getBoundingClientRect();
    setPosition({
      x: Math.max(12, Math.min(menu.x, parent.width - bounds.width - 12)),
      y: Math.max(12, Math.min(menu.y, parent.height - bounds.height - 12)),
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
    {onCreate && <button role="menuitem" disabled={disabled} onClick={onCreate}><Icon name="plus" />新增节点</button>}
    {additionalCreates?.map(action => <button key={action.label} role="menuitem" disabled={disabled} onClick={action.run}><Icon name="plus" />{action.label}</button>)}
    {children}
    <button role="menuitem" disabled={disabled || !menu.nodeIds.length} onClick={onDelete}><Icon name="trash" />删除节点{menu.nodeIds.length > 1 && <span className="menu-count">{menu.nodeIds.length}</span>}</button>
  </div>;
}
