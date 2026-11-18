import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import SQLite from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { and, eq, inArray, lte, ne } from 'drizzle-orm';
import { baseProjects, baseNodes, baseEdges, viewNodeLayouts, viewNodeGroups, viewGroupNodes, baseBatchReceipts } from './schema.js';
import type { GraphData } from '../runtime/document.js';
import type { GraphStorage } from '../runtime/server/batches.js';
import { WriteError } from '../runtime/errors.js';
import type { StorageExtension } from './extensions.js';

export function openDatabase(filename: string, extensions: StorageExtension[] = []): GraphStorage & { db: BetterSQLite3Database } {
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true });
  const sqlite = new SQLite(filename);
  const db = drizzle(sqlite);
  try {
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('busy_timeout = 5000');
    migrate(db, { migrationsFolder: resolve('migrations'), migrationsTable: 'base_schema_migrations' });
  } catch (error) {
    sqlite.close();
    throw error;
  }

  const projectFields = { id: baseProjects.id, business: baseProjects.business, name: baseProjects.name };
  function projectById(projectId: string) {
    const row = db.select().from(baseProjects).where(eq(baseProjects.id, projectId)).get();
    if (!row) throw new WriteError('PROJECT_NOT_FOUND', '项目不存在');
    return row;
  }
  function readGraph(projectId: string): GraphData {
    return db.transaction(tx => {
      const { revision, ...project } = projectById(projectId);
      const scope = eq(baseNodes.projectId, projectId);
      return {
        project, revision,
        groups: tx.select({ id: viewNodeGroups.id, name: viewNodeGroups.name }).from(viewNodeGroups)
          .where(eq(viewNodeGroups.projectId, projectId)).orderBy(viewNodeGroups.name, viewNodeGroups.id).all(),
        groupNodes: tx.select({ groupId: viewGroupNodes.groupId, nodeId: viewGroupNodes.nodeId }).from(viewGroupNodes)
          .innerJoin(viewNodeGroups, eq(viewNodeGroups.id, viewGroupNodes.groupId))
          .where(eq(viewNodeGroups.projectId, projectId)).orderBy(viewGroupNodes.nodeId).all(),
        attachments: extensions.filter(ext => ext.namespace === project.business).flatMap(ext => ext.read(tx, projectId)),
        nodes: tx.select({ id: baseNodes.id }).from(baseNodes).where(scope).orderBy(baseNodes.createdAt, baseNodes.id).all(),
        edges: tx.select({ id: baseEdges.id, source: baseEdges.source, target: baseEdges.target, directed: baseEdges.directed })
          .from(baseEdges).innerJoin(baseNodes, eq(baseNodes.id, baseEdges.source)).where(scope)
          .orderBy(baseEdges.createdAt, baseEdges.id).all(),
        layouts: tx.select({ nodeId: viewNodeLayouts.nodeId, x: viewNodeLayouts.x, y: viewNodeLayouts.y })
          .from(viewNodeLayouts).innerJoin(baseNodes, eq(baseNodes.id, viewNodeLayouts.nodeId)).where(scope)
          .orderBy(viewNodeLayouts.nodeId).all(),
      };
    });
  }

  const transaction: GraphStorage['transaction'] = (projectId, work) => {
    try {
      return db.transaction(tx => {
        const project = projectById(projectId);
        const extension = extensions.find(ext => ext.namespace === project.business);
        return work({
          getRevision: () => project.revision,
          getReceipt: batchId => tx.select({ revision: baseBatchReceipts.revision }).from(baseBatchReceipts)
            .where(and(eq(baseBatchReceipts.projectId, projectId), eq(baseBatchReceipts.batchId, batchId))).get(),
          applyChanges(changes) {
            // Check existing owners before deletes or upserts can change the graph.
            const nodes = new Set<string>(), edges = new Set<string>(), groups = new Set<string>();
            for (const change of changes) {
              switch (change.type) {
                case 'group.put': groups.add(change.group.id); break;
                case 'group.delete': groups.add(change.id); break;
                case 'groupNode.set':
                  nodes.add(change.nodeId);
                  if (change.groupId !== null) groups.add(change.groupId);
                  break;
                case 'node.put': nodes.add(change.node.id); break;
                case 'node.delete': nodes.add(change.id); break;
                case 'edge.put': edges.add(change.edge.id); nodes.add(change.edge.source); nodes.add(change.edge.target); break;
                case 'edge.delete': edges.add(change.id); break;
                case 'layout.put': case 'layout.delete': nodes.add(change.layout.nodeId); break;
                case 'attachment.put': case 'attachment.delete':
                  if (extension?.namespace !== change.attachment.namespace) throw new WriteError('UNKNOWN_EXTENSION', '业务数据与所选项目不符');
                  nodes.add(change.attachment.nodeId);
                  break;
              }
            }
            const outside = ne(baseNodes.projectId, projectId);
            const foreignNode = tx.select({ id: baseNodes.id }).from(baseNodes).where(and(inArray(baseNodes.id, [...nodes]), outside)).get();
            const foreignEdge = edges.size && tx.select({ id: baseEdges.id }).from(baseEdges).innerJoin(baseNodes, eq(baseNodes.id, baseEdges.source))
              .where(and(inArray(baseEdges.id, [...edges]), outside)).get();
            const foreignGroup = groups.size && tx.select({ id: viewNodeGroups.id }).from(viewNodeGroups)
              .where(and(inArray(viewNodeGroups.id, [...groups]), ne(viewNodeGroups.projectId, projectId))).get();
            if (foreignNode || foreignEdge || foreignGroup) throw new WriteError('PROJECT_BOUNDARY', '只能修改本项目的节点、连线和节点组');
            for (const change of changes) {
              if (change.type === 'group.delete') tx.delete(viewNodeGroups).where(eq(viewNodeGroups.id, change.id)).run();
              if (change.type === 'groupNode.set' && change.groupId === null) tx.delete(viewGroupNodes).where(eq(viewGroupNodes.nodeId, change.nodeId)).run();
              if (change.type === 'attachment.delete') extension!.delete(tx, change.attachment.nodeId);
              if (change.type === 'edge.delete') tx.delete(baseEdges).where(eq(baseEdges.id, change.id)).run();
              if (change.type === 'layout.delete') tx.delete(viewNodeLayouts).where(eq(viewNodeLayouts.nodeId, change.layout.nodeId)).run();
              if (change.type === 'node.delete') tx.delete(baseNodes).where(eq(baseNodes.id, change.id)).run();
            }
            const now = Date.now();
            for (const change of changes) if (change.type === 'node.put') {
              tx.insert(baseNodes).values({ id: change.node.id, projectId, createdAt: now, updatedAt: now }).onConflictDoNothing().run();
            }
            for (const change of changes) if (change.type === 'group.put') {
              const name = change.group.name.trim();
              if (!name || name.length > 100) throw new WriteError('INVALID_GROUP_NAME', '请输入 1–100 字的节点组名称');
              tx.insert(viewNodeGroups).values({ id: change.group.id, projectId, name })
                .onConflictDoUpdate({ target: viewNodeGroups.id, set: { name } }).run();
            }
            for (const change of changes) {
              if (change.type === 'groupNode.set' && change.groupId !== null) {
                const { nodeId, groupId } = change;
                tx.insert(viewGroupNodes).values({ nodeId, groupId })
                  .onConflictDoUpdate({ target: viewGroupNodes.nodeId, set: { groupId } }).run();
              }
              if (change.type === 'attachment.put') extension!.put(tx, change.attachment);
              if (change.type === 'layout.put') tx.insert(viewNodeLayouts).values(change.layout)
                .onConflictDoUpdate({ target: viewNodeLayouts.nodeId, set: { x: change.layout.x, y: change.layout.y } }).run();
              if (change.type === 'edge.put') tx.insert(baseEdges).values({ ...change.edge, createdAt: now, updatedAt: now })
                .onConflictDoUpdate({ target: baseEdges.id, set: { ...change.edge, updatedAt: now } }).run();
            }
          },
          recordReceipt(batchId, revision) {
            tx.update(baseProjects).set({ revision }).where(eq(baseProjects.id, projectId)).run();
            tx.insert(baseBatchReceipts).values({ projectId, batchId, revision }).run();
            tx.delete(baseBatchReceipts).where(and(eq(baseBatchReceipts.projectId, projectId), lte(baseBatchReceipts.revision, revision - 1000))).run();
          },
        });
      }, { behavior: 'immediate' });
    } catch (error) {
      const cause = error instanceof Error && error.cause ? error.cause : error;
      if (cause instanceof SQLite.SqliteError && cause.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
        throw new WriteError('MISSING_NODE', '关联的节点不存在或目标节点组不存在');
      }
      throw error;
    }
  };

  return {
    db,
    listProjects: () => db.select(projectFields).from(baseProjects).orderBy(baseProjects.name, baseProjects.id).all(),
    createProject(name, business) {
      const project = { id: nanoid(12), name: name.trim(), business };
      if (!project.name || project.name.length > 100) throw new WriteError('INVALID_PROJECT_NAME', '请输入 1–100 字的项目名称');
      if (business !== 'basic' && !extensions.some(ext => ext.namespace === business)) throw new WriteError('UNKNOWN_EXTENSION', '未知项目业务');
      db.insert(baseProjects).values(project).run();
      return project;
    },
    readGraph, transaction, close: () => sqlite.close(),
  };
}
