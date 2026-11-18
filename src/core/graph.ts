import { type GraphObjects } from './model.js';
import { graphChangeKey, type GraphChange } from './changes.js';

export class GraphError extends Error {
  constructor(public code: 'MISSING_ENDPOINT', message: string) {
    super(message);
  }
}

// Match the stored target endpoint. Callers decide how to interpret undirected edges.
export function edgesTo(graph: Pick<GraphObjects, 'edges'>, target: string) {
  return Object.values(graph.edges).filter(edge => edge.target === target);
}

// In-memory validation; SQLite enforces references with foreign keys.
function validateGraphReference(change: GraphChange, nodes: GraphObjects['nodes']): void {
  if (change.type === 'edge.put' && (!nodes[change.edge.source] || !nodes[change.edge.target])) {
    throw new GraphError('MISSING_ENDPOINT', '连线的端点不存在');
  }
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
  }
  // An explicit rewire can preserve an edge; its new endpoints are validated below.
  for (const [key, change] of explicit) expanded.set(key, change);
  const changes = [...expanded.values()];
  const nodes = changes.some(c => c.type.startsWith('node.')) ? { ...graph.nodes } : graph.nodes;
  const edges = changes.some(c => c.type.startsWith('edge.')) ? { ...graph.edges } : graph.edges;
  for (const change of changes) {
    switch (change.type) {
      case 'edge.delete': delete edges[change.id]; break;
      case 'node.delete': delete nodes[change.id]; break;
    }
  }
  for (const change of changes) if (change.type === 'node.put') nodes[change.node.id] = change.node;
  for (const change of changes) {
    validateGraphReference(change, nodes);
    if (change.type === 'edge.put') edges[change.edge.id] = change.edge;
  }
  return { graph: { nodes, edges }, changes };
}
