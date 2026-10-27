import {
  LIMITS,
  SPACE_KIND,
  PARTICIPANT_ROLE,
  PARTICIPANT_STATUS,
  RELATIONSHIP_STATUS,
} from '@olw/shared';
import { Message, Relationship, notExpired } from '../models/index.js';
import { assertAttachments } from '../authz/relationship.js';
import { HttpError } from '../lib/errors.js';
import { loadUsers, relationshipView } from '../lib/serialize.js';
import { sameId } from '../lib/validate.js';

export async function createRelationship(user, input) {
  if (input.kind === SPACE_KIND.GROUP) {
    // A group is usable straight away: nobody has to accept anything before the creator can start chatting.
    return Relationship.create({
      kind: SPACE_KIND.GROUP,
      status: RELATIONSHIP_STATUS.ACTIVE,
      createdBy: user._id,
      title: input.title,
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
  const pending = await Relationship.countDocuments({
    kind: { $ne: SPACE_KIND.GROUP },
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
    ...notExpired(),
    ...(me?.lastReadAt ? { createdAt: { $gt: me.lastReadAt } } : {}),
  });
}

async function lastMessagePreview(rel, users) {
  const m = await Message.findOne({ relationshipId: rel._id, deletedAt: null, ...notExpired() }).sort({ createdAt: -1, _id: -1 });
  if (!m) return null;
  const label = { image: '📷 Photo', video: '🎬 Video', voice: '🎙 Voice message', file: '📎 Attachment' };
  // Notices like "Uma joined" belong to nobody, so the list shows them without a "You:" / name prefix.
  if (m.type === 'system') return { senderId: null, senderName: '', preview: m.body.slice(0, 120), createdAt: m.createdAt };
  const sender = rel.participants.find((p) => sameId(p.userId, m.senderId));
  return {
    senderId: String(m.senderId),
    senderName: sender?.displayName || users.get(String(m.senderId))?.displayName || '',
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
        lastMessage: await lastMessagePreview(rel, users),
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
  if (patch.preferences?.wallpaperAttachmentId) await assertAttachments(ctx, [patch.preferences.wallpaperAttachmentId]);
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
