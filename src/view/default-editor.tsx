import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useEditorState } from './use-editor.js';
import type { NodeLayout } from '../runtime/document.js';
import type { Editor as EditorController } from './editor-store.js';
import type { Autosave } from '../runtime/client/autosave.js';
import { CanvasControls, CanvasMenu, Icon, type CanvasMenuState } from './editor-overlays.js';
import { GraphCanvas, type CanvasSelection } from './graph-canvas.js';
import { isCanvasControl, type NodeRenderer } from './node-shell.js';
import { SelectionDetails } from './selection-details.js';

export interface DefaultEditorProps {
  editor: EditorController;
  saver: Autosave;
  namespace?: string;
  activity?: string;
  renderNode?: NodeRenderer;
  renderDetails?: (selection: CanvasSelection) => ReactNode;
  onOpenNode?: (nodeId: string) => void;
  nodeActions?: Array<{ label: string; create: (position: { x: number; y: number }) => void }>;
  onConnect?: (source: string, target: string) => string | null;
}

export function DefaultEditor({ editor, saver, namespace, activity, renderNode, renderDetails, onOpenNode, nodeActions, onConnect }: DefaultEditorProps) {
  const state = useEditorState(editor);
  const flow = useReactFlow();
  const canvas = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<CanvasMenuState | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const dismissMenu = useCallback(() => { setMenu(null); canvas.current?.focus({ preventScroll: true }); }, []);
  const nodeIds = useMemo(() => Object.keys(state.nodes), [state.nodes]);
  const edges = useMemo(() => Object.values(state.edges), [state.edges]);
  const displayedLayouts = useMemo(() => {
    const layouts: Record<string, NodeLayout> = {};
    nodeIds.forEach((nodeId, index) => {
      layouts[nodeId] = state.previewLayouts[nodeId] ?? state.layouts[nodeId] ?? { nodeId, x: index % 4 * 240, y: Math.floor(index / 4) * 140 };
    });
    return layouts;
  }, [nodeIds, state.layouts, state.previewLayouts]);
  const canEdit = state.loaded && !state.loading;
  const dirty = Boolean(state.inFlight || Object.keys(state.pending).length);
  const status = state.loading ? '读取中' : state.error ? (state.error.phase === 'load' ? '读取失败' : '保存失败') : activity ? activity : state.inFlight ? '保存中' : dirty ? '待保存' : '已保存';

  const deleteSelected = state.deleteSelection;
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isCanvasControl(event.target)) return;
      const current = editor.getState();
      if (!current.loaded || current.loading) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) current.redo(); else current.undo();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (current.selectedNodes.length || current.selectedEdges.length) {
          event.preventDefault();
          deleteSelected();
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editor, deleteSelected]);

  function openMenu(event: ReactMouseEvent | MouseEvent, nodeIds: string[]) {
    event.preventDefault();
    event.stopPropagation();
    const current = editor.getState();
    if (!canEdit || !current.loaded || current.loading) return;
    current.select(nodeIds, []);
    const rect = canvas.current!.getBoundingClientRect();
    setMenu({ x: event.clientX - rect.left, y: event.clientY - rect.top, position: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }), nodeIds });
  }
  return <section className="editor-shell" data-testid="main-editor" aria-label="项目画布">
    <div className="canvas" ref={canvas} tabIndex={-1} aria-label="节点画布">
      <GraphCanvas id="main-flow" viewKey={state.project!.id}
        nodeIds={nodeIds} edges={edges} positions={displayedLayouts}
        selection={{ nodes: state.selectedNodes, edges: state.selectedEdges }} enabled={canEdit} renderNode={renderNode}
        onSelect={update => {
          const current = editor.getState();
          const next = update({ nodes: current.selectedNodes, edges: current.selectedEdges });
          current.select(next.nodes, next.edges);
        }}
        onConnect={connection => {
          if (onConnect) setConnectionError(onConnect(connection.source, connection.target));
          else state.createEdge(connection.source, connection.target);
        }}
        onPreviewPositions={state.previewPositions}
        onCommitPositions={state.commitPositions}
        onOpenNode={onOpenNode} onContextMenu={openMenu} onInteractionStart={closeMenu} />
    </div>
    <header className="editor-header">
      <a className="wordmark" href={'/?' + new URLSearchParams({ business: state.project!.business, selected: state.project!.id })} aria-label="返回首页">uknode <small>{state.project!.name}</small></a>
      <output className={`save-status${state.error ? ' is-error' : dirty || activity ? ' is-pending' : ''}`} aria-live="polite" data-testid="save-status"><Icon name="check" />{status}</output>
    </header>
    <div className="toolbar surface" role="group" aria-label="图编辑工具">
      {!nodeActions && <button aria-label="新增节点" title="新增节点" disabled={!canEdit} onClick={() => {
        const rect = canvas.current!.getBoundingClientRect();
        const offset = Object.keys(state.nodes).length % 6 * 24;
        const position = flow.screenToFlowPosition({ x: rect.x + rect.width / 2 + offset, y: rect.y + rect.height / 2 + offset });
        state.createNode(position.x - 86, position.y - 27);
      }}><Icon name="plus" /><span>新增节点</span></button>}
      <button aria-label="删除选中" title="删除选中对象" disabled={!canEdit || (!state.selectedNodes.length && !state.selectedEdges.length)} onClick={deleteSelected}><Icon name="trash" /><span>删除选中</span></button>
      <span className="control-divider" />
      <button aria-label="撤销" title="撤销（Ctrl / ⌘ Z）" disabled={!canEdit || !state.canUndo} onClick={state.undo}><Icon name="undo" /><span>撤销</span></button>
      <button aria-label="重做" title="重做（Ctrl / ⌘ Shift Z）" disabled={!canEdit || !state.canRedo} onClick={state.redo}><Icon name="redo" /><span>重做</span></button>
    </div>
    <p className="canvas-hint">拖动框选<span>·</span>空格拖动平移<span>·</span>右键新增</p>
    {!nodeIds.length && canEdit && <div className="empty-hint">
      右键新增节点
      {nodeActions ? <small>{nodeActions.map(action => action.label).join(' · ')}</small>
        : <small>也可以使用下方工具栏</small>}
    </div>}
    <CanvasControls />
    <SelectionDetails structural={!namespace} state={state} layouts={displayedLayouts} renderDetails={renderDetails} />
    {menu && <CanvasMenu menu={menu} disabled={!canEdit} onClose={dismissMenu} onCreate={nodeActions ? undefined : () => {
      if (canEdit) state.createNode(menu.position.x, menu.position.y);
      dismissMenu();
    }} additionalCreates={nodeActions?.map(action => ({ label: action.label, run: () => {
      action.create(menu.position); dismissMenu();
    } }))} onDelete={() => {
      if (canEdit) { state.select(menu.nodeIds, []); deleteSelected(); }
      dismissMenu();
    }} />}
    {(connectionError || state.editMessage) && <div className="interaction-message surface" role="alert">{state.editMessage || connectionError}<button onClick={() => { setConnectionError(null); editor.session.setState({ editMessage: null }); }}>关闭</button></div>}
    {state.error && <div className="save-error surface" role="alert">
      <span>{state.error.message} </span>
      {state.error.retryable && <button onClick={() => void saver.retry()}>重试</button>}
      {state.loaded && <button onClick={() => {
        if (!dirty || window.confirm('重新读取会放弃本页尚未确认的修改，并清空会话撤销记录。继续？')) void saver.load();
      }}>重新读取</button>}
    </div>}
  </section>;
}
