import { type BaseNode, type BaseEdge, type Membership, type GraphObjects } from '../core/model.js';
import type { GraphChange } from '../core/changes.js';
import { applyGraphChanges, deleteGraphObjects } from '../core/graph.js';
import type { Change } from './protocol.js';

// An editing document combines the graph with persistent layouts. The core does
// not depend on coordinates, revision counters or the editor's transient state.
export interface NodeLayout { contextNodeId: string | null; nodeId: string; x: number; y: number }
export function layoutKey({ contextNodeId, nodeId }: Pick<NodeLayout, 'contextNodeId' | 'nodeId'>): string {
  return `${contextNodeId ?? 'global'}:${nodeId}`;
}
export interface GraphData {
  revision: number;
  nodes: BaseNode[];
  edges: BaseEdge[];
  memberships: Membership[];
  layouts: NodeLayout[];
}
export interface DocumentObjects extends GraphObjects { layouts: Record<string, NodeLayout> }

export function applyDocumentChanges(document: DocumentObjects, changes: Change[]): DocumentObjects {
  const graph = applyGraphChanges(document, changes.filter((c): c is GraphChange => c.type !== 'layout.put' && c.type !== 'layout.delete'));
  const layouts = { ...document.layouts };
  for (const change of changes) {
    if (change.type === 'layout.delete') delete layouts[layoutKey(change.layout)];
    if (change.type === 'node.delete') {
      for (const layout of Object.values(layouts)) {
        if (layout.nodeId === change.id || layout.contextNodeId === change.id) delete layouts[layoutKey(layout)];
      }
    }
  }
  for (const change of changes) if (change.type === 'layout.put') layouts[layoutKey(change.layout)] = change.layout;
  return { ...graph, layouts };
}

export function deleteDocumentObjects(document: DocumentObjects, nodeIds: string[], edgeIds: string[] = []): Change[] {
  const nodes = new Set(nodeIds);
  return [
    ...deleteGraphObjects(document, nodeIds, edgeIds),
    ...Object.values(document.layouts).filter(p => nodes.has(p.nodeId) || (p.contextNodeId !== null && nodes.has(p.contextNodeId)))
      .map(({ contextNodeId, nodeId }) => ({ type: 'layout.delete' as const, layout: { contextNodeId, nodeId } })),
  ];
}
