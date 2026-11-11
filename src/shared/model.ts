// Core identity, relationship and visual position remain independent.
export interface BaseNode { id: string }

export interface BaseEdge {
  id: string;
  source: string;
  target: string;
  directed: boolean;
  label: string;
}

export interface NodeLayout {
  // null is the existing global canvas; other values identify a range node.
  contextNodeId: string | null;
  nodeId: string;
  x: number;
  y: number;
}

export interface Membership { containerId: string; memberId: string }

export function membershipKey({ containerId, memberId }: Membership): string {
  return `${containerId}:${memberId}`;
}

export function layoutKey({ contextNodeId, nodeId }: Pick<NodeLayout, 'contextNodeId' | 'nodeId'>): string {
  return `${contextNodeId ?? 'global'}:${nodeId}`;
}

export interface GraphData {
  revision: number;
  nodes: BaseNode[];
  edges: BaseEdge[];
  memberships: Membership[];
  layouts: NodeLayout[];
}
