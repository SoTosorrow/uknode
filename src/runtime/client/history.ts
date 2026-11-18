import { type DocumentObjects } from '../document.js';
import type { Change } from '../protocol.js';
import { attachmentKey } from '../attachments.js';

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
      case 'attachment.put': case 'attachment.delete': {
        const previous = graph.attachments[attachmentKey(change.attachment)];
        if (previous) inverse.push({ type: 'attachment.put', attachment: previous });
        else if (change.type === 'attachment.put') inverse.push({ type: 'attachment.delete', attachment: {
          namespace: change.attachment.namespace, nodeId: change.attachment.nodeId,
        } });
        break;
      }
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
      case 'layout.put': case 'layout.delete': {
        const previous = graph.layouts[change.layout.nodeId];
        if (previous) inverse.push({ type: 'layout.put', layout: previous });
        else if (change.type === 'layout.put') inverse.push({ type: 'layout.delete', layout: { nodeId: change.layout.nodeId } });
        break;
      }
    }
  }
  return inverse;
}
