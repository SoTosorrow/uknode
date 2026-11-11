import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useStore } from 'zustand';
import {
  ReactFlow, ReactFlowProvider, Background, BaseEdge, EdgeLabelRenderer, MarkerType, Position, SelectionMode, useReactFlow,
  type Node, type Edge, type EdgeProps, type NodeChange, type EdgeChange,
} from '@xyflow/react';
import type { NodeLayout } from '../shared/model.js';
import type { GraphStore } from './graph-store.js';
import type { Autosave } from './autosave.js';
import { CanvasControls, CanvasMenu, DetailsPanel, Icon, type CanvasMenuState } from './editor-overlays.js';
import { MembershipDialog } from './membership-dialog.js';
import { projectScope } from './scope.js';

type Relation = Edge<{ offset: number; selfIndex: number }>;

function RelationEdge(props: EdgeProps<Relation>) {
  const { sourceX: sx, sourceY: sy, targetX: tx, targetY: ty } = props;
  const length = Math.hypot(tx - sx, ty - sy) || 1;
  const offset = (props.data?.offset || 0) * (props.source < props.target ? 1 : -1);
  const cx = (sx + tx) / 2 - (ty - sy) / length * offset;
  const cy = (sy + ty) / 2 + (tx - sx) / length * offset;
  const loop = 80 + (props.data?.selfIndex || 0) * 30;
  const self = props.source === props.target;
  const path = self
    ? `M ${sx} ${sy} C ${sx + loop} ${sy - loop * 2}, ${tx - loop} ${ty - loop * 2}, ${tx} ${ty}`
    : `M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`;
  const labelX = self ? (sx + tx) / 2 : (sx + 2 * cx + tx) / 4;
  const labelY = self ? (sy + ty) / 2 - loop * 1.5 : (sy + 2 * cy + ty) / 4;
  return <>
    <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} style={props.style} />
    {props.label && <EdgeLabelRenderer><span className={`edge-label${props.selected ? ' is-selected' : ''}`} style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>{props.label}</span></EdgeLabelRenderer>}
  </>;
}

const edgeTypes = { relation: RelationEdge };
const noPreviews: Record<string, NodeLayout> = {};

function Editor({ store, saver, contextNodeId }: { store: GraphStore; saver: Autosave; contextNodeId: string | null }) {
  const currentState = useStore(store);
  const active = currentState.contextNodeId === contextNodeId;
  const inDialog = contextNodeId !== null;
  const state = active ? currentState : {
    ...currentState, contextNodeId,
    selectedNodes: currentState.mainSelection?.nodes ?? [],
    selectedEdges: currentState.mainSelection?.edges ?? [],
  };
  const previews = active ? state.previewLayouts : noPreviews;
  const flow = useReactFlow();
  const dragBefore = useRef<NodeLayout[]>([]);
  const canvas = useRef<HTMLDivElement>(null);
  const fittedScope = useRef<string | undefined>(undefined);
  const [menu, setMenu] = useState<CanvasMenuState | null>(null);
  const [connecting, setConnecting] = useState(false);
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
  // Keep labels and edge grouping stable during drag previews and selection.
  const nodeTemplates = useMemo<Node[]>(() => scope.nodeIds.map(id => ({
    id, data: { label: id.slice(0, 8) },
    position: scope.layouts[id],
    sourcePosition: Position.Right, targetPosition: Position.Left,
  })), [scope, state.contextNodeId]);
  const nodes = useMemo<Node[]>(() => nodeTemplates.map(node => ({
    ...node, position: displayedLayouts[node.id], selected: state.selectedNodes.includes(node.id),
  })), [nodeTemplates, displayedLayouts, state.selectedNodes]);
  const edges = useMemo<Relation[]>(() => {
    const groups = new Map<string, string[]>();
    for (const edge of scope.edges) {
      const key = [edge.source, edge.target].sort().join(':');
      groups.set(key, [...(groups.get(key) || []), edge.id]);
    }
    return scope.edges.map(edge => {
      const group = groups.get([edge.source, edge.target].sort().join(':'))!;
      const index = group.indexOf(edge.id);
      const selected = state.selectedEdges.includes(edge.id);
      return {
        ...edge, type: 'relation', selected,
        markerEnd: edge.directed ? { type: MarkerType.ArrowClosed, color: selected ? '#386bfa' : '#a0a8b5' } : undefined,
        data: { offset: (index - (group.length - 1) / 2) * 50, selfIndex: index },
      };
    });
  }, [scope, state.selectedEdges]);
  const canEdit = active && state.loaded && !state.loading;
  const dirty = Boolean(state.inFlight || Object.keys(state.pending).length);
  const status = state.loading ? '读取中' : state.error ? (state.error.phase === 'load' ? '读取失败' : '保存失败') : state.inFlight ? '保存中' : dirty ? '待保存' : '已保存';

  useEffect(() => {
    const scopeKey = state.contextNodeId ?? 'global';
    if (!active || !state.loaded || fittedScope.current === scopeKey) return;
    // Fit existing data once. An empty canvas must keep the first context-created
    // node at the clicked position instead of moving the viewport after creation.
    if (!nodes.length) { fittedScope.current = scopeKey; return; }
    // fitView queues its own measurement; node dimensions stay in React Flow
    // rather than becoming part of the persisted graph state.
    if (flow.viewportInitialized) {
      fittedScope.current = scopeKey;
      void flow.fitView({ padding: 0.25, maxZoom: 1 });
    }
  }, [active, state.loaded, state.contextNodeId, nodes.length, flow]);

  useEffect(() => { closeMenu(); }, [active, state.contextNodeId, closeMenu]);

  const deleteSelected = useCallback(() => {
    const current = store.getState(), selected = new Set(current.selectedNodes);
    if (current.contextNodeId !== contextNodeId) return;
    const references = Object.values(current.memberships).filter(m => selected.has(m.containerId) || selected.has(m.memberId));
    if (references.length && !window.confirm(`彻底删除 ${selected.size} 个节点，将清理 ${references.length} 条收录关系及关联连线。未选中的成员节点会保留。继续？`)) return;
    current.deleteSelection();
  }, [store, contextNodeId]);

  useEffect(() => {
    if (!active) return;
    function onKeyDown(event: KeyboardEvent) {
      if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"], [role="menu"]')) return;
      const current = store.getState();
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
  }, [active, contextNodeId, store, deleteSelected]);

  function onNodesChange(changes: NodeChange[]) {
    const current = store.getState();
    if (current.contextNodeId !== contextNodeId) return;
    const selection = new Set(current.selectedNodes);
    let currentScope: ReturnType<typeof projectScope> | undefined;
    const previews: NodeLayout[] = [], before: NodeLayout[] = [], after: NodeLayout[] = [];
    for (const change of changes) {
      if (change.type === 'select') { if (change.selected) selection.add(change.id); else selection.delete(change.id); }
      if (change.type === 'position' && change.position) {
        const layout = { contextNodeId: current.contextNodeId, nodeId: change.id, ...change.position };
        // React Flow also emits dragging:false for keyboard movement. Outside
        // an active mouse drag this is a complete edit, not a preview frame.
        if (change.dragging !== true && !dragBefore.current.length) {
          currentScope ??= projectScope(current, current.contextNodeId, current.previewLayouts);
          if (currentScope.layouts[change.id]) { before.push(currentScope.layouts[change.id]); after.push(layout); }
        } else previews.push(layout);
      }
    }
    current.select([...selection], current.selectedEdges);
    if (previews.length) current.previewPositions(previews);
    if (after.length) current.commitPositions(before, after);
  }
  function onEdgesChange(changes: EdgeChange[]) {
    const current = store.getState(), selection = new Set(current.selectedEdges);
    if (current.contextNodeId !== contextNodeId) return;
    for (const change of changes) if (change.type === 'select') {
      if (change.selected) selection.add(change.id); else selection.delete(change.id);
    }
    current.select(current.selectedNodes, [...selection]);
  }

  function openMenu(event: ReactMouseEvent | MouseEvent, nodeId?: string, selectedIds?: string[]) {
    event.preventDefault();
    event.stopPropagation();
    const current = store.getState();
    if (!canEdit || !current.loaded || current.loading) return;
    const nodeIds = selectedIds ?? (nodeId ? current.selectedNodes.includes(nodeId) ? current.selectedNodes : [nodeId] : []);
    current.select(nodeIds, []);
    const rect = canvas.current!.getBoundingClientRect();
    setMenu({ x: event.clientX - rect.left, y: event.clientY - rect.top, position: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }), nodeIds });
  }
  function startDrag(moved: Node[]) {
    closeMenu();
    const current = store.getState();
    const currentScope = projectScope(current, current.contextNodeId);
    dragBefore.current = moved.map(node => currentScope.layouts[node.id]).filter(Boolean);
  }
  function finishDrag(moved: Node[]) {
    const current = store.getState();
    current.commitPositions(dragBefore.current, moved.map(node => ({ contextNodeId: current.contextNodeId, nodeId: node.id, ...node.position })));
    dragBefore.current = [];
  }

  return <section className={`editor-shell${inDialog ? ' dialog-editor' : ''}${connecting ? ' is-connecting' : ''}`} data-testid={inDialog ? 'member-editor' : 'main-editor'} aria-label={inDialog ? '直接成员画布' : '主画布'}>
    <div className="canvas" ref={canvas} tabIndex={-1} aria-label="节点画布">
      <ReactFlow id={inDialog ? 'members-flow' : 'main-flow'} nodes={nodes} edges={edges} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        onConnect={connection => state.createEdge(connection.source, connection.target)}
        onConnectStart={() => { setConnecting(true); closeMenu(); }} onConnectEnd={() => setConnecting(false)}
        nodesDraggable={canEdit} nodesConnectable={canEdit} elementsSelectable={canEdit}
        selectionOnDrag selectionKeyCode={null} selectionMode={SelectionMode.Full} multiSelectionKeyCode={active ? 'Shift' : null}
        panOnDrag={active ? [1] : false} panActivationKeyCode={active ? 'Space' : null} minZoom={0.25} maxZoom={2} zoomOnDoubleClick={false}
        deleteKeyCode={null}
        onPaneClick={() => { state.select([], []); closeMenu(); }}
        onNodeDoubleClick={(_, node) => state.openScope(node.id)}
        onPaneContextMenu={event => openMenu(event)} onNodeContextMenu={(event, node) => openMenu(event, node.id)}
        onSelectionContextMenu={(event, selected) => openMenu(event, undefined, selected.map(node => node.id))}
        onMoveStart={closeMenu} onSelectionStart={closeMenu}
        onNodeDragStart={(_, node, moved) => startDrag(moved.length ? moved : [node])}
        onNodeDragStop={(_, node, moved) => finishDrag(moved.length ? moved : [node])}
        onSelectionDragStart={(_, moved) => startDrag(moved)} onSelectionDragStop={(_, moved) => finishDrag(moved)}>
        <Background color="#dce3ed" gap={22} size={1} />
      </ReactFlow>
    </div>
    <header className="editor-header">
      {inDialog ? <span className="canvas-caption">仅显示直接成员</span> : <strong className="wordmark">uknode</strong>}
      <output className={`save-status${state.error ? ' is-error' : dirty ? ' is-pending' : ''}`} aria-live={active ? 'polite' : 'off'} data-testid={inDialog ? 'dialog-save-status' : 'save-status'}><Icon name="check" />{status}</output>
    </header>
    <div className="toolbar surface" role="group" aria-label="图编辑工具">
      <button aria-label="新增节点" title="新增节点" disabled={!canEdit} onClick={() => {
        const rect = canvas.current!.getBoundingClientRect();
        const offset = Object.keys(state.nodes).length % 6 * 24;
        const position = flow.screenToFlowPosition({ x: rect.x + rect.width / 2 + offset, y: rect.y + rect.height / 2 + offset });
        state.createNode(position.x - 86, position.y - 27);
      }}><Icon name="plus" /><span>新增节点</span></button>
      {inDialog && <button aria-label="解除收录" title="解除选中节点的收录（Delete）" disabled={!canEdit || !state.selectedNodes.length} onClick={state.removeSelectedMemberships}><Icon name="unlink" /><span>解除收录</span></button>}
      <button aria-label={inDialog ? '彻底删除选中' : '删除选中'} title="彻底删除选中对象，影响所有引用" disabled={!canEdit || (!state.selectedNodes.length && !state.selectedEdges.length)} onClick={deleteSelected}><Icon name="trash" /><span>{inDialog ? '彻底删除' : '删除选中'}</span></button>
      <span className="control-divider" />
      <button aria-label="撤销" title="撤销（Ctrl / ⌘ Z）" disabled={!canEdit || !state.past.length} onClick={state.undo}><Icon name="undo" /><span>撤销</span></button>
      <button aria-label="重做" title="重做（Ctrl / ⌘ Shift Z）" disabled={!canEdit || !state.future.length} onClick={state.redo}><Icon name="redo" /><span>重做</span></button>
    </div>
    <p className="canvas-hint">拖动框选<span>·</span>空格拖动平移<span>·</span>右键新增</p>
    {!nodes.length && canEdit && <div className="empty-hint">{inDialog ? '尚未收录节点' : '右键新增节点'}<small>{inDialog ? '在这里新增，或从上方收录已有节点' : '也可以使用下方工具栏'}</small></div>}
    <CanvasControls />
    <DetailsPanel state={state} saver={saver} layouts={displayedLayouts} />
    {menu && <CanvasMenu menu={menu} disabled={!canEdit} onClose={dismissMenu} onCreate={() => {
      if (canEdit) state.createNode(menu.position.x, menu.position.y);
      dismissMenu();
    }} onDelete={() => {
      if (canEdit) { state.select(menu.nodeIds, []); deleteSelected(); }
      dismissMenu();
    }} onDetach={inDialog ? () => {
      if (canEdit) { state.select(menu.nodeIds, []); state.removeSelectedMemberships(); }
      dismissMenu();
    } : undefined} />}
    {state.error && <div className="save-error surface" role="alert">
      <span>{state.error.message} </span>
      {state.error.retryable && <button onClick={() => void saver.retry()}>重试</button>}
      {state.loaded && <button onClick={() => {
        if (!dirty || window.confirm('重新读取会放弃本页尚未确认的修改，并清空会话撤销记录。继续？')) void saver.load();
      }}>重新读取</button>}
    </div>}
  </section>;
}

export function App(props: { store: GraphStore; saver: Autosave }) {
  const contextNodeId = useStore(props.store, state => state.contextNodeId);
  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      const current = props.store.getState();
      if (current.inFlight || Object.keys(current.pending).length) { event.preventDefault(); event.returnValue = ''; }
    }
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [props.store]);
  return <>
    <ReactFlowProvider><Editor {...props} contextNodeId={null} /></ReactFlowProvider>
    {contextNodeId !== null && <MembershipDialog store={props.store}>
      <ReactFlowProvider><Editor {...props} contextNodeId={contextNodeId} /></ReactFlowProvider>
    </MembershipDialog>}
  </>;
}
