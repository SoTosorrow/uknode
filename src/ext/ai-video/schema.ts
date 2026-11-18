import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, check } from 'drizzle-orm/sqlite-core';
import type { ImageOptions } from '../../integrations/openai/image-options.js';
import { baseNodes } from '../../storage/schema.js';

// These fields belong to video editing, never to base_nodes/base_edges.
export const videoNodes = sqliteTable('ext_ai_video_nodes', {
  nodeId: text('node_id').primaryKey().references(() => baseNodes.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['image', 'prompt', 'output'] }).notNull(),
  imagePath: text('image_path'),
  imageName: text('image_name'),
  // Per-node text: image generation instructions or a video prompt, according to kind.
  prompt: text('prompt'),
  imageOptions: text('image_options', { mode: 'json' }).$type<ImageOptions>(),
  outputFilename: text('output_filename'),
  steps: integer('steps'),
  inputOrder: text('input_order', { mode: 'json' }).$type<string[]>(),
}, table => [
  check('ext_ai_video_kind', sql`${table.kind} in ('image', 'prompt', 'output')`),
]);
