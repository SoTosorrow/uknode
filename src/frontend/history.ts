import type { BaseNode, BaseEdge, NodeLayout } from '../shared/model.js';
import type { Change } from '../shared/protocol.js';

export interface GraphObjects {
  nodes: Record<string, BaseNode>;
  edges: Record<string, BaseEdge>;
  layouts: Record<string, NodeLayout>;
}

export interface HistoryEntry {
  undo: Change[];
  redo: Change[];
  mergeKey?: string;
  time: number;
}

export function invertChanges(graph: GraphObjects, changes: Change[]): Change[] {
  const inverse: Change[] = [];
  for (const change of changes) {
    switch (change.type) {
      case 'node.put':
        if (!graph.nodes[change.node.id]) inverse.push({ type: 'node.delete', id: change.node.id });
        break;
      case 'node.delete': {
        const node = graph.nodes[change.id];
        if (node) inverse.push({ type: 'node.put', node });
        const layout = graph.layouts[change.id];
        if (layout) inverse.push({ type: 'layout.put', layout });
        break;
      }
      case 'edge.put': {
        const previous = graph.edges[change.edge.id];
        inverse.push(previous ? { type: 'edge.put', edge: previous } : { type: 'edge.delete', id: change.edge.id });
        break;
      }
      case 'edge.delete': {
        const edge = graph.edges[change.id];
        if (edge) inverse.push({ type: 'edge.put', edge });
        break;
      }
      case 'layout.put': {
        const previous = graph.layouts[change.layout.nodeId];
        if (previous) inverse.push({ type: 'layout.put', layout: previous });
        break;
      }
    }
  }
  return inverse;
}

export function recordHistory(past: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const previous = past.at(-1);
  if (entry.mergeKey && previous?.mergeKey === entry.mergeKey && entry.time - previous.time < 1500) {
    return [...past.slice(0, -1), { ...entry, undo: previous.undo }];
  }
  return [...past, entry].slice(-100);
}
