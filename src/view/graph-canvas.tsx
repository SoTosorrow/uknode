import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  ReactFlow, Background, BaseEdge, MarkerType, SelectionMode, getSmoothStepPath, useReactFlow, useStore,
  type Node, type Edge, type EdgeProps, type NodeChange, type EdgeChange, type XYPosition, type Connection,
} from '@xyflow/react';
import type { BaseEdge as GraphEdge } from '../core/model.js';
import { NodeShell, isCanvasControl, type CanvasNode, type NodeRenderer } from './node-shell.js';
import type { GroupState } from '../runtime/node-groups.js';
import { GroupFrames } from './group-frames.js';

export interface CanvasSelection { nodes: string[]; edges: string[] }
export interface CanvasPosition extends XYPosition { nodeId: string }
export interface GraphCanvasProps extends GroupState {
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

type SeparatedEdge = Edge<{ lane: number; sourceHeight: number; targetHeight: number }, 'separated'>;

// The default paths coincide for parallel edges and cross the card for self-loops.
function SeparatedRelation({ id, data, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style }: EdgeProps<SeparatedEdge>) {
  const { lane, sourceHeight, targetHeight } = data!;
  const [path] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
    centerY: Math.min(sourceY - sourceHeight / 2, targetY - targetHeight / 2) - 24 - lane * 16,
    offset: Math.max(18, (targetX - sourceX) / 2 + 18) + lane * 6,
    borderRadius: 12,
  });
  return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />;
}

const nodeTypes = { anchor: NodeShell };
const edgeTypes = { separated: SeparatedRelation };

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
  const [sizes, setSizes] = useState<Record<string, { width: number; height: number }>>({});
  // Keep content props stable while only selection or coordinates change.
  const nodeTemplates = useMemo(() => nodeIds.map(id => ({
    id, type: 'anchor' as const, data: { renderContent: renderNode },
  })), [nodeIds, renderNode]);
  const selectedNodes = useMemo(() => new Set(selection.nodes), [selection.nodes]);
  const nodes = useMemo<CanvasNode[]>(() => nodeTemplates.map(node => ({
    ...node, position: positions[node.id], measured: sizes[node.id], selected: selectedNodes.has(node.id),
  })), [nodeTemplates, positions, sizes, selectedNodes]);
  const edges = useMemo<Edge[]>(() => {
    const counts = new Map<string, number>();
    const selectedEdges = new Set(selection.edges);
    return props.edges.map(edge => {
      const pair = edge.source < edge.target ? edge.source + ':' + edge.target : edge.target + ':' + edge.source;
      const lane = counts.get(pair) ?? 0;
      counts.set(pair, lane + 1);
      const selected = selectedEdges.has(edge.id);
      const relation = {
        ...edge, selected,
        markerEnd: edge.directed ? { type: MarkerType.ArrowClosed, color: selected ? '#386bfa' : '#a0a8b5' } : undefined,
      };
      if (lane === 0 && edge.source !== edge.target) return relation;
      return { ...relation, type: 'separated', data: { lane,
        sourceHeight: sizes[edge.source]?.height ?? 0, targetHeight: sizes[edge.target]?.height ?? 0 } } satisfies SeparatedEdge;
    });
  }, [props.edges, selection.edges, sizes]);

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
    const resized = changes.filter(change => change.type === 'dimensions');
    if (resized.length) setSizes(previous => {
      const next = Object.fromEntries(Object.entries(previous).filter(([id]) => Object.hasOwn(positions, id)));
      for (const change of resized) {
        if (change.dimensions) next[change.id] = change.dimensions;
      }
      return next;
    });
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
    <GroupFrames groups={props.groups} groupByNode={props.groupByNode} nodes={nodes} enabled={enabled}
      onPreviewPositions={props.onPreviewPositions} onCommitPositions={props.onCommitPositions} onInteractionStart={props.onInteractionStart} />
  </ReactFlow>;
}
