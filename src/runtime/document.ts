import { type BaseNode, type BaseEdge, type Membership, type GraphObjects } from '../core/model.js';
import type { GraphChange } from '../core/changes.js';
import { applyGraphChanges } from '../core/graph.js';
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

export function applyDocumentChanges(document: DocumentObjects, input: Change[]): { document: DocumentObjects; changes: Change[] } {
  const result = applyGraphChanges(document, input.filter((c): c is GraphChange => c.type !== 'layout.put' && c.type !== 'layout.delete'));
  const deletedNodes = new Set(result.changes.filter(c => c.type === 'node.delete').map(c => c.id));
  const layoutChanges = new Map<string, Extract<Change, { type: 'layout.put' | 'layout.delete' }>>();
  if (deletedNodes.size) for (const layout of Object.values(document.layouts)) {
    if (deletedNodes.has(layout.nodeId) || (layout.contextNodeId !== null && deletedNodes.has(layout.contextNodeId))) {
      layoutChanges.set(layoutKey(layout), { type: 'layout.delete', layout: { contextNodeId: layout.contextNodeId, nodeId: layout.nodeId } });
    }
  }
  for (const change of input) if (change.type === 'layout.put' || change.type === 'layout.delete') layoutChanges.set(layoutKey(change.layout), change);
  const layouts = layoutChanges.size ? { ...document.layouts } : document.layouts;
  for (const [key, change] of layoutChanges) {
    if (change.type === 'layout.delete') delete layouts[key];
    else layouts[key] = change.layout;
  }
  return { document: { ...result.graph, layouts }, changes: [...result.changes, ...layoutChanges.values()] };
}
