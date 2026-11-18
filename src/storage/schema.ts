import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, index, primaryKey, check } from 'drizzle-orm/sqlite-core';

// This file is the source of truth. Change it, generate a migration, then apply it.
export const baseProjects = sqliteTable('base_projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  business: text('business').notNull(),
  revision: integer('revision').notNull().default(0),
});

export const baseNodes = sqliteTable('base_nodes', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => baseProjects.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, table => [index('base_nodes_project_idx').on(table.projectId)]);

export const baseEdges = sqliteTable('base_edges', {
  id: text('id').primaryKey(),
  source: text('source_node_id').notNull().references(() => baseNodes.id, { onDelete: 'cascade' }),
  target: text('target_node_id').notNull().references(() => baseNodes.id, { onDelete: 'cascade' }),
  directed: integer('directed', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, table => [
  index('base_edges_source_idx').on(table.source),
  index('base_edges_target_idx').on(table.target),
  check('base_edges_direction_check', sql`${table.directed} in (0, 1)`),
]);

export const viewNodeLayouts = sqliteTable('view_node_layouts', {
  nodeId: text('node_id').primaryKey().references(() => baseNodes.id, { onDelete: 'cascade' }),
  x: real('x').notNull(),
  y: real('y').notNull(),
});

export const viewNodeGroups = sqliteTable('view_node_groups', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => baseProjects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
}, table => [index('view_node_groups_project_idx').on(table.projectId)]);

export const viewGroupNodes = sqliteTable('view_group_nodes', {
  nodeId: text('node_id').primaryKey().references(() => baseNodes.id, { onDelete: 'cascade' }),
  groupId: text('group_id').notNull().references(() => viewNodeGroups.id, { onDelete: 'cascade' }),
}, table => [index('view_group_nodes_group_idx').on(table.groupId)]);

export const baseBatchReceipts = sqliteTable('base_batch_receipts', {
  projectId: text('project_id').notNull().references(() => baseProjects.id, { onDelete: 'cascade' }),
  batchId: text('batch_id').notNull(),
  revision: integer('revision').notNull(),
}, table => [
  primaryKey({ columns: [table.projectId, table.batchId] }),
  index('base_batch_receipts_revision_idx').on(table.projectId, table.revision),
]);
