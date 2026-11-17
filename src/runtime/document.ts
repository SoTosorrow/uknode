import { type BaseNode, type BaseEdge, type Membership, type GraphObjects } from '../core/model.js';
import type { GraphChange } from '../core/changes.js';
import { applyGraphChanges } from '../core/graph.js';
import type { Change } from './protocol.js';
import { attachmentKey, type NodeAttachment } from './attachments.js';

// An editing document combines the graph with persistent layouts. The core does
// not depend on coordinates, revision counters or the editor's transient state.
export interface NodeLayout { contextNodeId: string | null; nodeId: string; x: number; y: number }
export function layoutKey({ contextNodeId, nodeId }: Pick<NodeLayout, 'contextNodeId' | 'nodeId'>): string {
  return `${contextNodeId ?? 'global'}:${nodeId}`;
}
export interface GraphData {
  attachments: NodeAttachment[];
  revision: number;
  nodes: BaseNode[];
  edges: BaseEdge[];
  memberships: Membership[];
  layouts: NodeLayout[];
}
export interface DocumentObjects extends GraphObjects {
  layouts: Record<string, NodeLayout>;
  attachments: Record<string, NodeAttachment>;
}

export function applyDocumentChanges(document: DocumentObjects, input: Change[]): { document: DocumentObjects; changes: Change[] } {
  const result = applyGraphChanges(document, input.filter((c): c is GraphChange =>
    c.type.startsWith('node.') || c.type.startsWith('edge.') || c.type.startsWith('membership.')));
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
  const attachmentChanges = new Map<string, Extract<Change, { type: 'attachment.put' | 'attachment.delete' }>>();
  if (deletedNodes.size) for (const attachment of Object.values(document.attachments)) {
    if (deletedNodes.has(attachment.nodeId)) attachmentChanges.set(attachmentKey(attachment), {
      type: 'attachment.delete', attachment: { namespace: attachment.namespace, nodeId: attachment.nodeId },
    });
  }
  for (const change of input) if (change.type === 'attachment.put' || change.type === 'attachment.delete') {
    attachmentChanges.set(attachmentKey(change.attachment), change);
  }
  const attachments = attachmentChanges.size ? { ...document.attachments } : document.attachments;
  for (const [key, change] of attachmentChanges) {
    if (change.type === 'attachment.delete') delete attachments[key];
    else {
      if (!result.graph.nodes[change.attachment.nodeId]) throw new Error('业务数据对应的节点不存在');
      attachments[key] = change.attachment;
    }
  }
  return { document: { ...result.graph, layouts, attachments }, changes: [...result.changes, ...layoutChanges.values(), ...attachmentChanges.values()] };
}
