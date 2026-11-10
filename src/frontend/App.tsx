import { useEffect, useMemo, useRef } from 'react';
import { useStore } from 'zustand';
import {
  ReactFlow, ReactFlowProvider, Controls, BaseEdge, EdgeLabelRenderer, MarkerType, Position, useReactFlow,
  type Node, type Edge, type EdgeProps, type NodeChange, type EdgeChange,
} from '@xyflow/react';
import type { NodeLayout } from '../shared/model.js';
import type { GraphStore } from './graph-store.js';
import type { Autosave } from './autosave.js';

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
    {props.label && <EdgeLabelRenderer><span className="edge-label" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>{props.label}</span></EdgeLabelRenderer>}
  </>;
}

const edgeTypes = { relation: RelationEdge };

function Editor({ store, saver }: { store: GraphStore; saver: Autosave }) {
  const state = useStore(store);
  const flow = useReactFlow();
  const dragBefore = useRef<NodeLayout[]>([]);
  const canvas = useRef<HTMLDivElement>(null);
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
      return {
        ...edge, type: 'relation', selected: state.selectedEdges.includes(edge.id),
        markerEnd: edge.directed ? { type: MarkerType.ArrowClosed } : undefined,
        data: { offset: (index - (group.length - 1) / 2) * 50, selfIndex: index },
      };
    });
  }, [state.edges, state.selectedEdges]);
  const selectedEdge = state.selectedEdges.length === 1 && !state.selectedNodes.length ? state.edges[state.selectedEdges[0]] : undefined;
  const dirty = Boolean(state.inFlight || Object.keys(state.pending).length);
  const status = state.loading ? '读取中' : state.error ? (state.error.phase === 'load' ? '读取失败' : '保存失败') : state.inFlight ? '保存中' : dirty ? '待保存' : '已保存';

  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      const current = store.getState();
      if (current.inFlight || Object.keys(current.pending).length) { event.preventDefault(); event.returnValue = ''; }
    }
    function onKeyDown(event: KeyboardEvent) {
      if ((event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return;
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

  return <main>
    <div className="toolbar">
      <strong>uknode</strong>
      <button disabled={!state.loaded || state.loading} onClick={() => {
        const rect = canvas.current!.getBoundingClientRect();
        const offset = Object.keys(state.nodes).length % 6 * 25;
        const position = flow.screenToFlowPosition({ x: rect.x + rect.width / 2 - 75 + offset, y: rect.y + rect.height / 2 - 20 + offset });
        state.createNode(position.x, position.y);
      }}>新建节点</button>
      <button disabled={state.loading || (!state.selectedNodes.length && !state.selectedEdges.length)} onClick={state.deleteSelection}>删除选中</button>
      <button disabled={state.loading || !state.past.length} onClick={state.undo}>撤销</button>
      <button disabled={state.loading || !state.future.length} onClick={state.redo}>重做</button>
      <output aria-live="polite" data-testid="save-status">{status}</output>
    </div>
    {state.error && <div role="alert">
      <span>{state.error.message} </span>
      {state.error.retryable && <button onClick={() => void saver.retry()}>重试</button>}
      {state.loaded && <button onClick={() => {
        if (!dirty || window.confirm('重新读取会放弃本页尚未确认的修改，并清空会话撤销记录。继续？')) void saver.load();
      }}>重新读取</button>}
    </div>}
    <div className="workspace">
      <div className="canvas" ref={canvas}>
        <ReactFlow nodes={nodes} edges={edges} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onConnect={connection => state.createEdge(connection.source, connection.target)}
          nodesDraggable={state.loaded && !state.loading} nodesConnectable={state.loaded && !state.loading}
          deleteKeyCode={null} fitView
          onNodeDragStart={(_, node, moved) => {
            const current = store.getState();
            dragBefore.current = (moved.length ? moved : [node]).map(item => current.layouts[item.id]).filter(Boolean);
          }}
          onNodeDragStop={(_, node, moved) => {
            state.commitPositions(dragBefore.current, (moved.length ? moved : [node]).map(item => ({ nodeId: item.id, ...item.position })));
            dragBefore.current = [];
          }}>
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <aside>
        {selectedEdge ? <>
          <p>连线：{selectedEdge.id.slice(0, 8)}</p>
          <p>{selectedEdge.source.slice(0, 8)} {selectedEdge.directed ? '→' : '—'} {selectedEdge.target.slice(0, 8)}</p>
          <label>连线说明<textarea disabled={state.loading} maxLength={300} value={selectedEdge.label} onChange={event => state.updateEdge(selectedEdge.id, { label: event.target.value })} onBlur={() => void saver.flush()} /></label>
          <label><input type="checkbox" disabled={state.loading} checked={selectedEdge.directed} onChange={event => state.updateEdge(selectedEdge.id, { directed: event.target.checked })} />有方向</label>
        </> : <>
          <p>节点 {nodes.length}，连线 {edges.length}</p>
          <p>拖动节点调整位置；从节点右侧连接点拖到另一节点左侧连接点创建连线。</p>
          <p>选中连线后可编辑说明和方向。</p>
          {state.selectedNodes.map(id => <p key={id}>节点 ID：<code>{id}</code></p>)}
        </>}
      </aside>
    </div>
  </main>;
}

export function App(props: { store: GraphStore; saver: Autosave }) {
  return <ReactFlowProvider><Editor {...props} /></ReactFlowProvider>;
}
