import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useEditorState } from './use-editor.js';
import type { NodeLayout } from '../runtime/document.js';
import type { Editor as EditorController } from './editor-store.js';
import type { Autosave } from '../runtime/client/autosave.js';
import { CanvasControls, CanvasMenu, Icon, type CanvasMenuState } from './editor-overlays.js';
import { GraphCanvas, type CanvasPosition, type CanvasSelection } from './graph-canvas.js';
import { isCanvasControl, type NodeRenderer } from './node-shell.js';
import { SelectionDetails } from './selection-details.js';
import { projectScope } from './scope.js';

export interface DefaultEditorProps {
  editor: EditorController;
  saver: Autosave;
  contextNodeId: string | null;
  namespace?: string;
  activity?: string;
  renderNode?: NodeRenderer;
  renderDetails?: (selection: CanvasSelection) => ReactNode;
  onOpenNode?: (nodeId: string) => void;
  nodeActions?: Array<{ label: string; create: (position: { x: number; y: number }, contextNodeId: string | null) => void }>;
  onConnect?: (source: string, target: string) => string | null;
}

export function DefaultEditor({ editor, saver, contextNodeId, namespace, activity, renderNode, renderDetails, onOpenNode, nodeActions, onConnect }: DefaultEditorProps) {
  const state = useEditorState(editor, contextNodeId, namespace);
  const active = state.active;
  const inDialog = contextNodeId !== null;
  const previews = state.previewLayouts;
  const flow = useReactFlow();
  const canvas = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<CanvasMenuState | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const dismissMenu = useCallback(() => { setMenu(null); canvas.current?.focus({ preventScroll: true }); }, []);
  const scope = useMemo(() => projectScope(state, state.contextNodeId),
    [state.nodes, state.edges, state.memberships, state.layouts, state.contextNodeId]);
  const displayedLayouts = useMemo(() => {
    const layouts = { ...scope.layouts };
    for (const layout of Object.values(previews)) {
      if (layout.contextNodeId === state.contextNodeId && layouts[layout.nodeId]) layouts[layout.nodeId] = layout;
    }
    return layouts;
  }, [scope.layouts, previews, state.contextNodeId]);
  const canEdit = active && state.loaded && !state.loading;
  const dirty = Boolean(state.inFlight || Object.keys(state.pending).length);
  const status = state.loading ? '读取中' : state.error ? (state.error.phase === 'load' ? '读取失败' : '保存失败') : activity ? activity : state.inFlight ? '保存中' : dirty ? '待保存' : '已保存';

  useEffect(() => { closeMenu(); }, [active, state.contextNodeId, closeMenu]);

  const deleteSelected = useCallback(() => {
    const current = editor.getState(), selected = new Set(current.selectedNodes);
    if (current.contextNodeId !== contextNodeId) return;
    const references = Object.values(current.memberships).filter(m => selected.has(m.containerId) || selected.has(m.memberId));
    if (references.length && !window.confirm(`彻底删除 ${selected.size} 个节点，将清理 ${references.length} 条收录关系及关联连线。未选中的成员节点会保留。继续？`)) return;
    current.deleteSelection();
  }, [editor, contextNodeId]);

  useEffect(() => {
    if (!active) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isCanvasControl(event.target)) return;
      const current = editor.getState();
      if (!current.loaded || current.loading || current.contextNodeId !== contextNodeId) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) current.redo(); else current.undo();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (current.selectedNodes.length || current.selectedEdges.length) {
          event.preventDefault();
          if (contextNodeId !== null && current.selectedNodes.length) current.removeSelectedMemberships();
          else deleteSelected();
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, contextNodeId, editor, deleteSelected]);

  function openMenu(event: ReactMouseEvent | MouseEvent, nodeIds: string[]) {
    event.preventDefault();
    event.stopPropagation();
    const current = editor.getState();
    if (!canEdit || !current.loaded || current.loading) return;
    current.select(nodeIds, []);
    const rect = canvas.current!.getBoundingClientRect();
    setMenu({ x: event.clientX - rect.left, y: event.clientY - rect.top, position: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }), nodeIds });
  }
  function scopedPositions(positions: CanvasPosition[]): NodeLayout[] {
    return positions.map(position => ({ ...position, contextNodeId }));
  }

  return <section className={`editor-shell${inDialog ? ' dialog-editor' : ''}`} data-testid={inDialog ? 'member-editor' : 'main-editor'} aria-label={inDialog ? '直接成员画布' : '主画布'}>
    <div className="canvas" ref={canvas} tabIndex={-1} aria-label="节点画布">
      <GraphCanvas id={inDialog ? 'members-flow' : 'main-flow'} viewKey={contextNodeId ?? namespace ?? 'global'}
        nodeIds={scope.nodeIds} edges={scope.edges} positions={displayedLayouts}
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
        onPreviewPositions={positions => state.previewPositions(scopedPositions(positions))}
        onCommitPositions={(before, after) => state.commitPositions(scopedPositions(before), scopedPositions(after))}
        onOpenNode={onOpenNode ?? (namespace ? undefined : state.openScope)} onContextMenu={openMenu} onInteractionStart={closeMenu} />
    </div>
    <header className="editor-header">
      {inDialog ? <span className="canvas-caption">仅显示直接成员</span> : <strong className="wordmark">uknode</strong>}
      <output className={`save-status${state.error ? ' is-error' : dirty || activity ? ' is-pending' : ''}`} aria-live={active ? 'polite' : 'off'} data-testid={inDialog ? 'dialog-save-status' : 'save-status'}><Icon name="check" />{status}</output>
    </header>
    {nodeActions && <div className="node-actions surface" role="group" aria-label="业务节点">
      {nodeActions.map(action => <button key={action.label} disabled={!canEdit} onClick={() => {
        const rect = canvas.current!.getBoundingClientRect();
        const offset = Object.keys(state.nodes).length % 6 * 24;
        const position = flow.screenToFlowPosition({ x: rect.x + rect.width / 2 + offset, y: rect.y + rect.height / 2 + offset });
        action.create(position, contextNodeId);
      }}>{action.label}</button>)}
    </div>}
    <div className="toolbar surface" role="group" aria-label="图编辑工具">
      {!nodeActions && <button aria-label="新增节点" title="新增节点" disabled={!canEdit} onClick={() => {
        const rect = canvas.current!.getBoundingClientRect();
        const offset = Object.keys(state.nodes).length % 6 * 24;
        const position = flow.screenToFlowPosition({ x: rect.x + rect.width / 2 + offset, y: rect.y + rect.height / 2 + offset });
        state.createNode(position.x - 86, position.y - 27);
      }}><Icon name="plus" /><span>新增节点</span></button>}
      {inDialog && <button aria-label="解除收录" title="解除选中节点的收录（Delete）" disabled={!canEdit || !state.selectedNodes.length} onClick={state.removeSelectedMemberships}><Icon name="unlink" /><span>解除收录</span></button>}
      <button aria-label={inDialog ? '彻底删除选中' : '删除选中'} title="彻底删除选中对象，影响所有引用" disabled={!canEdit || (!state.selectedNodes.length && !state.selectedEdges.length)} onClick={deleteSelected}><Icon name="trash" /><span>{inDialog ? '彻底删除' : '删除选中'}</span></button>
      <span className="control-divider" />
      <button aria-label="撤销" title="撤销（Ctrl / ⌘ Z）" disabled={!canEdit || !state.canUndo} onClick={state.undo}><Icon name="undo" /><span>撤销</span></button>
      <button aria-label="重做" title="重做（Ctrl / ⌘ Shift Z）" disabled={!canEdit || !state.canRedo} onClick={state.redo}><Icon name="redo" /><span>重做</span></button>
    </div>
    <p className="canvas-hint">拖动框选<span>·</span>空格拖动平移<span>·</span>右键新增</p>
    {!scope.nodeIds.length && canEdit && <div className="empty-hint">{inDialog ? '尚未收录节点' : '右键新增节点'}<small>{inDialog ? '在这里新增，或从上方收录已有节点' : nodeActions ? '也可以使用上方的业务节点按钮' : '也可以使用下方工具栏'}</small></div>}
    <CanvasControls />
    <SelectionDetails structural={!namespace} state={state} layouts={displayedLayouts} renderDetails={renderDetails} />
    {menu && <CanvasMenu menu={menu} disabled={!canEdit} onClose={dismissMenu} onCreate={nodeActions ? undefined : () => {
      if (canEdit) state.createNode(menu.position.x, menu.position.y);
      dismissMenu();
    }} additionalCreates={nodeActions?.map(action => ({ label: action.label, run: () => {
      action.create(menu.position, contextNodeId); dismissMenu();
    } }))} onDelete={() => {
      if (canEdit) { state.select(menu.nodeIds, []); deleteSelected(); }
      dismissMenu();
    }} onDetach={inDialog ? () => {
      if (canEdit) { state.select(menu.nodeIds, []); state.removeSelectedMemberships(); }
      dismissMenu();
    } : undefined} />}
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
