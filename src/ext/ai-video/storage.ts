import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { StorageExtension } from '../../storage/extensions.js';
import { WriteError } from '../../runtime/errors.js';
import { baseNodes, baseProjects } from '../../storage/schema.js';
import { namespace, parseVideoData, videoAttachment, type VideoData } from './model.js';
import { videoNodes } from './schema.js';

export function findImageReferences(db: BetterSQLite3Database, filename: string) {
  return db.select({ projectId: baseProjects.id, projectName: baseProjects.name, nodeId: videoNodes.nodeId })
    .from(videoNodes)
    .innerJoin(baseNodes, eq(baseNodes.id, videoNodes.nodeId))
    .innerJoin(baseProjects, eq(baseProjects.id, baseNodes.projectId))
    .where(and(eq(baseProjects.business, namespace), eq(videoNodes.kind, 'image'), eq(videoNodes.imagePath, 'assets/' + filename)))
    .orderBy(baseProjects.name, baseProjects.id, videoNodes.nodeId).all();
}

export function videoStorage(directory: string): StorageExtension {
  return {
    namespace,
    read(db, projectId) {
      return db.select().from(videoNodes).innerJoin(baseNodes, eq(baseNodes.id, videoNodes.nodeId))
        .where(eq(baseNodes.projectId, projectId)).orderBy(videoNodes.nodeId).all().map(({ ext_ai_video_nodes: row }) => {
        const data: VideoData = row.kind === 'image' ? { kind: row.kind, path: row.imagePath, name: row.imageName!, prompt: row.prompt ?? '', ...(row.imageOptions && { options: row.imageOptions }) }
          : row.kind === 'prompt' ? { kind: row.kind, text: row.prompt! }
            : { kind: row.kind, outputFilename: row.outputFilename!, steps: row.steps, inputOrder: row.inputOrder! };
        return videoAttachment(row.nodeId, data);
      });
    },
    put(db, attachment) {
      const data = parseVideoData(attachment.data);
      if (data.kind === 'image' && data.path && !existsSync(resolve(directory, data.path))) {
        // An existing broken reference can still save its prompt while the user repairs it.
        const previous = db.select({ path: videoNodes.imagePath }).from(videoNodes).where(eq(videoNodes.nodeId, attachment.nodeId)).get();
        if (previous?.path !== data.path) throw new WriteError('MISSING_IMAGE', '图片文件不存在，请重新上传');
      }
      const row = {
        nodeId: attachment.nodeId, kind: data.kind,
        imageOptions: data.kind === 'image' ? data.options ?? null : null,
        imagePath: data.kind === 'image' ? data.path : null, imageName: data.kind === 'image' ? data.name : null,
        prompt: data.kind === 'image' ? data.prompt : data.kind === 'prompt' ? data.text : null,
        outputFilename: data.kind === 'output' ? data.outputFilename : null,
        steps: data.kind === 'output' ? data.steps : null, inputOrder: data.kind === 'output' ? data.inputOrder : null,
      };
      db.insert(videoNodes).values(row).onConflictDoUpdate({ target: videoNodes.nodeId, set: row }).run();
    },
    delete(db, nodeId) { db.delete(videoNodes).where(eq(videoNodes.nodeId, nodeId)).run(); },
  };
}
