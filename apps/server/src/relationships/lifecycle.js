import { ADMIN_ROLES, EVENTS, PARTICIPANT_ROLE, PARTICIPANT_STATUS, RELATIONSHIP_STATUS } from '@olw/shared';
import { Attachment, CallRecord, Invitation, Relationship, SCOPED_MODELS } from '../models/index.js';
import { assertAdmin, isGroup, isOwner } from '../authz/relationship.js';
import { postSystemMessage } from '../features/messages.js';
import { loadUsers } from '../lib/serialize.js';
import { HttpError, conflict, forbidden } from '../lib/errors.js';
import { sameId } from '../lib/validate.js';

// See docs/DATA-RETENTION.md — this module implements exactly that policy.

const notify = (hub, rel) =>
  hub.toRelationship(rel._id, EVENTS.RELATIONSHIP_UPDATED, { status: rel.status });

export async function archive(ctx, hub) {
  if (isGroup(ctx)) assertAdmin(ctx);
  if (ctx.rel.status !== RELATIONSHIP_STATUS.ACTIVE) throw conflict('Only an active space can be archived');
  Object.assign(ctx.rel, { status: RELATIONSHIP_STATUS.ARCHIVED, archivedAt: new Date(), archivedBy: ctx.userId });
  await ctx.rel.save();
  notify(hub, ctx.rel);
  return ctx.rel;
}

export async function unarchive(ctx, hub) {
  if (isGroup(ctx)) assertAdmin(ctx);
  if (ctx.rel.status !== RELATIONSHIP_STATUS.ARCHIVED) throw conflict('This space is not archived');
  Object.assign(ctx.rel, { status: RELATIONSHIP_STATUS.ACTIVE, archivedAt: null, archivedBy: null });
  await ctx.rel.save();
  notify(hub, ctx.rel);
  return ctx.rel;
}

async function stopCalls(relationshipId, userId) {
  const calls = await CallRecord.find({ relationshipId, status: { $in: ['ringing', 'active'] } }, { _id: 1 });
  await CallRecord.updateMany(
    { relationshipId, status: { $in: ['ringing', 'active'] } },
    { $set: { status: 'ended', endedAt: new Date(), endedBy: userId } },
  );
  return calls.map((c) => String(c._id));
}

/** Ends a space: read-only forever for both, nothing deleted, pair may start a new space later. */
export async function endRelationship(ctx, hub, { reason = 'ended_by_participant' } = {}) {
  const { rel } = ctx;
  if (isGroup(ctx)) assertAdmin(ctx);
  if (![RELATIONSHIP_STATUS.ACTIVE, RELATIONSHIP_STATUS.ARCHIVED].includes(rel.status)) {
    throw conflict('Only an active or archived space can be ended');
  }
  rel.status = RELATIONSHIP_STATUS.ENDED;
  rel.endedAt = new Date();
  rel.endedBy = ctx.userId;
  rel.endReason = reason;
  rel.pairKey = undefined;
  await rel.save();
  await Invitation.updateMany({ relationshipId: rel._id, status: 'pending' }, { $set: { status: 'revoked' } });
  const callIds = await stopCalls(rel._id, ctx.userId);
  for (const callId of callIds) hub.toCall(callId, EVENTS.CALL_ENDED, { callId, reason: 'space_ended' });
  notify(hub, rel);
  await hub.evictFromRelationship(rel._id, { callIds });
  return rel;
}

/** Hard-deletes every document and stored file belonging to one space. Irreversible. */
export async function purgeRelationship(relationshipId, { storage, hub }) {
  const rel = await Relationship.findOne({ _id: relationshipId });
  if (!rel) return;
  const files = await Attachment.find({ relationshipId }, { storageKey: 1 });
  for (const f of files) {
    try {
      await storage.delete(f.storageKey);
    } catch (err) {
      console.error('[purge] failed to delete stored file', f.storageKey, err.message);
    }
  }
  for (const Model of SCOPED_MODELS) await Model.deleteMany({ relationshipId });
  await Invitation.deleteMany({ relationshipId });
  await Relationship.deleteOne({ _id: relationshipId });
  for (const p of rel.participants) {
    hub.toUser(p.userId, EVENTS.RELATIONSHIP_REMOVED, { relationshipId: String(relationshipId) });
  }
  await hub.evictFromRelationship(relationshipId);
}

/** A pending space never had a partner, so the owner may delete it outright. */
export async function deletePendingSpace(ctx, deps) {
  if (isGroup(ctx)) {
    // A group has no "pending" or "ended" stage: its admin can delete it outright (the route asks for their password).
    assertAdmin(ctx);
    await purgeRelationship(ctx.relationshipId, deps);
    return { deleted: true };
  }
  if (ctx.rel.status !== RELATIONSHIP_STATUS.PENDING || ctx.rel.participants.length !== 1 || !isOwner(ctx)) {
    throw forbidden('Only a space that nobody has joined yet can be deleted directly');
  }
  await purgeRelationship(ctx.relationshipId, deps);
  return { deleted: true };
}

const everyoneAgreed = (rel) =>
  rel.participants.every((p) => rel.deletionRequestedBy.some((u) => sameId(u, p.userId)));

/** Two-party deletion of an ended space. The last required request triggers the purge. */
export async function requestDeletion(ctx, deps) {
  if (isGroup(ctx)) throw new HttpError(409, 'A group admin deletes the group directly from its settings', { code: 'group_delete' });
  if (ctx.rel.status !== RELATIONSHIP_STATUS.ENDED) {
    throw new HttpError(409, 'End the space before requesting deletion', { code: 'not_ended' });
  }
  const updated = await Relationship.findOneAndUpdate(
    { _id: ctx.relationshipId, status: RELATIONSHIP_STATUS.ENDED },
    { $addToSet: { deletionRequestedBy: ctx.userId } },
    { new: true },
  );
  if (updated && everyoneAgreed(updated)) {
    await purgeRelationship(ctx.relationshipId, deps);
    return { purged: true };
  }
  deps.hub.toRelationship(ctx.relationshipId, EVENTS.RELATIONSHIP_UPDATED, { status: ctx.rel.status });
  return { purged: false };
}

export async function withdrawDeletion(ctx) {
  await Relationship.updateOne({ _id: ctx.relationshipId }, { $pull: { deletionRequestedBy: ctx.userId } });
  return { withdrawn: true };
}

/** Used by account deletion: mark the user as having left and agreed to deletion. */
export async function leaveForAccountDeletion(ctx, deps) {
  const { rel } = ctx;
  if (isGroup(ctx)) {
    await leaveGroup(ctx, deps);
    return;
  }
  if (rel.status === RELATIONSHIP_STATUS.PENDING) {
    await purgeRelationship(rel._id, deps);
    return;
  }
  if (rel.status !== RELATIONSHIP_STATUS.ENDED) {
    await endRelationship(ctx, deps.hub, { reason: 'account_deleted' });
  }
  const fresh = await Relationship.findOneAndUpdate(
    { _id: rel._id, 'participants.userId': ctx.userId },
    {
      $set: { 'participants.$.status': PARTICIPANT_STATUS.LEFT, 'participants.$.leftAt': new Date() },
      $addToSet: { deletionRequestedBy: ctx.userId },
    },
    { new: true },
  );
  if (fresh && everyoneAgreed(fresh)) await purgeRelationship(rel._id, deps);
  else deps.hub.toRelationship(rel._id, EVENTS.RELATIONSHIP_UPDATED, { status: RELATIONSHIP_STATUS.ENDED });
}

// ── Groups: membership changes ───────────────────────────────────────────

async function personName(rel, userId) {
  const p = rel.participants.find((x) => sameId(x.userId, userId));
  if (p?.displayName) return p.displayName;
  const users = await loadUsers([userId]);
  return users.get(String(userId))?.displayName || 'Someone';
}

/** Someone stops being a member: tell them, drop their sockets from the space, refresh everyone else. */
async function afterMemberGone(rel, userId, hub) {
  hub.toUser(userId, EVENTS.RELATIONSHIP_REMOVED, { relationshipId: String(rel._id) });
  await hub.evictFromRelationship(rel._id, { userIds: [userId] });
  hub.toRelationship(rel._id, EVENTS.RELATIONSHIP_UPDATED, { status: rel.status });
  for (const p of rel.participants) {
    if (p.status === PARTICIPANT_STATUS.ACTIVE) {
      hub.toUser(p.userId, EVENTS.RELATIONSHIP_UPDATED, { relationshipId: String(rel._id), status: rel.status });
    }
  }
}

/** Anyone can leave a group. The last person leaving deletes it; a leaving last admin hands the role on. */
export async function leaveGroup(ctx, deps) {
  const { rel } = ctx;
  if (!ctx.others.length) {
    await purgeRelationship(rel._id, deps);
    return { deleted: true };
  }
  const name = await personName(rel, ctx.userId);
  const remainingAdmin = ctx.others.some((p) => ADMIN_ROLES.includes(p.role));
  if (ctx.isAdmin && !remainingAdmin) {
    const next = [...ctx.others].sort((a, b) => a.joinedAt - b.joinedAt)[0];
    rel.participants.find((p) => sameId(p.userId, next.userId)).role = PARTICIPANT_ROLE.ADMIN;
  }
  const me = rel.participants.find((p) => sameId(p.userId, ctx.userId));
  Object.assign(me, { status: PARTICIPANT_STATUS.LEFT, leftAt: new Date() });
  await rel.save();
  await postSystemMessage(ctx, `${name} left`, deps.hub);
  await afterMemberGone(rel, ctx.userId, deps.hub);
  return { left: true };
}

/** Admins remove people; only the owner can remove another admin. Removed people cannot rejoin by an old link. */
export async function removeMember(ctx, targetId, hub) {
  assertAdmin(ctx);
  const { rel } = ctx;
  const target = rel.participants.find((p) => sameId(p.userId, targetId) && p.status === PARTICIPANT_STATUS.ACTIVE);
  if (!target) throw new HttpError(404, 'That person is not in this group', { code: 'not_found' });
  if (sameId(target.userId, ctx.userId)) throw new HttpError(400, 'Use "Leave group" to leave yourself');
  if (ADMIN_ROLES.includes(target.role) && ctx.me.role !== PARTICIPANT_ROLE.OWNER) {
    throw forbidden('Only the group owner can remove an admin');
  }
  const name = await personName(rel, target.userId);
  Object.assign(target, { status: PARTICIPANT_STATUS.REMOVED, leftAt: new Date() });
  await rel.save();
  await postSystemMessage(ctx, `${name} was removed`, hub);
  await afterMemberGone(rel, target.userId, hub);
  return { removed: true };
}

/** Admins can promote members; only the owner can demote an admin. The owner's role never changes. */
export async function setMemberRole(ctx, targetId, role, hub) {
  assertAdmin(ctx);
  const { rel } = ctx;
  const target = rel.participants.find((p) => sameId(p.userId, targetId) && p.status === PARTICIPANT_STATUS.ACTIVE);
  if (!target) throw new HttpError(404, 'That person is not in this group', { code: 'not_found' });
  if (target.role === PARTICIPANT_ROLE.OWNER) throw forbidden('The group owner always stays an admin');
  if (role === 'member' && ctx.me.role !== PARTICIPANT_ROLE.OWNER) throw forbidden('Only the group owner can remove admin rights');
  target.role = role === 'admin' ? PARTICIPANT_ROLE.ADMIN : PARTICIPANT_ROLE.MEMBER;
  await rel.save();
  hub.toRelationship(rel._id, EVENTS.RELATIONSHIP_UPDATED, { status: rel.status });
  return { role: target.role };
}
