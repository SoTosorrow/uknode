import { membershipKey } from '../../core/model.js';
import { layoutKey, type DocumentObjects } from '../document.js';
import type { Change } from '../protocol.js';

export interface HistoryEntry {
  undo: Change[];
  redo: Change[];
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
  return inverse;
}
