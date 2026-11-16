import { membershipKey, type GraphObjects, type Membership } from './model.js';
import type { GraphChange } from './changes.js';
import { hasMembershipCycle } from './traversal.js';

export class GraphError extends Error {
  constructor(public code: 'MISSING_ENDPOINT' | 'MISSING_MEMBER' | 'MEMBERSHIP_CYCLE', message: string) {
    super(message);
  }
}

// Used by the in-memory graph and the SQLite adapter after deletes and node puts.
export function validateGraphReference(change: GraphChange, nodeExists: (id: string) => boolean): void {
  if (change.type === 'edge.put' && (!nodeExists(change.edge.source) || !nodeExists(change.edge.target))) {
    throw new GraphError('MISSING_ENDPOINT', '连线的端点不存在');
  }
  if (change.type === 'membership.put') {
    const { containerId, memberId } = change.membership;
    if (!nodeExists(containerId) || !nodeExists(memberId)) throw new GraphError('MISSING_MEMBER', '收录关系对应的节点不存在');
    if (containerId === memberId) throw new GraphError('MEMBERSHIP_CYCLE', '节点不能收录自身或形成包含循环');
  }
}

export function validateMemberships(memberships: Membership[]): void {
  if (hasMembershipCycle(memberships)) throw new GraphError('MEMBERSHIP_CYCLE', '收录会形成包含循环，整批修改未写入');
}

// Pure operation: validate the final batch state without mutating the input.
export function applyGraphChanges(graph: GraphObjects, changes: GraphChange[]): GraphObjects {
  const nodes = { ...graph.nodes }, edges = { ...graph.edges }, memberships = { ...graph.memberships };
  for (const change of changes) {
    switch (change.type) {
      case 'edge.delete': delete edges[change.id]; break;
      case 'membership.delete': delete memberships[membershipKey(change.membership)]; break;
      case 'node.delete':
        delete nodes[change.id];
        for (const edge of Object.values(edges)) if (edge.source === change.id || edge.target === change.id) delete edges[edge.id];
        for (const m of Object.values(memberships)) if (m.containerId === change.id || m.memberId === change.id) delete memberships[membershipKey(m)];
        break;
    }
  }
  for (const change of changes) if (change.type === 'node.put') nodes[change.node.id] = change.node;
  for (const change of changes) {
    validateGraphReference(change, id => Boolean(nodes[id]));
    if (change.type === 'edge.put') edges[change.edge.id] = change.edge;
    if (change.type === 'membership.put') memberships[membershipKey(change.membership)] = change.membership;
  }
  if (changes.some(c => c.type === 'membership.put')) validateMemberships(Object.values(memberships));
  return { nodes, edges, memberships };
}

export function deleteGraphObjects(graph: GraphObjects, nodeIds: string[], edgeIds: string[] = []): GraphChange[] {
  const nodes = new Set(nodeIds), edges = new Set(edgeIds);
  for (const edge of Object.values(graph.edges)) if (nodes.has(edge.source) || nodes.has(edge.target)) edges.add(edge.id);
  return [
    ...[...edges].filter(id => graph.edges[id]).map(id => ({ type: 'edge.delete' as const, id })),
    ...Object.values(graph.memberships).filter(m => nodes.has(m.containerId) || nodes.has(m.memberId))
      .map(membership => ({ type: 'membership.delete' as const, membership })),
    ...[...nodes].filter(id => graph.nodes[id]).map(id => ({ type: 'node.delete' as const, id })),
  ];
}
