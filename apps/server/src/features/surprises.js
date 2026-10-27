import express from 'express';
import { SURPRISE_STATUS, surpriseSchema } from '@olw/shared';
import { Attachment, Relationship, Surprise } from '../models/index.js';
import { assertAttachments, assertDirect, buildContext, partnerId, scoped } from '../authz/relationship.js';
import { HttpError, forbidden, notFound } from '../lib/errors.js';
import { parse, parsePatch, sameId, toObjectId } from '../lib/validate.js';
import { id } from '../lib/serialize.js';
import { contentChanged, notifyPartner } from './notify.js';
import { mediaLookup } from './crud.js';

const { DRAFT, SCHEDULED, REVEALED } = SURPRISE_STATUS;

/**
 * What a user may see: everything they created, plus surprises addressed to them that are revealed.
 * Drafts and not-yet-due scheduled surprises are invisible to the recipient — same 404 as "missing".
 */
export const visibleSurprisesFilter = (userId) => ({
  $or: [{ creatorId: userId }, { recipientId: userId, status: REVEALED }],
});

/** Publishing makes the surprise and its private media visible to the partner. */
async function reveal(surprise) {
  surprise.status = REVEALED;
  surprise.revealedAt = new Date();
  await surprise.save();
  await Attachment.updateMany(
    { _id: { $in: surprise.mediaIds }, relationshipId: surprise.relationshipId },
    { $set: { restrictedTo: null } },
  );
}

/** Background job + lazy check: reveal scheduled surprises whose time has come, and notify. */
export async function revealDueSurprises(hub, { relationshipId } = {}) {
  const filter = { status: SCHEDULED, revealAt: { $lte: new Date() } };
  if (relationshipId) filter.relationshipId = relationshipId;
  const due = await Surprise.find(filter).limit(200);
  for (const s of due) {
    await reveal(s);
    const rel = await Relationship.findOne({ _id: s.relationshipId });
    if (!rel) continue;
    try {
      const ctx = buildContext(rel, s.creatorId);
      contentChanged(ctx, hub, 'surprises');
      await notifyPartner(ctx, hub, { type: 'surprise', refId: s._id, text: `🎁 ${s.title}` });
    } catch {
      // creator left the space; the surprise is still revealed for the recipient
    }
  }
  return due.length;
}

function surpriseView(s, userId, media) {
  return {
    id: id(s._id),
    relationshipId: id(s.relationshipId),
    creatorId: id(s.creatorId),
    recipientId: id(s.recipientId),
    mine: sameId(s.creatorId, userId),
    title: s.title,
    message: s.message,
    mediaIds: s.mediaIds.map(String),
    media: s.mediaIds.map((m) => media.get(String(m))).filter(Boolean),
    status: s.status,
    revealAt: s.revealAt,
    revealedAt: s.revealedAt,
    seenAt: s.seenAt,
    createdAt: s.createdAt,
  };
}

function validateSchedule(status, revealAt) {
  if (status === SCHEDULED && (!revealAt || revealAt <= new Date())) {
    throw new HttpError(422, 'Pick a reveal time in the future', { code: 'bad_reveal_time' });
  }
}

export function surpriseRoutes({ hub }) {
  const router = express.Router({ mergeParams: true });
  router.use((req, _res, next) => {
    assertDirect(req.ctx, 'Surprises are for one-to-one chats');
    next();
  });

  const load = async (ctx, surpriseId) => {
    const s = await scoped(Surprise, ctx).findOne({
      ...visibleSurprisesFilter(ctx.userId),
      _id: toObjectId(surpriseId),
    });
    if (!s) throw notFound();
    return s;
  };

  const loadMine = async (ctx, surpriseId) => {
    const s = await load(ctx, surpriseId);
    if (!sameId(s.creatorId, ctx.userId)) throw forbidden('Only the creator can change this surprise');
    return s;
  };

  const respond = async (ctx, docs) => {
    const media = await mediaLookup(ctx, docs, 'mediaIds');
    return docs.map((s) => surpriseView(s, ctx.userId, media));
  };

  router.get('/', async (req, res) => {
    await revealDueSurprises(hub, { relationshipId: req.ctx.relationshipId });
    const docs = await scoped(Surprise, req.ctx).find(visibleSurprisesFilter(req.ctx.userId)).sort({ createdAt: -1 });
    // A teaser count only — no titles, no content, no ids.
    const upcomingForMe = await scoped(Surprise, req.ctx).count({ recipientId: req.ctx.userId, status: SCHEDULED });
    res.json({ items: await respond(req.ctx, docs), upcomingForMe });
  });

  router.get('/:surpriseId', async (req, res) => {
    const [item] = await respond(req.ctx, [await load(req.ctx, req.params.surpriseId)]);
    res.json({ item });
  });

  router.post('/', async (req, res) => {
    const input = parse(surpriseSchema, req.body);
    const recipientId = partnerId(req.ctx);
    if (!recipientId) throw new HttpError(409, 'Your partner needs to be here to receive surprises');
    validateSchedule(input.status, input.revealAt);
    const media = await assertAttachments(req.ctx, input.mediaIds, { allowOwnRestricted: true });
    const s = await scoped(Surprise, req.ctx).create({
      ...input,
      status: input.status === REVEALED ? DRAFT : input.status,
      mediaIds: media.map((a) => a._id),
      creatorId: req.ctx.userId,
      recipientId,
    });
    if (input.status === REVEALED) {
      await reveal(s);
      await notifyPartner(req.ctx, hub, { type: 'surprise', refId: s._id, text: `🎁 ${s.title}` });
    }
    contentChanged(req.ctx, hub, 'surprises');
    const [item] = await respond(req.ctx, [s]);
    res.status(201).json({ item });
  });

  router.patch('/:surpriseId', async (req, res) => {
    const s = await loadMine(req.ctx, req.params.surpriseId);
    if (s.status === REVEALED) throw new HttpError(409, 'This surprise has already been revealed');
    const patch = parsePatch(surpriseSchema, req.body);
    delete patch.status;
    if (patch.mediaIds) {
      patch.mediaIds = (await assertAttachments(req.ctx, patch.mediaIds, { allowOwnRestricted: true })).map((a) => a._id);
    }
    s.set(patch);
    validateSchedule(s.status, s.revealAt);
    await s.save();
    const [item] = await respond(req.ctx, [s]);
    res.json({ item });
  });

  /** draft → scheduled (with revealAt) or → revealed now. */
  router.post('/:surpriseId/publish', async (req, res) => {
    const s = await loadMine(req.ctx, req.params.surpriseId);
    if (s.status === REVEALED) throw new HttpError(409, 'Already revealed');
    const revealAt = req.body?.revealAt ? new Date(req.body.revealAt) : null;
    if (revealAt && !Number.isNaN(revealAt.getTime()) && revealAt > new Date()) {
      s.status = SCHEDULED;
      s.revealAt = revealAt;
      await s.save();
    } else {
      await reveal(s);
      await notifyPartner(req.ctx, hub, { type: 'surprise', refId: s._id, text: `🎁 ${s.title}` });
    }
    contentChanged(req.ctx, hub, 'surprises');
    const [item] = await respond(req.ctx, [s]);
    res.json({ item });
  });

  router.post('/:surpriseId/seen', async (req, res) => {
    const s = await load(req.ctx, req.params.surpriseId);
    if (!sameId(s.recipientId, req.ctx.userId)) throw forbidden();
    s.seenAt ??= new Date();
    await s.save();
    res.json({ ok: true });
  });

  router.delete('/:surpriseId', async (req, res) => {
    const s = await loadMine(req.ctx, req.params.surpriseId);
    await s.deleteOne();
    contentChanged(req.ctx, hub, 'surprises');
    res.json({ ok: true });
  });

  return router;
}
