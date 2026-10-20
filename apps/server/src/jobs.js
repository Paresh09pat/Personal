import { Attachment } from './models/index.js';
import { revealDueSurprises } from './features/surprises.js';
import { expireRingingCalls } from './features/calls.js';

const PENDING_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

/** Uploads that were never completed are removed after 24 h (record + stored bytes). */
export async function sweepAbandonedUploads(storage) {
  const stale = await Attachment.find({
    status: 'pending',
    createdAt: { $lt: new Date(Date.now() - PENDING_UPLOAD_TTL_MS) },
  }).limit(500);
  for (const a of stale) {
    await storage.delete(a.storageKey).catch(() => {});
    await a.deleteOne();
  }
  return stale.length;
}

export function startJobs({ hub, storage }) {
  const run = async () => {
    try {
      await revealDueSurprises(hub);
      await expireRingingCalls(hub);
    } catch (err) {
      console.error('[jobs]', err.message);
    }
  };
  const fast = setInterval(run, 30 * 1000);
  const slow = setInterval(() => sweepAbandonedUploads(storage).catch(() => {}), 60 * 60 * 1000);
  fast.unref();
  slow.unref();
  return () => {
    clearInterval(fast);
    clearInterval(slow);
  };
}
