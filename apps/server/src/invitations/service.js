import mongoose from 'mongoose';
import {
  INVITATION_STATUS,
  MAX_GROUP_PARTICIPANTS,
  PARTICIPANT_ROLE,
  PARTICIPANT_STATUS,
  RELATIONSHIP_STATUS,
  SPACE_KIND,
} from '@olw/shared';
import { Invitation, Relationship, User, pairKeyFor } from '../models/index.js';
import { assertAdmin, isGroup, isOwner } from '../authz/relationship.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { HttpError, conflict, forbidden } from '../lib/errors.js';
import { sameId } from '../lib/validate.js';

const INVALID = () =>
  new HttpError(404, 'This invitation is invalid, already used, or has expired', { code: 'invite_invalid' });

const hashInviteToken = (token) => sha256(String(token));

export async function findValidInvitation(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  return Invitation.findOne({
    tokenHash: hashInviteToken(token),
    status: INVITATION_STATUS.PENDING,
    expiresAt: { $gt: new Date() },
  });
}

/**
 * Creates the (single) live invitation of a space; any previous pending one is revoked first, so
 * "create a new link" also kills the old one. The raw token is returned exactly once; only its
 * SHA-256 is stored.
 *  - 1:1 space: the owner invites the second person while the space is pending (single use).
 *  - group: any admin can make a shareable link that works for several people until it expires.
 */
export async function createInvitation(ctx, input, config) {
  if (isGroup(ctx)) {
    assertAdmin(ctx);
    if (ctx.rel.status !== RELATIONSHIP_STATUS.ACTIVE) throw conflict('This group is read-only', { code: 'space_read_only' });
    if (ctx.others.length + 1 >= MAX_GROUP_PARTICIPANTS) throw conflict('This group is full', { code: 'space_full' });
  } else {
    if (!isOwner(ctx)) throw forbidden('Only the person who created this space can invite');
    if (ctx.rel.status !== RELATIONSHIP_STATUS.PENDING || ctx.rel.participants.length >= 2) {
      throw conflict('This space already has two people', { code: 'space_full' });
    }
  }
  await Invitation.updateMany(
    { relationshipId: ctx.relationshipId, status: INVITATION_STATUS.PENDING },
    { $set: { status: INVITATION_STATUS.REVOKED } },
  );
  const token = randomToken(32);
  const hours = input.expiresInHours ?? config.inviteTtlHours;
  const invitation = await Invitation.create({
    relationshipId: ctx.relationshipId,
    inviterId: ctx.userId,
    tokenHash: hashInviteToken(token),
    inviteeEmail: isGroup(ctx) ? null : (input.inviteeEmail ?? null),
    kind: ctx.kind,
    maxUses: isGroup(ctx) ? (input.maxUses ?? 0) : 1,
    expiresAt: new Date(Date.now() + hours * 60 * 60 * 1000),
  });
  return {
    token,
    url: `${config.appOrigin}/invite/${token}`,
    expiresAt: invitation.expiresAt,
    inviteeEmail: invitation.inviteeEmail,
    maxUses: invitation.maxUses,
  };
}

export async function currentInvitation(ctx) {
  const inv = await Invitation.findOne({
    relationshipId: ctx.relationshipId,
    status: INVITATION_STATUS.PENDING,
    expiresAt: { $gt: new Date() },
  });
  return inv
    ? {
        expiresAt: inv.expiresAt,
        inviteeEmail: inv.inviteeEmail,
        createdAt: inv.createdAt,
        maxUses: inv.maxUses,
        usesCount: inv.usesCount,
      }
    : null;
}

export async function revokeCurrentInvitation(ctx) {
  if (isGroup(ctx)) assertAdmin(ctx);
  else if (!isOwner(ctx)) throw forbidden('Only the person who created this space can revoke invitations');
  const res = await Invitation.updateMany(
    { relationshipId: ctx.relationshipId, status: INVITATION_STATUS.PENDING },
    { $set: { status: INVITATION_STATUS.REVOKED } },
  );
  return { revoked: res.modifiedCount };
}

/** Public, rate-limited: shows only who invited you and the space title. */
export async function previewInvitation(token) {
  const inv = await findValidInvitation(token);
  if (!inv) throw INVALID();
  const group = inv.kind === SPACE_KIND.GROUP;
  const [inviter, rel] = await Promise.all([
    User.findOne({ _id: inv.inviterId, deletedAt: null }, { displayName: 1 }),
    Relationship.findOne({
      _id: inv.relationshipId,
      status: group ? RELATIONSHIP_STATUS.ACTIVE : RELATIONSHIP_STATUS.PENDING,
    }),
  ]);
  if (!inviter || !rel) throw INVALID();
  const inviterParticipant = group
    ? rel.participants.find((p) => sameId(p.userId, inv.inviterId))
    : rel.participants.find((p) => p.role === PARTICIPANT_ROLE.OWNER);
  return {
    kind: group ? SPACE_KIND.GROUP : SPACE_KIND.DIRECT,
    inviterName: inviterParticipant?.displayName || inviter.displayName,
    spaceTitle: rel.title,
    // Only a group link reveals how many people are in it; a 1:1 invite shows nothing beyond who and what.
    ...(group ? { memberCount: rel.participants.filter((p) => p.status === PARTICIPANT_STATUS.ACTIVE).length } : {}),
    expiresAt: inv.expiresAt,
    emailRestricted: Boolean(inv.inviteeEmail),
  };
}

/** Group link: adds the caller as a member (or re-activates someone who left). Runs inside the caller's transaction. */
async function joinGroup(session, user, peek, now) {
  const rel = await Relationship.findOne({ _id: peek.relationshipId }).session(session);
  if (!rel || rel.kind !== SPACE_KIND.GROUP || rel.status !== RELATIONSHIP_STATUS.ACTIVE) throw INVALID();
  const existing = rel.participants.find((p) => sameId(p.userId, user._id));
  // Opening a link twice (or a member opening it) must not fail or use up the link.
  if (existing?.status === PARTICIPANT_STATUS.ACTIVE) return { rel, joined: false };
  if (existing?.status === PARTICIPANT_STATUS.REMOVED) {
    throw forbidden('An admin removed you from this group', { code: 'removed' });
  }
  const active = rel.participants.filter((p) => p.status === PARTICIPANT_STATUS.ACTIVE).length;
  if (active >= MAX_GROUP_PARTICIPANTS) throw conflict('This group is full', { code: 'space_full' });

  // Claim one use of the link. Concurrent joins cannot exceed maxUses, and the member cap is enforced by
  // the schema validator on save (the optimistic-concurrency version check serialises racing saves).
  const claimed = await Invitation.findOneAndUpdate(
    {
      _id: peek._id,
      status: INVITATION_STATUS.PENDING,
      expiresAt: { $gt: now },
      ...(peek.maxUses ? { usesCount: { $lt: peek.maxUses } } : {}),
    },
    { $inc: { usesCount: 1 } },
    { new: true, session },
  );
  if (!claimed) throw INVALID();
  if (claimed.maxUses && claimed.usesCount >= claimed.maxUses) {
    claimed.status = INVITATION_STATUS.ACCEPTED;
    claimed.acceptedAt = now;
    await claimed.save({ session });
  }

  if (existing) {
    Object.assign(existing, { status: PARTICIPANT_STATUS.ACTIVE, leftAt: null, joinedAt: now, role: PARTICIPANT_ROLE.MEMBER });
  } else {
    rel.participants.push({
      userId: user._id,
      role: PARTICIPANT_ROLE.MEMBER,
      status: PARTICIPANT_STATUS.ACTIVE,
      joinedAt: now,
      displayName: '',
    });
  }
  rel.lastActivityAt = now;
  await rel.save({ session });
  return { rel, joined: true };
}

/**
 * Accepts an invitation atomically (Mongo transaction).
 *  1:1 invite:
 *   - claims the token (pending → accepted) so it can never be used twice, even concurrently;
 *   - refuses self-acceptance, wrong invitee email, full/non-pending spaces;
 *   - refuses if the pair already shares an active space (unique pairKey index backs this up);
 *   - adds the caller as the second and final participant and activates the space.
 *  group link: see joinGroup().
 * Returns { relationship, joined } (`joined` is false when the caller was already a member).
 */
export async function acceptInvitation(user, token) {
  const tokenHash = hashInviteToken(token);
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const now = new Date();
      const peek = await Invitation.findOne({ tokenHash, status: INVITATION_STATUS.PENDING, expiresAt: { $gt: now } }).session(session);
      if (!peek) throw INVALID();
      if (peek.inviteeEmail && peek.inviteeEmail !== user.email) {
        throw forbidden('This invitation was sent to a different email address', { code: 'wrong_invitee' });
      }
      if (peek.kind === SPACE_KIND.GROUP) {
        const { rel, joined } = await joinGroup(session, user, peek, now);
        result = { relationship: rel, joined };
        return;
      }

      const inv = await Invitation.findOneAndUpdate(
        { tokenHash, status: INVITATION_STATUS.PENDING, expiresAt: { $gt: now } },
        { $set: { status: INVITATION_STATUS.ACCEPTED, acceptedBy: user._id, acceptedAt: now } },
        { new: true, session },
      );
      if (!inv) throw INVALID();
      if (sameId(inv.inviterId, user._id)) {
        throw new HttpError(400, "You can't accept your own invitation", { code: 'self_invite' });
      }

      const rel = await Relationship.findOne({ _id: inv.relationshipId }).session(session);
      if (!rel || rel.status !== RELATIONSHIP_STATUS.PENDING || rel.participants.length !== 1) {
        throw conflict('This space is no longer accepting a partner', { code: 'space_full' });
      }
      const owner = rel.participants[0];
      if (owner.status !== PARTICIPANT_STATUS.ACTIVE || !sameId(owner.userId, inv.inviterId)) {
        throw INVALID();
      }
      const pairKey = pairKeyFor(owner.userId, user._id);
      const existing = await Relationship.findOne({ pairKey }, { _id: 1 }).session(session);
      if (existing) {
        throw conflict('You already share a space with this person', {
          code: 'duplicate_pair',
          details: { relationshipId: String(existing._id) },
        });
      }

      rel.participants.push({
        userId: user._id,
        role: PARTICIPANT_ROLE.PARTNER,
        status: PARTICIPANT_STATUS.ACTIVE,
        joinedAt: now,
        displayName: '',
      });
      rel.status = RELATIONSHIP_STATUS.ACTIVE;
      rel.pairKey = pairKey;
      rel.lastActivityAt = now;
      await rel.save({ session });
      result = { relationship: rel, joined: true };
    });
  } finally {
    await session.endSession();
  }
  return result;
}

export async function declineInvitation(user, token) {
  const inv = await findValidInvitation(token);
  if (!inv) throw INVALID();
  if (sameId(inv.inviterId, user._id)) throw new HttpError(400, "That's your own invitation");
  if (inv.kind === SPACE_KIND.GROUP) return { declined: true }; // a group link is shared: declining just means not joining
  await Invitation.updateOne(
    { _id: inv._id, status: INVITATION_STATUS.PENDING },
    { $set: { status: INVITATION_STATUS.DECLINED } },
  );
  return { declined: true };
}
