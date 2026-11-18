import type { Project } from '../../core/model.js';
import type { GraphData } from '../document.js';
import { changeKey, type Change, type ChangeBatch, type Receipt } from '../protocol.js';
import { WriteError } from '../errors.js';

export interface BatchTransaction {
  getReceipt: (batchId: string) => { revision: number } | undefined;
  getRevision: () => number;
  applyChanges: (changes: Change[]) => void;
  recordReceipt: (batchId: string, revision: number) => void;
}
export interface GraphStorage {
  listProjects: () => Project[];
  createProject: (name: string, business: string) => Project;
  readGraph: (projectId: string) => GraphData;
  transaction: <T>(projectId: string, work: (tx: BatchTransaction) => T) => T;
  close: () => void;
}

export function createGraphService(storage: GraphStorage) {
  return {
    listProjects: storage.listProjects,
    createProject: storage.createProject,
    readGraph: storage.readGraph,
    close: () => storage.close(),
    applyBatch(projectId: string, batch: ChangeBatch): Receipt {
      return storage.transaction(projectId, tx => {
        // Check receipts before revision: a successful response may have been lost.
        const receipt = tx.getReceipt(batch.batchId);
        if (receipt) {
          return { batchId: batch.batchId, revision: receipt.revision };
        }
        const revision = tx.getRevision();
        if (revision !== batch.expectedRevision) throw new WriteError('REVISION_CONFLICT', '数据库已被其他页面修改；当前修改仍保留在本页');
        const keys = batch.changes.map(changeKey);
        if (new Set(keys).size !== keys.length) throw new WriteError('DUPLICATE_CHANGE', '同一批次中每个对象只能出现一次');
        tx.applyChanges(batch.changes);
        const nextRevision = revision + 1;
        tx.recordReceipt(batch.batchId, nextRevision);
        return { batchId: batch.batchId, revision: nextRevision };
      });
    },
  };
}

export type GraphService = ReturnType<typeof createGraphService>;
