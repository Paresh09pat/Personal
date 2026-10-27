import { ADMIN_ROLES, PARTICIPANT_STATUS, RELATIONSHIP_STATUS, SPACE_KIND } from '@olw/shared';
import { Attachment, Relationship } from '../models/index.js';
import { HttpError, forbidden, notFound } from '../lib/errors.js';
import { sameId, toObjectId } from '../lib/validate.js';

/**
 * THE single gate for every relationship-scoped operation (HTTP, Socket.IO, media, calls).
 *
 * Looks the space up *by id AND by the caller being an active participant* in one query, so a
 * non-member gets exactly the same 404 as for a space that does not exist. Never trusts any
 * relationshipId without this check.
 *
 * @param {import('mongoose').Types.ObjectId|string} userId authenticated user (from the session, never the payload)
 * @param {string} relationshipId untrusted id from a URL, payload or token
 * @param {{ write?: boolean }} [opts] write=true also requires the space to be `active`
 */
export async function requireMember(userId, relationshipId, { write = false } = {}) {
  if (!userId) throw notFound();
  const relId = toObjectId(String(relationshipId ?? ''));
  const rel = await Relationship.findOne({
    _id: relId,
    participants: { $elemMatch: { userId, status: PARTICIPANT_STATUS.ACTIVE } },
  });
  if (!rel) throw notFound();
  const ctx = buildContext(rel, userId);
  if (write) assertWritable(ctx);
  return ctx;
}

export function buildContext(rel, userId) {
  const me = rel.participants.find(
    (p) => sameId(p.userId, userId) && p.status === PARTICIPANT_STATUS.ACTIVE,
  );
  if (!me) throw notFound();
  const kind = rel.kind ?? SPACE_KIND.DIRECT;
  // `others` = every other ACTIVE person. `partner` exists only in 1:1 spaces, so code that wrongly
  // assumes a single partner in a group gets null and fails loudly instead of picking someone at random.
  const others = rel.participants.filter((p) => p.status === PARTICIPANT_STATUS.ACTIVE && !sameId(p.userId, userId));
  const partner =
    kind === SPACE_KIND.DIRECT ? (rel.participants.find((p) => !sameId(p.userId, userId)) ?? null) : null;
  return {
    rel,
    kind,
    relationshipId: rel._id,
    userId: me.userId,
    me,
    partner,
    others,
    isAdmin: ADMIN_ROLES.includes(me.role),
  };
}

export const isGroup = (ctx) => ctx.kind === SPACE_KIND.GROUP;
export const recipientIds = (ctx) => ctx.others.map((p) => p.userId);

export function assertAdmin(ctx) {
  if (!ctx.isAdmin) throw forbidden('Only a group admin can do that');
}

export function assertDirect(ctx, message = 'This is only available in one-to-one chats') {
  if (isGroup(ctx)) throw new HttpError(409, message, { code: 'direct_only' });
}

export function assertWritable(ctx) {
  const { status } = ctx.rel;
  if (status === RELATIONSHIP_STATUS.ACTIVE) return;
  if (status === RELATIONSHIP_STATUS.PENDING) {
    throw new HttpError(403, 'Your partner has not joined this space yet', { code: 'space_pending' });
  }
  throw new HttpError(403, 'This space is read-only', { code: 'space_read_only' });
}

export const isOwner = (ctx) => ctx.me.role === 'owner';

/** The other active participant's id, or null while pending / after they left. */
export const partnerId = (ctx) =>
  ctx.partner && ctx.partner.status === PARTICIPANT_STATUS.ACTIVE ? ctx.partner.userId : null;

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Express middleware for `/api/relationships/:relationshipId/...`. Membership is checked on every
 * request (read level); the resulting context is attached to `req.ctx`.
 */
export function loadMembership() {
  return async (req, _res, next) => {
    req.ctx = await requireMember(req.user?._id, req.params.relationshipId);
    next();
  };
}

/** Blocks mutating requests unless the space is active (archived/ended/pending are read-only). */
export function requireWritableForMutations() {
  return (req, _res, next) => {
    if (!READ_METHODS.has(req.method)) assertWritable(req.ctx);
    next();
  };
}

/**
 * Query helpers that always pin `relationshipId` LAST, so no caller-supplied filter can override it.
 * Route code uses these instead of `Model.findById` (enforced by lint).
 */
export function scoped(Model, ctx) {
  const relationshipId = ctx.relationshipId;
  const pin = (filter = {}) => ({ ...filter, relationshipId });
  return {
    find: (filter, projection, options) => Model.find(pin(filter), projection, options),
    findOne: (filter, projection) => Model.findOne(pin(filter), projection),
    byId: (id, projection) => Model.findOne(pin({ _id: toObjectId(String(id)) }), projection),
    count: (filter) => Model.countDocuments(pin(filter)),
    updateOne: (filter, update, options) => Model.updateOne(pin(filter), update, options),
    updateMany: (filter, update) => Model.updateMany(pin(filter), update),
    findOneAndUpdate: (filter, update, options) =>
      Model.findOneAndUpdate(pin(filter), update, { new: true, ...options }),
    deleteOne: (filter) => Model.deleteOne(pin(filter)),
    create: (doc) => Model.create({ ...doc, relationshipId }),
  };
}

/** Restricted attachments (e.g. unpublished surprise media) are visible only to `restrictedTo`. */
export function canViewAttachment(ctx, attachment) {
  return (
    attachment &&
    sameId(attachment.relationshipId, ctx.relationshipId) &&
    (attachment.restrictedTo == null || sameId(attachment.restrictedTo, ctx.userId))
  );
}

/**
 * Validates attachment ids referenced by a message/memory/album/etc.: every id must be a ready
 * attachment of THIS space. This stops anyone from smuggling another space's media into theirs.
 * `allowOwnRestricted` lets a surprise creator reference their own private uploads.
 */
export async function assertAttachments(ctx, ids, { allowOwnRestricted = false } = {}) {
  const unique = [...new Set((ids ?? []).map(String))];
  if (unique.length === 0) return [];
  const docs = await scoped(Attachment, ctx).find({
    _id: { $in: unique.map((id) => toObjectId(id)) },
    status: 'ready',
  });
  const ok = docs.filter(
    (a) =>
      a.restrictedTo == null || (allowOwnRestricted && sameId(a.restrictedTo, ctx.userId)),
  );
  if (ok.length !== unique.length) {
    throw new HttpError(422, 'One or more attachments are not available', { code: 'bad_attachment' });
  }
  const byId = new Map(ok.map((a) => [String(a._id), a]));
  return unique.map((id) => byId.get(id));
}
