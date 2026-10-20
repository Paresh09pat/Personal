import express from 'express';
import { letterSchema } from '@olw/shared';
import { Letter } from '../models/index.js';
import { partnerId, scoped } from '../authz/relationship.js';
import { HttpError, forbidden, notFound } from '../lib/errors.js';
import { parse, parsePatch, sameId, toObjectId } from '../lib/validate.js';
import { id } from '../lib/serialize.js';
import { contentChanged, notifyPartner } from './notify.js';

export const isLocked = (letter, now = new Date()) => Boolean(letter.unlockAt && letter.unlockAt > now);

/** Recipients see the title of a locked letter but never its body until it unlocks. */
export function letterView(letter, userId) {
  const mine = sameId(letter.authorId, userId);
  const locked = isLocked(letter);
  return {
    id: id(letter._id),
    relationshipId: id(letter.relationshipId),
    authorId: id(letter.authorId),
    recipientId: id(letter.recipientId),
    title: letter.title,
    body: mine || !locked ? letter.body : null,
    locked,
    unlockAt: letter.unlockAt,
    openedAt: letter.openedAt,
    createdAt: letter.createdAt,
    updatedAt: letter.updatedAt,
  };
}

/** Only letters I wrote or that were written to me. */
export const visibleLettersFilter = (userId) => ({ $or: [{ authorId: userId }, { recipientId: userId }] });

export function letterRoutes({ hub }) {
  const router = express.Router({ mergeParams: true });

  const load = async (ctx, letterId) => {
    const letter = await scoped(Letter, ctx).findOne({
      ...visibleLettersFilter(ctx.userId),
      _id: toObjectId(letterId),
    });
    if (!letter) throw notFound();
    return letter;
  };

  router.get('/', async (req, res) => {
    const letters = await scoped(Letter, req.ctx).find(visibleLettersFilter(req.ctx.userId)).sort({ createdAt: -1 });
    res.json({ items: letters.map((l) => letterView(l, req.ctx.userId)) });
  });

  router.get('/:letterId', async (req, res) => {
    res.json({ item: letterView(await load(req.ctx, req.params.letterId), req.ctx.userId) });
  });

  router.post('/', async (req, res) => {
    const input = parse(letterSchema, req.body);
    const recipientId = partnerId(req.ctx);
    if (!recipientId) throw new HttpError(409, 'Your partner needs to be here to receive letters');
    const letter = await scoped(Letter, req.ctx).create({ ...input, authorId: req.ctx.userId, recipientId });
    contentChanged(req.ctx, hub, 'letters');
    await notifyPartner(req.ctx, hub, { type: 'letter', refId: letter._id, text: `💌 ${letter.title}` });
    res.status(201).json({ item: letterView(letter, req.ctx.userId) });
  });

  router.patch('/:letterId', async (req, res) => {
    const letter = await load(req.ctx, req.params.letterId);
    if (!sameId(letter.authorId, req.ctx.userId)) throw forbidden('Only the author can edit a letter');
    if (letter.openedAt) throw new HttpError(409, 'This letter has already been opened');
    letter.set(parsePatch(letterSchema, req.body));
    await letter.save();
    contentChanged(req.ctx, hub, 'letters');
    res.json({ item: letterView(letter, req.ctx.userId) });
  });

  router.delete('/:letterId', async (req, res) => {
    const letter = await load(req.ctx, req.params.letterId);
    if (!sameId(letter.authorId, req.ctx.userId)) throw forbidden('Only the author can delete a letter');
    await letter.deleteOne();
    contentChanged(req.ctx, hub, 'letters');
    res.json({ ok: true });
  });

  router.post('/:letterId/open', async (req, res) => {
    const letter = await load(req.ctx, req.params.letterId);
    if (!sameId(letter.recipientId, req.ctx.userId)) throw forbidden('This letter is not addressed to you');
    if (isLocked(letter)) throw new HttpError(403, 'Not yet, my love. This letter is still sealed.', { code: 'locked' });
    letter.openedAt ??= new Date();
    await letter.save();
    contentChanged(req.ctx, hub, 'letters');
    res.json({ item: letterView(letter, req.ctx.userId) });
  });

  return router;
}
