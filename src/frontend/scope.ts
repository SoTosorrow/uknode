import { layoutKey, type NodeLayout } from '../shared/model.js';
import { directMemberIds } from '../shared/memberships.js';
import type { GraphObjects } from './history.js';

export function scopeNodeIds(graph: GraphObjects, contextNodeId: string | null): string[] {
  if (contextNodeId === null) return Object.keys(graph.nodes);
  if (!graph.nodes[contextNodeId]) return [];
  const members = new Set(directMemberIds(Object.values(graph.memberships), contextNodeId));
  return Object.keys(graph.nodes).filter(id => members.has(id));
}

// Membership determines visibility. Layout rows alone never include an object.
// Missing positions get an initial grid; browsing does not write to SQLite.
export function projectScope(graph: GraphObjects, contextNodeId: string | null, previews: Record<string, NodeLayout> = {}) {
  const nodeIds = scopeNodeIds(graph, contextNodeId), visible = new Set(nodeIds);
  const layouts: Record<string, NodeLayout> = {};
  nodeIds.forEach((nodeId, index) => {
    const key = layoutKey({ contextNodeId, nodeId });
    layouts[nodeId] = previews[key] ?? graph.layouts[key] ?? {
      contextNodeId, nodeId, x: (index % 4) * 240, y: Math.floor(index / 4) * 140,
    };
  });
  return { nodeIds, layouts, edges: Object.values(graph.edges).filter(edge => visible.has(edge.source) && visible.has(edge.target)) };
}
