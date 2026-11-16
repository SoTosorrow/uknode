// Stable anchors and structural relationships; no business or display fields.
export interface BaseNode { id: string }
export interface BaseEdge {
  id: string;
  source: string;
  target: string;
  directed: boolean;
}
export interface Membership { containerId: string; memberId: string }

export function membershipKey({ containerId, memberId }: Membership): string {
  return `${containerId}:${memberId}`;
}

export interface GraphObjects {
  nodes: Record<string, BaseNode>;
  edges: Record<string, BaseEdge>;
  memberships: Record<string, Membership>;
}
