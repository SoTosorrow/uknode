import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import SQLite from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { and, eq, isNull, lte } from 'drizzle-orm';
import * as tables from './schema.js';
import type { Membership } from '../core/model.js';
import type { GraphData, NodeLayout } from '../runtime/document.js';
import { validateMemberships } from '../core/graph.js';
import type { Change } from '../runtime/protocol.js';
import type { GraphStorage } from '../runtime/server/batches.js';
import { WriteError } from '../runtime/errors.js';

export function openDatabase(filename: string): GraphStorage {
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true });
  const sqlite = new SQLite(filename);
  const db = drizzle(sqlite);
  const { baseNodes, baseEdges, baseMemberships, viewNodeLayouts, baseStoreState, baseBatchReceipts } = tables;
  const membershipWhere = ({ containerId, memberId }: Membership) => and(eq(baseMemberships.containerId, containerId), eq(baseMemberships.memberId, memberId));
  const layoutWhere = ({ contextNodeId, nodeId }: Pick<NodeLayout, 'contextNodeId' | 'nodeId'>) => and(
    eq(viewNodeLayouts.nodeId, nodeId), contextNodeId === null ? isNull(viewNodeLayouts.contextNodeId) : eq(viewNodeLayouts.contextNodeId, contextNodeId),
  );
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
        directed: baseEdges.directed,
      }).from(baseEdges).orderBy(baseEdges.createdAt, baseEdges.id).all(),
      memberships: tx.select({ containerId: baseMemberships.containerId, memberId: baseMemberships.memberId })
        .from(baseMemberships).orderBy(baseMemberships.containerId, baseMemberships.memberId).all(),
      layouts: tx.select().from(viewNodeLayouts).orderBy(viewNodeLayouts.contextNodeId, viewNodeLayouts.nodeId).all(),
    }));
  }

  const transaction: GraphStorage['transaction'] = work => {
    try {
      return db.transaction(tx => work({
        getReceipt: batchId => tx.select().from(baseBatchReceipts).where(eq(baseBatchReceipts.batchId, batchId)).get(),
        getRevision: () => tx.select().from(baseStoreState).where(eq(baseStoreState.id, 1)).get()!.revision,
        applyChanges(changes: Change[]) {
          for (const change of changes) {
            if (change.type === 'edge.delete') tx.delete(baseEdges).where(eq(baseEdges.id, change.id)).run();
            if (change.type === 'membership.delete') tx.delete(baseMemberships).where(membershipWhere(change.membership)).run();
            if (change.type === 'layout.delete') tx.delete(viewNodeLayouts).where(layoutWhere(change.layout)).run();
            if (change.type === 'node.delete') tx.delete(baseNodes).where(eq(baseNodes.id, change.id)).run();
          }
          const now = Date.now();
          for (const change of changes) {
            if (change.type !== 'node.put') continue;
            tx.insert(baseNodes).values({ ...change.node, createdAt: now, updatedAt: now })
              .onConflictDoNothing({ target: baseNodes.id }).run();
          }
          for (const change of changes) {
            if (change.type === 'membership.put') {
              tx.insert(baseMemberships).values({ ...change.membership, createdAt: now }).onConflictDoNothing().run();
            }
            if (change.type === 'layout.put') {
              const { x, y } = change.layout;
              const where = layoutWhere(change.layout);
              if (tx.select({ nodeId: viewNodeLayouts.nodeId }).from(viewNodeLayouts).where(where).get()) {
                tx.update(viewNodeLayouts).set({ x, y }).where(where).run();
              } else tx.insert(viewNodeLayouts).values(change.layout).run();
            }
            if (change.type === 'edge.put') {
              const edge = change.edge;
              tx.insert(baseEdges).values({ ...edge, createdAt: now, updatedAt: now })
                .onConflictDoUpdate({ target: baseEdges.id, set: { ...edge, updatedAt: now } }).run();
            }
          }
          if (changes.some(change => change.type === 'membership.put')) {
            const memberships = tx.select({ containerId: baseMemberships.containerId, memberId: baseMemberships.memberId }).from(baseMemberships).all();
            validateMemberships(memberships);
          }
        },
        recordReceipt(batchId, hash, revision) {
          tx.update(baseStoreState).set({ revision }).where(eq(baseStoreState.id, 1)).run();
          tx.insert(baseBatchReceipts).values({ batchId, payloadHash: hash, revision }).run();
          tx.delete(baseBatchReceipts).where(lte(baseBatchReceipts.revision, revision - 1000)).run();
        },
      }), { behavior: 'immediate' });
    } catch (error) {
      // Drizzle may wrap a SQLite constraint failure in a query error.
      const cause = error instanceof Error && error.cause ? error.cause : error;
      if (cause instanceof SQLite.SqliteError) {
        if (cause.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') throw new WriteError(400, 'MISSING_NODE', '关联的节点或范围不存在');
        if (cause.code === 'SQLITE_CONSTRAINT_CHECK' && cause.message.includes('base_memberships_not_self')) {
          throw new WriteError(400, 'MEMBERSHIP_CYCLE', '节点不能收录自身或形成包含循环');
        }
      }
      throw error;
    }
  };

  return { readGraph, transaction, close: () => sqlite.close() };
}
