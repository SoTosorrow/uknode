import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import SQLite from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq, lte } from 'drizzle-orm';
import * as tables from './schema.js';
import type { GraphData } from '../shared/model.js';
import { changeKey, type ChangeBatch, type Receipt } from '../shared/protocol.js';

export class WriteError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
  }
}

function payloadHash(batch: ChangeBatch): string {
  // Hash semantic fields in a fixed order, independent of JSON object key order.
  const changes = batch.changes.map(change => {
    switch (change.type) {
      case 'node.put': return [change.type, change.node.id];
      case 'node.delete': case 'edge.delete': return [change.type, change.id];
      case 'edge.put': {
        const { id, source, target, directed, label } = change.edge;
        return [change.type, id, source, target, directed, label];
      }
      case 'layout.put': return [change.type, change.layout.nodeId, change.layout.x, change.layout.y];
    }
  });
  return createHash('sha256').update(JSON.stringify([batch.expectedRevision, changes])).digest('hex');
}

export function openDatabase(filename: string) {
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true });
  const sqlite = new SQLite(filename);
  const db = drizzle(sqlite);
  const { baseNodes, baseEdges, viewNodeLayouts, baseStoreState, baseBatchReceipts } = tables;
  try {
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('busy_timeout = 5000');
    migrate(db, { migrationsFolder: resolve('migrations'), migrationsTable: 'base_schema_migrations' });
    db.insert(baseStoreState).values({ id: 1, revision: 0 }).onConflictDoNothing().run();
  } catch (error) {
    sqlite.close();
    throw error;
  }

  function readGraph(): GraphData {
    return db.transaction(tx => ({
      revision: tx.select().from(baseStoreState).where(eq(baseStoreState.id, 1)).get()!.revision,
      nodes: tx.select({ id: baseNodes.id }).from(baseNodes).orderBy(baseNodes.createdAt, baseNodes.id).all(),
      edges: tx.select({
        id: baseEdges.id, source: baseEdges.source, target: baseEdges.target,
        directed: baseEdges.directed, label: baseEdges.label,
      }).from(baseEdges).orderBy(baseEdges.createdAt, baseEdges.id).all(),
      layouts: tx.select().from(viewNodeLayouts).orderBy(viewNodeLayouts.nodeId).all(),
    }));
  }

  function applyBatch(batch: ChangeBatch): Receipt {
    const hash = payloadHash(batch);
    return db.transaction(tx => {
      // A retry may arrive after a successful write whose response was lost.
      // Check the receipt before rejecting its now-old expectedRevision.
      const receipt = tx.select().from(baseBatchReceipts).where(eq(baseBatchReceipts.batchId, batch.batchId)).get();
      if (receipt) {
        if (receipt.payloadHash !== hash) throw new WriteError(409, 'BATCH_MISMATCH', '同一批次 ID 的内容不一致');
        return { batchId: receipt.batchId, revision: receipt.revision };
      }
      const { revision } = tx.select().from(baseStoreState).where(eq(baseStoreState.id, 1)).get()!;
      if (revision !== batch.expectedRevision) throw new WriteError(409, 'REVISION_CONFLICT', '数据库已被其他页面修改；当前修改仍保留在本页');
      const keys = batch.changes.map(changeKey);
      if (new Set(keys).size !== keys.length) throw new WriteError(400, 'DUPLICATE_CHANGE', '同一批次中每个对象只能出现一次');

      for (const change of batch.changes) {
        if (change.type === 'edge.delete') tx.delete(baseEdges).where(eq(baseEdges.id, change.id)).run();
        if (change.type === 'node.delete') tx.delete(baseNodes).where(eq(baseNodes.id, change.id)).run();
      }
      const now = Date.now();
      for (const change of batch.changes) {
        if (change.type !== 'node.put') continue;
        tx.insert(baseNodes).values({ ...change.node, createdAt: now, updatedAt: now })
          .onConflictDoNothing({ target: baseNodes.id }).run();
      }
      const nodeExists = (id: string) => Boolean(tx.select({ id: baseNodes.id }).from(baseNodes).where(eq(baseNodes.id, id)).get());
      for (const change of batch.changes) {
        if (change.type === 'layout.put') {
          if (!nodeExists(change.layout.nodeId)) throw new WriteError(400, 'MISSING_NODE', '坐标对应的节点不存在');
          tx.insert(viewNodeLayouts).values(change.layout).onConflictDoUpdate({
            target: viewNodeLayouts.nodeId, set: { x: change.layout.x, y: change.layout.y },
          }).run();
        }
        if (change.type === 'edge.put') {
          const edge = change.edge;
          if (!nodeExists(edge.source) || !nodeExists(edge.target)) throw new WriteError(400, 'MISSING_ENDPOINT', '连线的端点不存在');
          tx.insert(baseEdges).values({ ...edge, createdAt: now, updatedAt: now })
            .onConflictDoUpdate({ target: baseEdges.id, set: { ...edge, updatedAt: now } }).run();
        }
      }
      const nextRevision = revision + 1;
      tx.update(baseStoreState).set({ revision: nextRevision }).where(eq(baseStoreState.id, 1)).run();
      tx.insert(baseBatchReceipts).values({ batchId: batch.batchId, payloadHash: hash, revision: nextRevision }).run();
      tx.delete(baseBatchReceipts).where(lte(baseBatchReceipts.revision, nextRevision - 1000)).run();
      return { batchId: batch.batchId, revision: nextRevision };
    }, { behavior: 'immediate' });
  }

  return { readGraph, applyBatch, close: () => sqlite.close() };
}

export type GraphDatabase = ReturnType<typeof openDatabase>;
