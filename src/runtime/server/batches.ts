import { createHash } from 'node:crypto';
import { GraphError } from '../../core/graph.js';
import type { GraphData } from '../document.js';
import { changeKey, type Change, type ChangeBatch, type Receipt } from '../protocol.js';
import { WriteError } from '../errors.js';

export interface BatchTransaction {
  getReceipt: (batchId: string) => { payloadHash: string; revision: number } | undefined;
  getRevision: () => number;
  applyChanges: (changes: Change[]) => void;
  recordReceipt: (batchId: string, hash: string, revision: number) => void;
}
export interface GraphStorage {
  readGraph: () => GraphData;
  transaction: <T>(work: (tx: BatchTransaction) => T) => T;
  close: () => void;
}

function payloadHash(batch: ChangeBatch): string {
  // Sort object keys once; every protocol field participates without a second schema.
  const payload = JSON.stringify([batch.expectedRevision, batch.changes], (_, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
  return createHash('sha256').update(payload).digest('hex');
}

export function createGraphService(storage: GraphStorage) {
  return {
    readGraph: () => storage.readGraph(),
    close: () => storage.close(),
    applyBatch(batch: ChangeBatch): Receipt {
      const hash = payloadHash(batch);
      return storage.transaction(tx => {
        // Check receipts before revision: a successful response may have been lost.
        const receipt = tx.getReceipt(batch.batchId);
        if (receipt) {
          if (receipt.payloadHash !== hash) throw new WriteError(409, 'BATCH_MISMATCH', '同一批次 ID 的内容不一致');
          return { batchId: batch.batchId, revision: receipt.revision };
        }
        const revision = tx.getRevision();
        if (revision !== batch.expectedRevision) throw new WriteError(409, 'REVISION_CONFLICT', '数据库已被其他页面修改；当前修改仍保留在本页');
        const keys = batch.changes.map(changeKey);
        if (new Set(keys).size !== keys.length) throw new WriteError(400, 'DUPLICATE_CHANGE', '同一批次中每个对象只能出现一次');
        try { tx.applyChanges(batch.changes); }
        catch (error) {
          if (error instanceof GraphError) throw new WriteError(400, error.code, error.message);
          throw error;
        }
        const nextRevision = revision + 1;
        tx.recordReceipt(batch.batchId, hash, nextRevision);
        return { batchId: batch.batchId, revision: nextRevision };
      });
    },
  };
}

export type GraphService = ReturnType<typeof createGraphService>;
