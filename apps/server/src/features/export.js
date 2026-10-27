import {
  Album,
  Attachment,
  CallRecord,
  Letter,
  LoveNote,
  Memory,
  Message,
  notExpired,
  Milestone,
  Surprise,
} from '../models/index.js';
import { canViewAttachment, scoped } from '../authz/relationship.js';
import { loadUsers, attachmentView, messageView, participantView } from '../lib/serialize.js';
import { letterView, visibleLettersFilter } from './letters.js';
import { visibleSurprisesFilter } from './surprises.js';
import { callView } from './calls.js';

const plain = (doc) => {
  const o = doc.toObject();
  o.id = String(o._id);
  delete o._id;
  delete o.__v;
  return o;
};

/**
 * Export of one space for the requesting participant (see docs/DATA-RETENTION.md → Export).
 * Visibility rules are the same as in the app: no partner drafts, no locked letter bodies,
 * no restricted media, no account data of the partner.
 */
export async function buildExport(ctx, { storage, config }) {
  const s = (Model) => scoped(Model, ctx);
  const [messages, memories, notes, milestones, albums, calls, letters, surprises, attachments] = await Promise.all([
    s(Message).find({ ...notExpired() }).sort({ createdAt: 1 }),
    s(Memory).find({}).sort({ date: 1 }),
    s(LoveNote).find({}).sort({ createdAt: 1 }),
    s(Milestone).find({}).sort({ date: 1 }),
    s(Album).find({}).sort({ createdAt: 1 }),
    s(CallRecord).find({}).sort({ createdAt: 1 }),
    s(Letter).find(visibleLettersFilter(ctx.userId)).sort({ createdAt: 1 }),
    s(Surprise).find(visibleSurprisesFilter(ctx.userId)).sort({ createdAt: 1 }),
    s(Attachment).find({ status: 'ready' }).sort({ createdAt: 1 }),
  ]);

  const viewable = attachments.filter((a) => canViewAttachment(ctx, a));
  const attachmentsById = new Map(viewable.map((a) => [String(a._id), a]));
  const media = [];
  for (const a of viewable) {
    const { url, expiresAt } = await storage.createDownloadUrl({ attachment: a, userId: ctx.userId, ttlMs: 60 * 60 * 1000 });
    media.push({ ...attachmentView(a), downloadUrl: url.startsWith('/') ? `${config.appOrigin}${url}` : url, downloadUrlExpiresAt: expiresAt });
  }

  const users = await loadUsers(ctx.rel.participants.map((p) => p.userId));
  return {
    format: 'our-little-world-export',
    version: 1,
    exportedAt: new Date(),
    exportedBy: String(ctx.userId),
    space: {
      id: String(ctx.rel._id),
      title: ctx.rel.title,
      status: ctx.rel.status,
      anniversaryDate: ctx.rel.anniversaryDate,
      createdAt: ctx.rel.createdAt,
      endedAt: ctx.rel.endedAt,
      participants: ctx.rel.participants.map((p) => participantView(ctx.rel, p, users)),
    },
    messages: messages.map((m) => messageView(m, attachmentsById)),
    memories: memories.map(plain),
    loveNotes: notes.map(plain),
    milestones: milestones.map(plain),
    albums: albums.map(plain),
    calls: calls.map(callView),
    letters: letters.map((l) => letterView(l, ctx.userId)),
    surprises: surprises.map(plain),
    media,
  };
}
