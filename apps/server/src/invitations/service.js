import mongoose from 'mongoose';
import {
  INVITATION_STATUS,
  PARTICIPANT_ROLE,
  PARTICIPANT_STATUS,
  RELATIONSHIP_STATUS,
} from '@olw/shared';
import { Invitation, Relationship, User, pairKeyFor } from '../models/index.js';
import { isOwner } from '../authz/relationship.js';
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
 * Owner creates the (single) live invitation for a pending space. Any previous pending invitation
 * is revoked first. The raw token is returned exactly once; only its SHA-256 is stored.
 */
export async function createInvitation(ctx, input, config) {
  if (!isOwner(ctx)) throw forbidden('Only the person who created this space can invite');
  if (ctx.rel.status !== RELATIONSHIP_STATUS.PENDING || ctx.rel.participants.length >= 2) {
    throw conflict('This space already has two people', { code: 'space_full' });
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
    inviteeEmail: input.inviteeEmail ?? null,
    expiresAt: new Date(Date.now() + hours * 60 * 60 * 1000),
  });
  return {
    token,
    url: `${config.appOrigin}/invite/${token}`,
    expiresAt: invitation.expiresAt,
    inviteeEmail: invitation.inviteeEmail,
  };
}

export async function currentInvitation(ctx) {
  const inv = await Invitation.findOne({
    relationshipId: ctx.relationshipId,
    status: INVITATION_STATUS.PENDING,
    expiresAt: { $gt: new Date() },
  });
  return inv ? { expiresAt: inv.expiresAt, inviteeEmail: inv.inviteeEmail, createdAt: inv.createdAt } : null;
}

export async function revokeCurrentInvitation(ctx) {
  if (!isOwner(ctx)) throw forbidden('Only the person who created this space can revoke invitations');
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
  const [inviter, rel] = await Promise.all([
    User.findOne({ _id: inv.inviterId, deletedAt: null }, { displayName: 1 }),
    Relationship.findOne({ _id: inv.relationshipId, status: RELATIONSHIP_STATUS.PENDING }),
  ]);
  if (!inviter || !rel) throw INVALID();
  const ownerParticipant = rel.participants.find((p) => p.role === PARTICIPANT_ROLE.OWNER);
  return {
    inviterName: ownerParticipant?.displayName || inviter.displayName,
    spaceTitle: rel.title,
    expiresAt: inv.expiresAt,
    emailRestricted: Boolean(inv.inviteeEmail),
  };
}

/**
 * Accepts an invitation atomically (Mongo transaction):
 *  - claims the token (pending → accepted) so it can never be used twice, even concurrently;
 *  - refuses self-acceptance, wrong invitee email, full/non-pending spaces;
 *  - refuses if the pair already shares an active space (unique pairKey index backs this up);
 *  - adds the caller as the second and final participant and activates the space.
 */
export async function acceptInvitation(user, token) {
  const tokenHash = hashInviteToken(token);
  const session = await mongoose.startSession();
  let relationship;
  try {
    await session.withTransaction(async () => {
      const now = new Date();
      const inv = await Invitation.findOneAndUpdate(
        { tokenHash, status: INVITATION_STATUS.PENDING, expiresAt: { $gt: now } },
        { $set: { status: INVITATION_STATUS.ACCEPTED, acceptedBy: user._id, acceptedAt: now } },
        { new: true, session },
      );
      if (!inv) throw INVALID();
      if (sameId(inv.inviterId, user._id)) {
        throw new HttpError(400, "You can't accept your own invitation", { code: 'self_invite' });
      }
      if (inv.inviteeEmail && inv.inviteeEmail !== user.email) {
        throw forbidden('This invitation was sent to a different email address', { code: 'wrong_invitee' });
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
      relationship = rel;
    });
  } finally {
    await session.endSession();
  }
  return relationship;
}

export async function declineInvitation(user, token) {
  const inv = await findValidInvitation(token);
  if (!inv) throw INVALID();
  if (sameId(inv.inviterId, user._id)) throw new HttpError(400, "That's your own invitation");
  await Invitation.updateOne(
    { _id: inv._id, status: INVITATION_STATUS.PENDING },
    { $set: { status: INVITATION_STATUS.DECLINED } },
  );
  return { declined: true };
}
