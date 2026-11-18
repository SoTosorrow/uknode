import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import type { StorageExtension } from '../../storage/extensions.js';
import { WriteError } from '../../runtime/errors.js';
import { namespace, parseVideoData, videoAttachment, type VideoData } from './model.js';
import { videoNodes } from './schema.js';

export function videoStorage(directory: string): StorageExtension {
  return {
    namespace,
    read(db) {
      return db.select().from(videoNodes).orderBy(videoNodes.nodeId).all().map(row => {
        const data: VideoData = row.kind === 'image' ? { kind: row.kind, path: row.imagePath, name: row.imageName! }
          : row.kind === 'prompt' ? { kind: row.kind, text: row.prompt! }
            : { kind: row.kind, outputFilename: row.outputFilename!, steps: row.steps, inputOrder: row.inputOrder! };
        return videoAttachment(row.nodeId, data);
      });
    },
    put(db, attachment) {
      const data = parseVideoData(attachment.data);
      if (data.kind === 'image' && data.path && !existsSync(resolve(directory, data.path))) {
        throw new WriteError('MISSING_IMAGE', '图片文件不存在，请重新上传');
      }
      const row = {
        nodeId: attachment.nodeId, kind: data.kind,
        imagePath: data.kind === 'image' ? data.path : null, imageName: data.kind === 'image' ? data.name : null,
        prompt: data.kind === 'prompt' ? data.text : null,
        outputFilename: data.kind === 'output' ? data.outputFilename : null,
        steps: data.kind === 'output' ? data.steps : null, inputOrder: data.kind === 'output' ? data.inputOrder : null,
      };
      db.insert(videoNodes).values(row).onConflictDoUpdate({ target: videoNodes.nodeId, set: row }).run();
    },
    delete(db, nodeId) { db.delete(videoNodes).where(eq(videoNodes.nodeId, nodeId)).run(); },
  };
}
