import {
  LIMITS,
  PARTICIPANT_ROLE,
  PARTICIPANT_STATUS,
  RELATIONSHIP_STATUS,
} from '@olw/shared';
import { Message, Relationship } from '../models/index.js';
import { assertAttachments } from '../authz/relationship.js';
import { HttpError } from '../lib/errors.js';
import { loadUsers, relationshipView } from '../lib/serialize.js';
import { sameId } from '../lib/validate.js';

export async function createRelationship(user, input) {
  const pending = await Relationship.countDocuments({
    createdBy: user._id,
    status: RELATIONSHIP_STATUS.PENDING,
  });
  if (pending >= LIMITS.maxPendingSpacesPerUser) {
    throw new HttpError(429, 'You have too many spaces waiting for a partner. Finish or delete one first.', {
      code: 'too_many_pending',
    });
  }
  return Relationship.create({
    createdBy: user._id,
    title: input.title ?? '',
    participants: [
      {
        userId: user._id,
        role: PARTICIPANT_ROLE.OWNER,
        status: PARTICIPANT_STATUS.ACTIVE,
        displayName: input.myDisplayName ?? '',
      },
    ],
  });
}

/** Unread = partner messages newer than my read marker. */
export function unreadCount(rel, userId) {
  const me = rel.participants.find((p) => sameId(p.userId, userId));
  return Message.countDocuments({
    relationshipId: rel._id,
    senderId: { $ne: userId },
    deletedAt: null,
    ...(me?.lastReadAt ? { createdAt: { $gt: me.lastReadAt } } : {}),
  });
}

async function lastMessagePreview(rel) {
  const m = await Message.findOne({ relationshipId: rel._id, deletedAt: null }).sort({ createdAt: -1, _id: -1 });
  if (!m) return null;
  const label = { image: '📷 Photo', video: '🎬 Video', voice: '🎙 Voice message', file: '📎 Attachment' };
  return {
    senderId: String(m.senderId),
    preview: m.body ? m.body.slice(0, 120) : (label[m.type] ?? ''),
    createdAt: m.createdAt,
  };
}

/** Dashboard: ONLY spaces where the caller is an active participant. */
export async function listForUser(userId) {
  const rels = await Relationship.find({
    participants: { $elemMatch: { userId, status: PARTICIPANT_STATUS.ACTIVE } },
  }).sort({ lastActivityAt: -1 });
  const users = await loadUsers(rels.flatMap((r) => r.participants.map((p) => p.userId)));
  return Promise.all(
    rels.map(async (rel) =>
      relationshipView(rel, userId, users, {
        unreadCount: await unreadCount(rel, userId),
        lastMessage: await lastMessagePreview(rel),
      }),
    ),
  );
}

export async function viewFor(ctx) {
  const users = await loadUsers(ctx.rel.participants.map((p) => p.userId));
  return relationshipView(ctx.rel, ctx.userId, users, {
    unreadCount: await unreadCount(ctx.rel, ctx.userId),
  });
}

const EDITABLE_STATES = new Set([RELATIONSHIP_STATUS.PENDING, RELATIONSHIP_STATUS.ACTIVE]);

/** Shared space settings: either participant, while pending/active. */
export async function updateRelationship(ctx, patch) {
  if (!EDITABLE_STATES.has(ctx.rel.status)) {
    throw new HttpError(403, 'This space is read-only', { code: 'space_read_only' });
  }
  if (patch.coverAttachmentId) await assertAttachments(ctx, [patch.coverAttachmentId]);
  const rel = ctx.rel;
  if (patch.title !== undefined) rel.title = patch.title;
  if (patch.anniversaryDate !== undefined) rel.anniversaryDate = patch.anniversaryDate;
  if (patch.coverAttachmentId !== undefined) rel.coverAttachmentId = patch.coverAttachmentId;
  if (patch.preferences) {
    for (const [k, v] of Object.entries(patch.preferences)) {
      if (v !== undefined) rel.preferences[k] = v;
    }
  }
  await rel.save();
  return rel;
}

/** My own per-space settings (display name, avatar, notifications). Not allowed once ended. */
export async function updateMyParticipant(ctx, patch) {
  if (ctx.rel.status === RELATIONSHIP_STATUS.ENDED) {
    throw new HttpError(403, 'This space has ended', { code: 'space_read_only' });
  }
  if (patch.avatarAttachmentId) await assertAttachments(ctx, [patch.avatarAttachmentId]);
  const me = ctx.rel.participants.find((p) => sameId(p.userId, ctx.userId));
  if (patch.displayName !== undefined) me.displayName = patch.displayName;
  if (patch.avatarAttachmentId !== undefined) me.avatarAttachmentId = patch.avatarAttachmentId;
  if (patch.notificationPrefs) {
    for (const [k, v] of Object.entries(patch.notificationPrefs)) {
      if (v !== undefined) me.notificationPrefs[k] = v;
    }
  }
  await ctx.rel.save();
  return ctx.rel;
}

/** Advance my read marker; never moves backwards. Returns the new marker or null if unchanged. */
export async function markRead(ctx, message) {
  const me = ctx.rel.participants.find((p) => sameId(p.userId, ctx.userId));
  if (me.lastReadAt && me.lastReadAt >= message.createdAt) return null;
  await Relationship.updateOne(
    {
      _id: ctx.relationshipId,
      participants: { $elemMatch: { userId: ctx.userId, status: PARTICIPANT_STATUS.ACTIVE } },
    },
    {
      $set: {
        'participants.$.lastReadAt': message.createdAt,
        'participants.$.lastReadMessageId': message._id,
      },
    },
  );
  return message.createdAt;
}

export const touchActivity = (relationshipId) =>
  Relationship.updateOne({ _id: relationshipId }, { $set: { lastActivityAt: new Date() } });
