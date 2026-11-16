import { graphChangeKey, type GraphChange } from '../core/changes.js';
import { layoutKey, type NodeLayout } from './document.js';

export type Change = GraphChange
  | { type: 'layout.put'; layout: NodeLayout }
  | { type: 'layout.delete'; layout: Pick<NodeLayout, 'contextNodeId' | 'nodeId'> };

export interface ChangeBatch {
  batchId: string;
  expectedRevision: number;
  changes: Change[];
}

export interface Receipt { batchId: string; revision: number }

export function changeKey(change: Change): string {
  switch (change.type) {
    case 'layout.put': case 'layout.delete': return `layout:${layoutKey(change.layout)}`;
    default: return graphChangeKey(change);
  }
}

const id = { type: 'string', minLength: 12, maxLength: 12, pattern: '^[A-Za-z0-9_-]+$' };
const contextNodeId = { anyOf: [id, { type: 'null' }] };
const coordinate = { type: 'number', minimum: -10_000_000, maximum: 10_000_000 };
const object = (properties: Record<string, unknown>) => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
});

export const batchSchema = object({
  batchId: id,
  expectedRevision: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER - 1 },
  changes: {
    type: 'array', minItems: 1, maxItems: 10_000,
    items: { oneOf: [
      object({ type: { const: 'node.put' }, node: object({ id }) }),
      object({ type: { const: 'node.delete' }, id }),
      object({ type: { const: 'edge.put' }, edge: object({
        id, source: id, target: id, directed: { type: 'boolean' }, label: { type: 'string', maxLength: 300 },
      }) }),
      object({ type: { const: 'edge.delete' }, id }),
      object({ type: { enum: ['membership.put', 'membership.delete'] }, membership: object({ containerId: id, memberId: id }) }),
      object({ type: { const: 'layout.put' }, layout: object({ contextNodeId, nodeId: id, x: coordinate, y: coordinate }) }),
      object({ type: { const: 'layout.delete' }, layout: object({ contextNodeId, nodeId: id }) }),
    ] },
  },
});
