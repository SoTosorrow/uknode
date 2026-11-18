import { createSessionStore } from '../src/runtime/client/session.js';
import { createEditor } from '../src/view/editor-store.js';
import { createGraphService } from '../src/runtime/server/batches.js';
import { openDatabase } from '../src/storage/sqlite.js';
import type { StorageExtension } from '../src/storage/extensions.js';
import type { ChangeBatch } from '../src/runtime/protocol.js';

export const createTestEditor = () => createEditor(createSessionStore());
export const testProject = { id: 'localProject', business: 'basic', name: 'Test' };

export function openTestGraph(filename: string, extension?: StorageExtension) {
  const service = createGraphService(openDatabase(filename, extension ? [extension] : []));
  const project = service.listProjects()[0] ?? service.createProject('Test', extension?.namespace ?? 'basic');
  return {
    service, project, close: service.close,
    readGraph: () => service.readGraph(project.id),
    applyBatch: (batch: ChangeBatch) => service.applyBatch(project.id, batch),
  };
}
