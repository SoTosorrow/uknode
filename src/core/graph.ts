import { membershipKey, type GraphObjects, type Membership } from './model.js';
import { graphChangeKey, type GraphChange } from './changes.js';
import { hasMembershipCycle } from './traversal.js';

export class GraphError extends Error {
  constructor(public code: 'MISSING_ENDPOINT' | 'MISSING_MEMBER' | 'MEMBERSHIP_CYCLE', message: string) {
    super(message);
  }
}

// In-memory validation; SQLite enforces references with foreign keys.
function validateGraphReference(change: GraphChange, nodes: GraphObjects['nodes']): void {
  if (change.type === 'edge.put' && (!nodes[change.edge.source] || !nodes[change.edge.target])) {
    throw new GraphError('MISSING_ENDPOINT', '连线的端点不存在');
  }
  if (change.type === 'membership.put') {
    const { containerId, memberId } = change.membership;
    if (!nodes[containerId] || !nodes[memberId]) throw new GraphError('MISSING_MEMBER', '收录关系对应的节点不存在');
    if (containerId === memberId) throw new GraphError('MEMBERSHIP_CYCLE', '节点不能收录自身或形成包含循环');
  }
}

export function validateMemberships(memberships: Membership[]): void {
  if (hasMembershipCycle(memberships)) throw new GraphError('MEMBERSHIP_CYCLE', '收录会形成包含循环，整批修改未写入');
}

// Return the full change list together with the result so saving and undo use
// exactly the same cascade as the in-memory graph.
export function applyGraphChanges(graph: GraphObjects, input: GraphChange[]): { graph: GraphObjects; changes: GraphChange[] } {
  const explicit = new Map(input.map(change => [graphChangeKey(change), change]));
  const deletedNodes = new Set([...explicit.values()].filter(c => c.type === 'node.delete').map(c => c.id));
  const expanded = new Map<string, GraphChange>();
  if (deletedNodes.size) {
    for (const edge of Object.values(graph.edges)) if (deletedNodes.has(edge.source) || deletedNodes.has(edge.target)) {
      expanded.set(`edge:${edge.id}`, { type: 'edge.delete', id: edge.id });
    }
    for (const membership of Object.values(graph.memberships)) if (deletedNodes.has(membership.containerId) || deletedNodes.has(membership.memberId)) {
      expanded.set(`membership:${membershipKey(membership)}`, { type: 'membership.delete', membership });
    }
  }
  // An explicit rewire can preserve an edge; its new endpoints are validated below.
  for (const [key, change] of explicit) expanded.set(key, change);
  const changes = [...expanded.values()];
  const nodes = changes.some(c => c.type.startsWith('node.')) ? { ...graph.nodes } : graph.nodes;
  const edges = changes.some(c => c.type.startsWith('edge.')) ? { ...graph.edges } : graph.edges;
  const memberships = changes.some(c => c.type.startsWith('membership.')) ? { ...graph.memberships } : graph.memberships;
  for (const change of changes) {
    switch (change.type) {
      case 'edge.delete': delete edges[change.id]; break;
      case 'membership.delete': delete memberships[membershipKey(change.membership)]; break;
      case 'node.delete': delete nodes[change.id]; break;
    }
  }
  for (const change of changes) if (change.type === 'node.put') nodes[change.node.id] = change.node;
  for (const change of changes) {
    validateGraphReference(change, nodes);
    if (change.type === 'edge.put') edges[change.edge.id] = change.edge;
    if (change.type === 'membership.put') memberships[membershipKey(change.membership)] = change.membership;
  }
  if (changes.some(c => c.type === 'membership.put')) validateMemberships(Object.values(memberships));
  return { graph: { nodes, edges, memberships }, changes };
}
