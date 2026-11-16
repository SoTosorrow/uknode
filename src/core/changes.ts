import { membershipKey, type BaseNode, type BaseEdge, type Membership } from './model.js';

export type GraphChange =
  | { type: 'node.put'; node: BaseNode }
  | { type: 'node.delete'; id: string }
  | { type: 'edge.put'; edge: BaseEdge }
  | { type: 'edge.delete'; id: string }
  | { type: 'membership.put' | 'membership.delete'; membership: Membership };

export function graphChangeKey(change: GraphChange): string {
  switch (change.type) {
    case 'node.put': return `node:${change.node.id}`;
    case 'node.delete': return `node:${change.id}`;
    case 'edge.put': return `edge:${change.edge.id}`;
    case 'edge.delete': return `edge:${change.id}`;
    case 'membership.put': case 'membership.delete': return `membership:${membershipKey(change.membership)}`;
  }
}
