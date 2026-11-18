import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  ReactFlow, Background, BaseEdge, MarkerType, Position, SelectionMode, useReactFlow, useStore,
  type Node, type Edge, type EdgeProps, type ConnectionLineComponentProps, type NodeChange, type EdgeChange, type XYPosition, type Connection,
} from '@xyflow/react';
import type { BaseEdge as GraphEdge } from '../core/model.js';
import { NodeShell, isCanvasControl, type CanvasNode, type NodeRenderer } from './node-shell.js';

export interface CanvasSelection { nodes: string[]; edges: string[] }
export interface CanvasPosition extends XYPosition { nodeId: string }
export interface GraphCanvasProps {
  id: string;
  viewKey: string;
  initialNodeId?: string;
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

// Two cubic segments keep horizontal tangents at the side ports and a visible bend
// even when both ports have the same height. Lane offsets separate parallel edges.
function relationPath(sx: number, sy: number, tx: number, ty: number, lane = 0) {
  const dx = tx - sx, dy = ty - sy;
  const length = Math.hypot(dx, dy) || 1;
  const reach = Math.max(24, Math.min(96, length * 0.29));
  const lift = dx < 0 ? Math.max(70, Math.min(200, -dx * 0.45)) : Math.min(32, length * 0.12);
  const mx = (sx + tx) / 2 - dy / length * lane;
  const my = (sy + ty) / 2 + dx / length * lane - lift * Math.abs(dx) / length;
  return `M ${sx} ${sy} C ${sx + reach} ${sy}, ${mx - dx * 0.16} ${my - dy * 0.16}, ${mx} ${my} S ${tx - reach} ${ty}, ${tx} ${ty}`;
}

function RelationEdge(props: EdgeProps<Relation>) {
  const { sourceX: sx, sourceY: sy, targetX: tx, targetY: ty } = props;
  const offset = (props.data?.offset || 0) * (props.source < props.target ? 1 : -1);
  const loop = 80 + (props.data?.selfIndex || 0) * 30;
  const path = props.source === props.target
    ? `M ${sx} ${sy} C ${sx + loop} ${sy - loop * 2}, ${tx - loop} ${ty - loop * 2}, ${tx} ${ty}`
    : relationPath(sx, sy, tx, ty, offset);
  return <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} style={props.style} />;
}

function ConnectionPreview({ fromX, fromY, toX, toY, fromPosition }: ConnectionLineComponentProps) {
  const path = fromPosition === Position.Left ? relationPath(toX, toY, fromX, fromY) : relationPath(fromX, fromY, toX, toY);
  return <path className="react-flow__connection-path" fill="none" d={path} />;
}

const nodeTypes = { anchor: NodeShell };
const edgeTypes = { relation: RelationEdge };

function selectChanged(ids: string[], changes: Array<{ id: string; selected: boolean }>) {
  const selected = new Set(ids);
  for (const change of changes) { if (change.selected) selected.add(change.id); else selected.delete(change.id); }
  return [...selected];
}

// The caller supplies the project graph and handles edits and navigation.
export function GraphCanvas(props: GraphCanvasProps) {
  const { nodeIds, positions, selection, enabled, viewKey, initialNodeId, onSelect, renderNode } = props;
  const flow = useReactFlow();
  const targetId = initialNodeId && Object.hasOwn(positions, initialNodeId) ? initialNodeId : undefined;
  const targetMeasured = useStore(state => !!(targetId && state.nodeLookup.get(targetId)?.measured.width));
  const dragBefore = useRef<CanvasPosition[]>([]);
  const fittedView = useRef<string | undefined>(undefined);
  const [connecting, setConnecting] = useState(false);
  // Keep content props stable while only selection or coordinates change.
  const nodeTemplates = useMemo(() => nodeIds.map(id => ({
    id, type: 'anchor' as const, data: { renderContent: renderNode },
  })), [nodeIds, renderNode]);
  const selectedNodes = useMemo(() => new Set(selection.nodes), [selection.nodes]);
  const nodes = useMemo<CanvasNode[]>(() => nodeTemplates.map(node => ({
    ...node, position: positions[node.id], selected: selectedNodes.has(node.id),
  })), [nodeTemplates, positions, selectedNodes]);
  const lanes = useMemo(() => {
    const counts = new Map<string, number>();
    const indexed = props.edges.map(edge => {
      const key = edge.source < edge.target ? edge.source + ':' + edge.target : edge.target + ':' + edge.source;
      const index = counts.get(key) ?? 0;
      counts.set(key, index + 1);
      return { edge, key, index };
    });
    return indexed.map(({ edge, key, index }) => ({ edge, index, count: counts.get(key)! }));
  }, [props.edges]);
  const edges = useMemo<Relation[]>(() => {
    const selectedEdges = new Set(selection.edges);
    return lanes.map(({ edge, index, count }) => {
      const selected = selectedEdges.has(edge.id);
      return {
        ...edge, type: 'relation', selected,
        markerEnd: edge.directed ? { type: MarkerType.ArrowClosed, color: selected ? '#386bfa' : '#a0a8b5' } : undefined,
        data: { offset: (index - (count - 1) / 2) * 50, selfIndex: index },
      };
    });
  }, [lanes, selection.edges]);

  useEffect(() => {
    if (!enabled || fittedView.current === viewKey) return;
    // Empty canvases must keep the first node at the requested position.
    if (!nodeIds.length) { fittedView.current = viewKey; return; }
    if (!flow.viewportInitialized || (targetId && !targetMeasured)) return;
    fittedView.current = viewKey;
    if (targetId) {
      const bounds = flow.getNodesBounds([targetId]);
      void flow.setCenter(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, { zoom: 1 });
      onSelect(() => ({ nodes: [targetId], edges: [] }));
    } else {
      void flow.fitView({ padding: 0.25, maxZoom: 1 });
    }
  }, [enabled, viewKey, nodeIds.length, flow, targetId, targetMeasured, onSelect]);
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
    nodeTypes={nodeTypes} edgeTypes={edgeTypes} connectionLineComponent={ConnectionPreview} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
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
