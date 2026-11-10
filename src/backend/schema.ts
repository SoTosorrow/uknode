import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, index, check } from 'drizzle-orm/sqlite-core';

// This file is the source of truth. Change it, generate a migration, then apply it.
// A base node has identity and timestamps only; business fields do not belong here.
export const baseNodes = sqliteTable('base_nodes', {
  id: text('id').primaryKey(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const baseEdges = sqliteTable('base_edges', {
  id: text('id').primaryKey(),
  source: text('source_node_id').notNull().references(() => baseNodes.id, { onDelete: 'cascade' }),
  target: text('target_node_id').notNull().references(() => baseNodes.id, { onDelete: 'cascade' }),
  directed: integer('directed', { mode: 'boolean' }).notNull().default(false),
  label: text('label').notNull().default(''),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, table => [
  index('base_edges_source_idx').on(table.source),
  index('base_edges_target_idx').on(table.target),
  check('base_edges_direction_check', sql`${table.directed} in (0, 1)`),
]);

// One global canvas in this round. Position does not become a node attribute.
export const viewNodeLayouts = sqliteTable('view_node_layouts', {
  nodeId: text('node_id').primaryKey().references(() => baseNodes.id, { onDelete: 'cascade' }),
  x: real('x').notNull(),
  y: real('y').notNull(),
});

export const baseStoreState = sqliteTable('base_store_state', {
  id: integer('id').primaryKey(),
  revision: integer('revision').notNull().default(0),
}, table => [
  check('base_store_state_singleton', sql`${table.id} = 1`),
  check('base_store_state_revision', sql`${table.revision} >= 0`),
]);

// Bounded idempotency receipts, not user edit history or graph versions.
export const baseBatchReceipts = sqliteTable('base_batch_receipts', {
  batchId: text('batch_id').primaryKey(),
  payloadHash: text('payload_hash').notNull(),
  revision: integer('revision').notNull(),
}, table => [index('base_batch_receipts_revision_idx').on(table.revision)]);
