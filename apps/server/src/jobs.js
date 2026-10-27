import { EVENTS } from '@olw/shared';
import { Album, Attachment, Memory, Message } from './models/index.js';
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

/**
 * Disappearing messages: once expiresAt passes, the message and its attached media are erased
 * (record + stored bytes) and pulled out of albums/memories. Reads already hide expired
 * messages instantly; this only reclaims the data.
 */
export async function sweepExpiredMessages({ hub, storage }) {
  const expired = await Message.find({ expiresAt: { $lte: new Date() } }).limit(500);
  const byRelationship = new Map();
  for (const m of expired) {
    const key = String(m.relationshipId);
    byRelationship.set(key, [...(byRelationship.get(key) ?? []), m]);
  }
  for (const [relationshipId, messages] of byRelationship) {
    const attachmentIds = messages.flatMap((m) => m.attachmentIds);
    if (attachmentIds.length) {
      const files = await Attachment.find({ relationshipId, _id: { $in: attachmentIds }, purpose: 'message' });
      for (const f of files) {
        await storage.delete(f.storageKey).catch(() => {});
        await f.deleteOne();
      }
      const gone = files.map((f) => f._id);
      await Album.updateMany({ relationshipId }, { $pull: { attachmentIds: { $in: gone } } });
      await Memory.updateMany({ relationshipId }, { $pull: { mediaIds: { $in: gone } } });
      hub.toRelationship(relationshipId, EVENTS.CONTENT_CHANGED, { kind: 'gallery' });
    }
    await Message.deleteMany({ relationshipId, _id: { $in: messages.map((m) => m._id) } });
  }
  return expired.length;
}

export function startJobs({ hub, storage }) {
  const run = async () => {
    try {
      await revealDueSurprises(hub);
      await expireRingingCalls(hub);
      await sweepExpiredMessages({ hub, storage });
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
