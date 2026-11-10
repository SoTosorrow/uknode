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

function Editor({ store, saver }: { store: GraphStore; saver: Autosave }) {
  const state = useStore(store);
  const flow = useReactFlow();
  const dragBefore = useRef<NodeLayout[]>([]);
  const canvas = useRef<HTMLDivElement>(null);
  const initialViewSet = useRef(false);
  const [menu, setMenu] = useState<CanvasMenuState | null>(null);
  const [connecting, setConnecting] = useState(false);
  const closeMenu = useCallback(() => setMenu(null), []);
  const dismissMenu = useCallback(() => { setMenu(null); canvas.current?.focus({ preventScroll: true }); }, []);
  const nodes = useMemo<Node[]>(() => Object.values(state.nodes).map(node => ({
    id: node.id, data: { label: node.id.slice(0, 8) },
    position: state.layouts[node.id] || { x: 0, y: 0 },
    sourcePosition: Position.Right, targetPosition: Position.Left,
    selected: state.selectedNodes.includes(node.id),
  })), [state.nodes, state.layouts, state.selectedNodes]);
  const edges = useMemo<Relation[]>(() => {
    const groups = new Map<string, string[]>();
    for (const edge of Object.values(state.edges)) {
      const key = [edge.source, edge.target].sort().join(':');
      groups.set(key, [...(groups.get(key) || []), edge.id]);
    }
    return Object.values(state.edges).map(edge => {
      const group = groups.get([edge.source, edge.target].sort().join(':'))!;
      const index = group.indexOf(edge.id);
      const selected = state.selectedEdges.includes(edge.id);
      return {
        ...edge, type: 'relation', selected,
        markerEnd: edge.directed ? { type: MarkerType.ArrowClosed, color: selected ? '#386bfa' : '#a0a8b5' } : undefined,
        data: { offset: (index - (group.length - 1) / 2) * 50, selfIndex: index },
      };
    });
  }, [state.edges, state.selectedEdges]);
  const canEdit = state.loaded && !state.loading;
  const dirty = Boolean(state.inFlight || Object.keys(state.pending).length);
  const status = state.loading ? '读取中' : state.error ? (state.error.phase === 'load' ? '读取失败' : '保存失败') : state.inFlight ? '保存中' : dirty ? '待保存' : '已保存';

  useEffect(() => {
    if (!state.loaded || initialViewSet.current) return;
    // Fit existing data once. An empty canvas must keep the first context-created
    // node at the clicked position instead of moving the viewport after creation.
    if (!nodes.length) { initialViewSet.current = true; return; }
    // fitView queues its own measurement; node dimensions stay in React Flow
    // rather than becoming part of the persisted graph state.
    if (flow.viewportInitialized) {
      initialViewSet.current = true;
      void flow.fitView({ padding: 0.25, maxZoom: 1 });
    }
  }, [state.loaded, nodes.length, flow]);

  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      const current = store.getState();
      if (current.inFlight || Object.keys(current.pending).length) { event.preventDefault(); event.returnValue = ''; }
    }
    function onKeyDown(event: KeyboardEvent) {
      if ((event.target as HTMLElement).closest('input, textarea, [contenteditable="true"], [role="menu"]')) return;
      const current = store.getState();
      if (!current.loaded || current.loading) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) current.redo(); else current.undo();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (current.selectedNodes.length || current.selectedEdges.length) { event.preventDefault(); current.deleteSelection(); }
      }
    }
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('keydown', onKeyDown); };
  }, [store]);

  function onNodesChange(changes: NodeChange[]) {
    const current = store.getState();
    const selection = new Set(current.selectedNodes);
    const previews: NodeLayout[] = [], before: NodeLayout[] = [], after: NodeLayout[] = [];
    for (const change of changes) {
      if (change.type === 'select') { if (change.selected) selection.add(change.id); else selection.delete(change.id); }
      if (change.type === 'position' && change.position) {
        const layout = { nodeId: change.id, ...change.position };
        if (change.dragging === undefined && current.layouts[change.id]) { before.push(current.layouts[change.id]); after.push(layout); }
        else previews.push(layout);
      }
    }
    current.select([...selection], current.selectedEdges);
    if (previews.length) current.previewPositions(previews);
    if (after.length) current.commitPositions(before, after);
  }
  function onEdgesChange(changes: EdgeChange[]) {
    const current = store.getState(), selection = new Set(current.selectedEdges);
    for (const change of changes) if (change.type === 'select') {
      if (change.selected) selection.add(change.id); else selection.delete(change.id);
    }
    current.select(current.selectedNodes, [...selection]);
  }

  function openMenu(event: ReactMouseEvent | MouseEvent, nodeId?: string, selectedIds?: string[]) {
    event.preventDefault();
    event.stopPropagation();
    const current = store.getState();
    if (!current.loaded || current.loading) return;
    const nodeIds = selectedIds ?? (nodeId ? current.selectedNodes.includes(nodeId) ? current.selectedNodes : [nodeId] : []);
    current.select(nodeIds, []);
    setMenu({ x: event.clientX, y: event.clientY, position: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }), nodeIds });
  }
  function startDrag(moved: Node[]) {
    closeMenu();
    const current = store.getState();
    dragBefore.current = moved.map(node => current.layouts[node.id]).filter(Boolean);
  }
  function finishDrag(moved: Node[]) {
    store.getState().commitPositions(dragBefore.current, moved.map(node => ({ nodeId: node.id, ...node.position })));
    dragBefore.current = [];
  }

  return <main className={`editor-shell${connecting ? ' is-connecting' : ''}`}>
    <div className="canvas" ref={canvas} tabIndex={-1} aria-label="节点画布">
      <ReactFlow nodes={nodes} edges={edges} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        onConnect={connection => state.createEdge(connection.source, connection.target)}
        onConnectStart={() => { setConnecting(true); closeMenu(); }} onConnectEnd={() => setConnecting(false)}
        nodesDraggable={canEdit} nodesConnectable={canEdit} elementsSelectable={canEdit}
        selectionOnDrag selectionKeyCode={null} selectionMode={SelectionMode.Full} multiSelectionKeyCode="Shift"
        panOnDrag={[1]} panActivationKeyCode="Space" minZoom={0.25} maxZoom={2} zoomOnDoubleClick={false}
        deleteKeyCode={null}
        onPaneClick={() => { state.select([], []); closeMenu(); }}
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
      <strong className="wordmark">uknode</strong>
      <output className={`save-status${state.error ? ' is-error' : dirty ? ' is-pending' : ''}`} aria-live="polite" data-testid="save-status"><Icon name="check" />{status}</output>
    </header>
    <div className="toolbar surface" role="group" aria-label="图编辑工具">
      <button aria-label="新增节点" title="新增节点" disabled={!canEdit} onClick={() => {
        const rect = canvas.current!.getBoundingClientRect();
        const offset = Object.keys(state.nodes).length % 6 * 24;
        const position = flow.screenToFlowPosition({ x: rect.x + rect.width / 2 + offset, y: rect.y + rect.height / 2 + offset });
        state.createNode(position.x - 86, position.y - 27);
      }}><Icon name="plus" /><span>新增节点</span></button>
      <button aria-label="删除选中" title="删除选中（Delete）" disabled={!canEdit || (!state.selectedNodes.length && !state.selectedEdges.length)} onClick={state.deleteSelection}><Icon name="trash" /><span>删除选中</span></button>
      <span className="control-divider" />
      <button aria-label="撤销" title="撤销（Ctrl / ⌘ Z）" disabled={!canEdit || !state.past.length} onClick={state.undo}><Icon name="undo" /><span>撤销</span></button>
      <button aria-label="重做" title="重做（Ctrl / ⌘ Shift Z）" disabled={!canEdit || !state.future.length} onClick={state.redo}><Icon name="redo" /><span>重做</span></button>
    </div>
    <p className="canvas-hint">拖动框选<span>·</span>空格拖动平移<span>·</span>右键新增</p>
    {!nodes.length && canEdit && <div className="empty-hint">右键新增节点<small>也可以使用下方工具栏</small></div>}
    <CanvasControls />
    <DetailsPanel state={state} saver={saver} />
    {menu && <CanvasMenu menu={menu} disabled={!canEdit} onClose={dismissMenu} onCreate={() => {
      if (canEdit) state.createNode(menu.position.x, menu.position.y);
      dismissMenu();
    }} onDelete={() => {
      if (canEdit) { state.select(menu.nodeIds, []); state.deleteSelection(); }
      dismissMenu();
    }} />}
    {state.error && <div className="save-error surface" role="alert">
      <span>{state.error.message} </span>
      {state.error.retryable && <button onClick={() => void saver.retry()}>重试</button>}
      {state.loaded && <button onClick={() => {
        if (!dirty || window.confirm('重新读取会放弃本页尚未确认的修改，并清空会话撤销记录。继续？')) void saver.load();
      }}>重新读取</button>}
    </div>}
  </main>;
}

export function App(props: { store: GraphStore; saver: Autosave }) {
  return <ReactFlowProvider><Editor {...props} /></ReactFlowProvider>;
}
