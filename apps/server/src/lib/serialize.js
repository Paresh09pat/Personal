import { ADMIN_ROLES, PARTICIPANT_STATUS, SPACE_KIND } from '@olw/shared';
import { User } from '../models/index.js';
import { sameId } from './validate.js';

export const id = (v) => (v == null ? null : String(v));

export const attachmentContentUrl = (relationshipId, attachmentId) =>
  attachmentId ? `/api/relationships/${relationshipId}/attachments/${attachmentId}/content` : null;

export function publicUser(user) {
  if (!user) return null;
  return {
    id: id(user._id),
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    isAdmin: user.role === 'admin',
    emailVerified: Boolean(user.emailVerifiedAt),
    onboarded: Boolean(user.onboardedAt),
    createdAt: user.createdAt,
  };
}

export async function loadUsers(ids) {
  const unique = [...new Set(ids.map(String))];
  const users = await User.find({ _id: { $in: unique } }, { displayName: 1, deletedAt: 1 });
  return new Map(users.map((u) => [String(u._id), u]));
}

export function participantView(rel, p, users) {
  if (!p) return null;
  const user = users.get(String(p.userId));
  const deleted = !user || user.deletedAt;
  return {
    userId: id(p.userId),
    role: p.role,
    status: p.status,
    displayName: deleted ? 'Deleted user' : p.displayName || user.displayName,
    avatarUrl: deleted ? null : attachmentContentUrl(rel._id, p.avatarAttachmentId),
    joinedAt: p.joinedAt,
  };
}

/** A space as seen by `userId`. Never includes the partner's private settings. */
export function relationshipView(rel, userId, users, extra = {}) {
  const me = rel.participants.find((p) => sameId(p.userId, userId));
  const kind = rel.kind ?? SPACE_KIND.DIRECT;
  const partner = kind === SPACE_KIND.DIRECT ? (rel.participants.find((p) => !sameId(p.userId, userId)) ?? null) : null;
  const active = rel.participants.filter((p) => p.status === PARTICIPANT_STATUS.ACTIVE);
  return {
    id: id(rel._id),
    kind,
    memberCount: active.length,
    members:
      kind === SPACE_KIND.GROUP
        ? active.map((p) => ({
            ...participantView(rel, p, users),
            isMe: sameId(p.userId, userId),
            lastReadAt: p.lastReadAt,
          }))
        : undefined,
    status: rel.status,
    title: rel.title,
    anniversaryDate: rel.anniversaryDate,
    preferences: rel.preferences,
    coverUrl: attachmentContentUrl(rel._id, rel.coverAttachmentId),
    wallpaperUrl: attachmentContentUrl(rel._id, rel.preferences?.wallpaperAttachmentId),
    coverAttachmentId: id(rel.coverAttachmentId),
    createdAt: rel.createdAt,
    lastActivityAt: rel.lastActivityAt,
    archivedAt: rel.archivedAt,
    endedAt: rel.endedAt,
    me: {
      ...participantView(rel, me, users),
      ownDisplayName: me.displayName,
      isAdmin: ADMIN_ROLES.includes(me.role),
      avatarAttachmentId: id(me.avatarAttachmentId),
      notificationPrefs: me.notificationPrefs,
      lastReadAt: me.lastReadAt,
    },
    partner: partner ? { ...participantView(rel, partner, users), lastReadAt: partner.lastReadAt } : null,
    partnerActive: partner?.status === PARTICIPANT_STATUS.ACTIVE,
    deletionRequestedByMe: rel.deletionRequestedBy.some((u) => sameId(u, userId)),
    deletionRequestedByPartner: partner
      ? rel.deletionRequestedBy.some((u) => sameId(u, partner.userId))
      : false,
    ...extra,
  };
}

export function attachmentView(a) {
  return {
    id: id(a._id),
    kind: a.kind,
    mime: a.mime,
    size: a.size,
    fileName: a.fileName,
    durationMs: a.durationMs,
    uploaderId: id(a.uploaderId),
    purpose: a.purpose,
    createdAt: a.createdAt,
    url: attachmentContentUrl(a.relationshipId, a._id),
  };
}

export function messageView(m, attachmentsById = new Map()) {
  const deleted = Boolean(m.deletedAt);
  return {
    id: id(m._id),
    relationshipId: id(m.relationshipId),
    senderId: id(m.senderId),
    clientId: m.clientId,
    type: deleted ? 'system' : m.type,
    body: deleted ? '' : m.body,
    deleted,
    attachments: deleted
      ? []
      : m.attachmentIds.map((a) => attachmentsById.get(String(a))).filter(Boolean).map(attachmentView),
    replyToId: id(m.replyToId),
    reactions: m.reactions.map((r) => ({ userId: id(r.userId), emoji: r.emoji })),
    editedAt: m.editedAt,
    expiresAt: m.expiresAt ?? null,
    createdAt: m.createdAt,
  };
}
