import type { GraphObjects } from '../core/model.js';
import type { Change } from './protocol.js';
import { WriteError } from './errors.js';

export interface NodeGroup { id: string; name: string }
export interface GroupNode { nodeId: string; groupId: string }
export interface GroupState {
  groups: Record<string, NodeGroup>;
  groupByNode: Record<string, string>;
}
export type GroupChange =
  | { type: 'group.put'; group: NodeGroup }
  | { type: 'group.delete'; id: string }
  | { type: 'groupNode.set'; nodeId: string; groupId: string | null };

export function groupAssignments(state: GroupState & Pick<GraphObjects, 'nodes'>, nodeIds: string[], groupId: string | null): GroupChange[] {
  return nodeIds.filter(id => state.nodes[id] && (state.groupByNode[id] ?? null) !== groupId)
    .map(nodeId => ({ type: 'groupNode.set', nodeId, groupId }));
}

export function applyGroupChanges(state: GroupState, input: Change[], nodes: GraphObjects['nodes'], deletedNodes: Set<string>) {
  const definitions = input.filter(change => change.type === 'group.put' || change.type === 'group.delete');
  const groups = definitions.length ? { ...state.groups } : state.groups;
  const dissolved = new Set<string>();
  for (const change of definitions) {
    if (change.type === 'group.put') groups[change.group.id] = change.group;
    else {
      delete groups[change.id];
      dissolved.add(change.id);
    }
  }
  // Record removals in the same undo entry as the node or group that was deleted.
  const assignments = new Map<string, Extract<GroupChange, { type: 'groupNode.set' }>>();
  for (const nodeId of deletedNodes) {
    if (state.groupByNode[nodeId]) assignments.set(nodeId, { type: 'groupNode.set', nodeId, groupId: null });
  }
  if (dissolved.size) {
    for (const [nodeId, groupId] of Object.entries(state.groupByNode)) {
      if (dissolved.has(groupId)) assignments.set(nodeId, { type: 'groupNode.set', nodeId, groupId: null });
    }
  }
  for (const change of input) if (change.type === 'groupNode.set') assignments.set(change.nodeId, change);
  const groupByNode = assignments.size ? { ...state.groupByNode } : state.groupByNode;
  for (const { nodeId, groupId } of assignments.values()) {
    if (groupId === null) delete groupByNode[nodeId];
    else {
      if (!groups[groupId] || !nodes[nodeId]) throw new WriteError('MISSING_GROUP_MEMBER', '节点或节点组已不存在');
      groupByNode[nodeId] = groupId;
    }
  }
  return { groups, groupByNode, changes: [...definitions, ...assignments.values()] };
}
