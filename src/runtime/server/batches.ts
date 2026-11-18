import { GraphError } from '../../core/graph.js';
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
  readGraph: () => GraphData;
  transaction: <T>(work: (tx: BatchTransaction) => T) => T;
  close: () => void;
}

export function createGraphService(storage: GraphStorage) {
  return {
    readGraph: () => storage.readGraph(),
    close: () => storage.close(),
    applyBatch(batch: ChangeBatch): Receipt {
      return storage.transaction(tx => {
        // Check receipts before revision: a successful response may have been lost.
        const receipt = tx.getReceipt(batch.batchId);
        if (receipt) {
          return { batchId: batch.batchId, revision: receipt.revision };
        }
        const revision = tx.getRevision();
        if (revision !== batch.expectedRevision) throw new WriteError('REVISION_CONFLICT', '数据库已被其他页面修改；当前修改仍保留在本页');
        const keys = batch.changes.map(changeKey);
        if (new Set(keys).size !== keys.length) throw new WriteError('DUPLICATE_CHANGE', '同一批次中每个对象只能出现一次');
        try { tx.applyChanges(batch.changes); }
        catch (error) {
          if (error instanceof GraphError) throw new WriteError(error.code, error.message);
          throw error;
        }
        const nextRevision = revision + 1;
        tx.recordReceipt(batch.batchId, nextRevision);
        return { batchId: batch.batchId, revision: nextRevision };
      });
    },
  };
}

export type GraphService = ReturnType<typeof createGraphService>;
