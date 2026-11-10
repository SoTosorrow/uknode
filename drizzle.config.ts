import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'drizzle-kit';

const dataDir = resolve(process.env.UKNODE_DATA_DIR || 'data');
mkdirSync(dataDir, { recursive: true });

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/backend/schema.ts',
  out: './migrations',
  dbCredentials: { url: resolve(dataDir, 'uknode.sqlite') },
  migrations: { table: 'base_schema_migrations' },
});
