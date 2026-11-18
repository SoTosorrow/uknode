import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { NodeAttachment } from '../runtime/attachments.js';

// App composition supplies concrete business tables. Calls receive the active
// transaction so node and business changes commit or roll back together.
export interface StorageExtension {
  namespace: string;
  read: (db: BetterSQLite3Database, projectId: string) => NodeAttachment[];
  put: (db: BetterSQLite3Database, attachment: NodeAttachment) => void;
  delete: (db: BetterSQLite3Database, nodeId: string) => void;
}
