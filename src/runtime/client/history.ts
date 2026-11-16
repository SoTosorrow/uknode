import { membershipKey } from '../../core/model.js';
import { layoutKey, type DocumentObjects } from '../document.js';
import { changeKey, type Change } from '../protocol.js';

export interface HistoryEntry {
  undo: Change[];
  redo: Change[];
  mergeKey?: string;
  time: number;
}

export function invertChanges(graph: DocumentObjects, changes: Change[]): Change[] {
  const inverse: Change[] = [];
  for (const change of changes) {
    switch (change.type) {
      case 'node.put':
        if (!graph.nodes[change.node.id]) inverse.push({ type: 'node.delete', id: change.node.id });
        break;
      case 'node.delete': {
        const node = graph.nodes[change.id];
        if (node) inverse.push({ type: 'node.put', node });
        for (const edge of Object.values(graph.edges)) if (edge.source === change.id || edge.target === change.id) inverse.push({ type: 'edge.put', edge });
        for (const membership of Object.values(graph.memberships)) if (membership.containerId === change.id || membership.memberId === change.id) inverse.push({ type: 'membership.put', membership });
        for (const layout of Object.values(graph.layouts)) if (layout.nodeId === change.id || layout.contextNodeId === change.id) inverse.push({ type: 'layout.put', layout });
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
      case 'membership.put': case 'membership.delete': {
        const previous = graph.memberships[membershipKey(change.membership)];
        if (previous) inverse.push({ type: 'membership.put', membership: previous });
        else if (change.type === 'membership.put') inverse.push({ type: 'membership.delete', membership: change.membership });
        break;
      }
      case 'layout.put': case 'layout.delete': {
        const previous = graph.layouts[layoutKey(change.layout)];
        if (previous) inverse.push({ type: 'layout.put', layout: previous });
        else if (change.type === 'layout.put') inverse.push({ type: 'layout.delete', layout: { contextNodeId: change.layout.contextNodeId, nodeId: change.layout.nodeId } });
        break;
      }
    }
  }
  return [...new Map(inverse.map(change => [changeKey(change), change])).values()];
}

export function recordHistory(past: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const previous = past.at(-1);
  if (entry.mergeKey && previous?.mergeKey === entry.mergeKey && entry.time - previous.time < 1500) {
    return [...past.slice(0, -1), { ...entry, undo: previous.undo }];
  }
  return [...past, entry].slice(-100);
}
