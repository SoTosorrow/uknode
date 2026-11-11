import type { Membership } from './model.js';

export function directMemberIds(memberships: Membership[], containerId: string): string[] {
  return memberships.filter(item => item.containerId === containerId).map(item => item.memberId);
}

export function descendantIds(memberships: Membership[], containerId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const { containerId: parent, memberId } of memberships) {
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent)!.push(memberId);
  }
  const visited = new Set<string>([containerId]);
  const pending = [containerId];
  while (pending.length) {
    for (const child of children.get(pending.pop()!) ?? []) {
      if (!visited.has(child)) { visited.add(child); pending.push(child); }
    }
  }
  visited.delete(containerId);
  return visited;
}

// Check the final transaction state, including cycles assembled by several puts.
export function hasMembershipCycle(memberships: Membership[]): boolean {
  const children = new Map<string, string[]>(), incoming = new Map<string, number>();
  for (const { containerId, memberId } of memberships) {
    if (!children.has(containerId)) children.set(containerId, []);
    children.get(containerId)!.push(memberId);
    incoming.set(containerId, incoming.get(containerId) ?? 0);
    incoming.set(memberId, (incoming.get(memberId) ?? 0) + 1);
  }
  const ready = [...incoming.keys()].filter(id => incoming.get(id) === 0);
  let count = 0;
  while (ready.length) {
    count++;
    for (const child of children.get(ready.pop()!) ?? []) {
      const remaining = incoming.get(child)! - 1;
      incoming.set(child, remaining);
      if (!remaining) ready.push(child);
    }
  }
  return count !== incoming.size;
}
