import { useMemo, useRef, type PointerEvent } from 'react';
import { getNodesBounds, useReactFlow, ViewportPortal, type XYPosition } from '@xyflow/react';
import type { GroupState } from '../runtime/node-groups.js';
import type { CanvasPosition, GraphCanvasProps } from './graph-canvas.js';
import type { CanvasNode } from './node-shell.js';

type Props = GroupState & Pick<GraphCanvasProps, 'enabled' | 'onPreviewPositions' | 'onCommitPositions' | 'onInteractionStart'> & {
  nodes: CanvasNode[];
};

export function GroupFrames({ nodes, groups, groupByNode, enabled, onPreviewPositions, onCommitPositions, onInteractionStart }: Props) {
  const flow = useReactFlow();
  const drag = useRef<{ pointerId: number; origin: XYPosition; before: CanvasPosition[] } | null>(null);
  const members = useMemo(() => {
    const grouped = new Map<string, CanvasNode[]>();
    for (const node of nodes) {
      const id = groupByNode[node.id];
      if (!id) continue;
      const group = grouped.get(id);
      if (group) group.push(node);
      else grouped.set(id, [node]);
    }
    return grouped;
  }, [nodes, groupByNode]);

  function start(event: PointerEvent<SVGGElement>, group: CanvasNode[]) {
    if (!enabled || event.button !== 0 || drag.current) return;
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.ownerSVGElement!.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      origin: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      before: group.map(node => ({ nodeId: node.id, ...node.position })),
    };
    onInteractionStart?.();
  }
  function move(event: PointerEvent<SVGSVGElement>, finish = false) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const point = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const dx = point.x - active.origin.x, dy = point.y - active.origin.y;
    const after = active.before.map(({ nodeId, x, y }) => ({ nodeId, x: x + dx, y: y + dy }));
    if (finish) {
      drag.current = null;
      onCommitPositions(active.before, enabled ? after : active.before);
    } else if (enabled) onPreviewPositions(after);
  }
  function cancel(event: PointerEvent<SVGSVGElement>) {
    const active = drag.current;
    if (active?.pointerId !== event.pointerId) return;
    drag.current = null;
    onCommitPositions(active.before, active.before);
  }

  return <ViewportPortal><svg className="group-frames" width="1" height="1"
    onPointerMove={event => move(event)} onPointerUp={event => move(event, true)}
    onPointerCancel={cancel} onLostPointerCapture={cancel}>
    {Array.from(members, ([id, group]) => {
      if (!group.every(node => node.measured?.width && node.measured.height)) return null;
      const bounds = getNodesBounds(group);
      const width = bounds.width + 36, height = bounds.height + 56;
      return <g key={id} role="group" aria-label={groups[id].name} transform={`translate(${bounds.x - 18} ${bounds.y - 38})`}
        className="group-frame nopan nodrag" onPointerDown={event => start(event, group)}>
        <rect className="group-frame-fill" width={width} height={height} rx="10" />
        <rect className="group-frame-border" width={width} height={height} rx="10" />
        <foreignObject className="group-frame-title" x="12" y="4" width={width - 24} height="28">
          <span title={groups[id].name}>{groups[id].name}</span>
        </foreignObject>
      </g>;
    })}
  </svg></ViewportPortal>;
}
