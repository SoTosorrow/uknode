import type { ReactNode, SyntheticEvent } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

export type NodeRenderer = (node: { id: string; selected: boolean }) => ReactNode;
export type CanvasNode = Node<{ renderContent?: NodeRenderer }, 'anchor'>;

export function NodeShell({ id, data, selected, isConnectable }: NodeProps<CanvasNode>) {
  return <>
    <Handle type="target" position={Position.Left} isConnectable={isConnectable} />
    {data.renderContent ? data.renderContent({ id, selected: Boolean(selected) }) : id}
    <Handle type="source" position={Position.Right} isConnectable={isConnectable} />
  </>;
}

function stopPropagation(event: SyntheticEvent) { event.stopPropagation(); }

// Wrap editable/scrollable content, leaving the rest of the node draggable.
// React Flow's classes also guard its native drag and wheel listeners.
// Keyup still bubbles so keys pressed outside (e.g. Space for pan) can be released.
export function NodeControls({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`nodrag nopan nowheel ${className}`} data-canvas-controls
    onKeyDown={stopPropagation} onClick={stopPropagation}
    onDoubleClick={stopPropagation} onContextMenu={stopPropagation}>
    {children}
  </div>;
}

export function isCanvasControl(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(
    'input, textarea, select, video, audio, .react-flow__node button, .react-flow__node a[href], [contenteditable]:not([contenteditable="false"]), [role="menu"], [data-canvas-controls]',
  ));
}
