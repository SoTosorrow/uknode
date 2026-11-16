import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  ReactFlow, Background, BaseEdge, MarkerType, SelectionMode, useReactFlow,
  type Node, type Edge, type EdgeProps, type NodeChange, type EdgeChange, type XYPosition, type Connection,
} from '@xyflow/react';
import type { BaseEdge as GraphEdge } from '../core/model.js';
import { NodeShell, isCanvasControl, type CanvasNode, type NodeRenderer } from './node-shell.js';

export interface CanvasSelection { nodes: string[]; edges: string[] }
export interface CanvasPosition extends XYPosition { nodeId: string }
export interface GraphCanvasProps {
  id: string;
  viewKey: string;
  nodeIds: string[];
  edges: GraphEdge[];
  positions: Record<string, XYPosition>;
  selection: CanvasSelection;
  enabled: boolean;
  renderNode?: NodeRenderer;
  onSelect: (update: (selection: CanvasSelection) => CanvasSelection) => void;
  onConnect: (connection: Connection) => void;
  onPreviewPositions: (positions: CanvasPosition[]) => void;
  onCommitPositions: (before: CanvasPosition[], after: CanvasPosition[]) => void;
  onOpenNode?: (nodeId: string) => void;
  onContextMenu?: (event: ReactMouseEvent | MouseEvent, nodeIds: string[]) => void;
  onInteractionStart?: () => void;
}

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
  return <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} style={props.style} />;
}

const nodeTypes = { anchor: NodeShell };
const edgeTypes = { relation: RelationEdge };

function selectChanged(ids: string[], changes: Array<{ id: string; selected: boolean }>) {
  const selected = new Set(ids);
  for (const change of changes) { if (change.selected) selected.add(change.id); else selected.delete(change.id); }
  return [...selected];
}

// This component knows only the visible graph and canvas gestures. Membership,
// persistence, navigation and the meaning of an open/connect action stay outside.
export function GraphCanvas(props: GraphCanvasProps) {
  const { nodeIds, positions, selection, enabled, viewKey, renderNode } = props;
  const flow = useReactFlow();
  const dragBefore = useRef<CanvasPosition[]>([]);
  const fittedView = useRef<string | undefined>(undefined);
  const [connecting, setConnecting] = useState(false);
  // Keep content props stable while only selection or coordinates change.
  const nodeTemplates = useMemo(() => nodeIds.map(id => ({
    id, type: 'anchor' as const, data: { renderContent: renderNode },
  })), [nodeIds, renderNode]);
  const nodes = useMemo<CanvasNode[]>(() => nodeTemplates.map(node => ({
    ...node, position: positions[node.id], selected: selection.nodes.includes(node.id),
  })), [nodeTemplates, positions, selection.nodes]);
  const edges = useMemo<Relation[]>(() => {
    const groups = new Map<string, string[]>();
    for (const edge of props.edges) {
      const key = [edge.source, edge.target].sort().join(':');
      groups.set(key, [...(groups.get(key) || []), edge.id]);
    }
    return props.edges.map(edge => {
      const group = groups.get([edge.source, edge.target].sort().join(':'))!;
      const index = group.indexOf(edge.id);
      const selected = selection.edges.includes(edge.id);
      return {
        ...edge, type: 'relation', selected,
        markerEnd: edge.directed ? { type: MarkerType.ArrowClosed, color: selected ? '#386bfa' : '#a0a8b5' } : undefined,
        data: { offset: (index - (group.length - 1) / 2) * 50, selfIndex: index },
      };
    });
  }, [props.edges, selection.edges]);

  useEffect(() => {
    if (!enabled || fittedView.current === viewKey) return;
    // Empty canvases must keep the first node at the requested position.
    if (!nodeIds.length) { fittedView.current = viewKey; return; }
    if (flow.viewportInitialized) {
      fittedView.current = viewKey;
      void flow.fitView({ padding: 0.25, maxZoom: 1 });
    }
  }, [enabled, viewKey, nodeIds.length, flow]);
  useEffect(() => { dragBefore.current = []; setConnecting(false); }, [viewKey, enabled]);

  function onNodesChange(changes: NodeChange[]) {
    if (!enabled) return;
    const selected = changes.filter(change => change.type === 'select');
    if (selected.length) props.onSelect(current => ({ ...current, nodes: selectChanged(current.nodes, selected) }));
    const previews: CanvasPosition[] = [], before: CanvasPosition[] = [], after: CanvasPosition[] = [];
    for (const change of changes) if (change.type === 'position' && change.position && positions[change.id]) {
      const position = { nodeId: change.id, ...change.position };
      // Keyboard movement is a complete edit; mouse movement is a preview until release.
      if (change.dragging !== true && !dragBefore.current.length) {
        before.push({ nodeId: change.id, ...positions[change.id] }); after.push(position);
      } else previews.push(position);
    }
    if (previews.length) props.onPreviewPositions(previews);
    if (after.length) props.onCommitPositions(before, after);
  }
  function onEdgesChange(changes: EdgeChange[]) {
    if (!enabled) return;
    const selected = changes.filter(change => change.type === 'select');
    if (selected.length) props.onSelect(current => ({ ...current, edges: selectChanged(current.edges, selected) }));
  }
  function startDrag(moved: Node[]) {
    props.onInteractionStart?.();
    dragBefore.current = moved.filter(node => positions[node.id]).map(node => ({ nodeId: node.id, ...positions[node.id] }));
  }
  function finishDrag(moved: Node[]) {
    if (enabled) props.onCommitPositions(dragBefore.current, moved.map(node => ({ nodeId: node.id, ...node.position })));
    dragBefore.current = [];
  }
  function openMenu(event: ReactMouseEvent | MouseEvent, ids: string[]) {
    if (!enabled || isCanvasControl(event.target)) return;
    props.onContextMenu?.(event, ids);
  }

  return <ReactFlow id={props.id} className={connecting ? 'is-connecting' : undefined} nodes={nodes} edges={edges}
    nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
    onConnect={connection => { if (enabled) props.onConnect(connection); }}
    onConnectStart={() => { setConnecting(true); props.onInteractionStart?.(); }} onConnectEnd={() => setConnecting(false)}
    nodesDraggable={enabled} nodesConnectable={enabled} elementsSelectable={enabled}
    selectionOnDrag selectionKeyCode={null} selectionMode={SelectionMode.Full} multiSelectionKeyCode={enabled ? 'Shift' : null}
    panOnDrag={enabled ? [1] : false} panActivationKeyCode={enabled ? 'Space' : null} minZoom={0.25} maxZoom={2} zoomOnDoubleClick={false}
    deleteKeyCode={null}
    onPaneClick={() => { if (enabled) props.onSelect(() => ({ nodes: [], edges: [] })); props.onInteractionStart?.(); }}
    onNodeDoubleClick={(event, node) => { if (enabled && !isCanvasControl(event.target)) props.onOpenNode?.(node.id); }}
    onPaneContextMenu={event => openMenu(event, [])}
    onNodeContextMenu={(event, node) => openMenu(event, selection.nodes.includes(node.id) ? selection.nodes : [node.id])}
    onSelectionContextMenu={(event, selected) => openMenu(event, selected.map(node => node.id))}
    onMoveStart={props.onInteractionStart} onSelectionStart={props.onInteractionStart}
    onNodeDragStart={(_, node, moved) => startDrag(moved.length ? moved : [node])}
    onNodeDragStop={(_, node, moved) => finishDrag(moved.length ? moved : [node])}
    onSelectionDragStart={(_, moved) => startDrag(moved)} onSelectionDragStop={(_, moved) => finishDrag(moved)}>
    <Background color="#dce3ed" gap={22} size={1} />
  </ReactFlow>;
}
