import { createSessionStore } from '../src/runtime/client/session.js';
import { createEditor } from '../src/view/editor-store.js';
import { createGraphService } from '../src/runtime/server/batches.js';
import { openDatabase } from '../src/storage/sqlite.js';

export const createTestEditor = (generateId?: () => string) => createEditor(createSessionStore(generateId));
export const openTestGraph = (filename: string) => createGraphService(openDatabase(filename));
