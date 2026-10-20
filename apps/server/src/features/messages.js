import express from 'express';
import {
  EVENTS,
  editMessageSchema,
  paginationSchema,
  reactSchema,
  sendMessageSchema,
} from '@olw/shared';
import { Attachment, Message } from '../models/index.js';
import { assertAttachments, assertWritable, scoped } from '../authz/relationship.js';
import { forbidden, notFound } from '../lib/errors.js';
import { parse, sameId, toObjectId } from '../lib/validate.js';
import { messageView } from '../lib/serialize.js';
import { markRead, touchActivity } from '../relationships/service.js';
import { notifyPartner } from './notify.js';

const KIND_TO_TYPE = { image: 'image', video: 'video', audio: 'voice', file: 'file' };

async function attachmentMap(ctx, messages) {
  const ids = messages.flatMap((m) => m.attachmentIds);
  if (!ids.length) return new Map();
  const docs = await scoped(Attachment, ctx).find({ _id: { $in: ids }, status: 'ready' });
  return new Map(docs.map((a) => [String(a._id), a]));
}

export async function viewMessages(ctx, messages) {
  const map = await attachmentMap(ctx, messages);
  return messages.map((m) => messageView(m, map));
}

/**
 * Creates a message in ctx's space. Used by both HTTP and Socket.IO. The sender is ALWAYS
 * ctx.userId (from the session), whatever the client put in its payload.
 */
export async function createMessage(ctx, rawInput, hub) {
  assertWritable(ctx);
  const input = parse(sendMessageSchema, rawInput);
  const attachments = await assertAttachments(ctx, input.attachmentIds);
  if (input.replyToId && !(await scoped(Message, ctx).byId(input.replyToId, { _id: 1 }))) {
    throw notFound('The message you replied to is gone');
  }
  const type = attachments.length ? (KIND_TO_TYPE[attachments[0].kind] ?? 'file') : 'text';

  let message;
  let created = true;
  try {
    message = await scoped(Message, ctx).create({
      senderId: ctx.userId,
      clientId: input.clientId,
      type,
      body: input.body,
      attachmentIds: attachments.map((a) => a._id),
      replyToId: input.replyToId ?? null,
    });
  } catch (err) {
    if (err?.code !== 11000) throw err;
    // Same clientId resent (retry after a flaky connection): idempotent, return the original.
    message = await scoped(Message, ctx).findOne({ senderId: ctx.userId, clientId: input.clientId });
    created = false;
  }

  const [view] = await viewMessages(ctx, [message]);
  if (created) {
    await touchActivity(ctx.relationshipId);
    await markRead(ctx, message);
    hub.toRelationship(ctx.relationshipId, EVENTS.MESSAGE_NEW, { message: view });
    await notifyPartner(ctx, hub, { type: 'message', persist: false, text: input.body.slice(0, 80) });
  }
  return view;
}

export async function toggleReaction(ctx, messageId, rawInput, hub) {
  assertWritable(ctx);
  const { emoji } = parse(reactSchema, rawInput);
  const message = await scoped(Message, ctx).byId(messageId);
  if (!message || message.deletedAt) throw notFound();
  const mine = message.reactions.find((r) => sameId(r.userId, ctx.userId));
  message.reactions = message.reactions.filter((r) => !sameId(r.userId, ctx.userId));
  if (!mine || mine.emoji !== emoji) message.reactions.push({ userId: ctx.userId, emoji });
  await message.save();
  const [view] = await viewMessages(ctx, [message]);
  hub.toRelationship(ctx.relationshipId, EVENTS.MESSAGE_UPDATED, { message: view });
  return view;
}

export async function updateReadMarker(ctx, messageId, hub) {
  const message = await scoped(Message, ctx).byId(messageId, { createdAt: 1 });
  if (!message) throw notFound();
  const lastReadAt = await markRead(ctx, message);
  if (lastReadAt) {
    hub.toRelationship(ctx.relationshipId, EVENTS.READ_UPDATED, {
      userId: String(ctx.userId),
      lastReadAt,
      messageId: String(message._id),
    });
  }
  return { lastReadAt: lastReadAt ?? ctx.me.lastReadAt };
}

export function messageRoutes({ hub }) {
  const router = express.Router({ mergeParams: true });

  router.get('/', async (req, res) => {
    const { before, limit } = parse(paginationSchema, req.query);
    const filter = before ? { _id: { $lt: toObjectId(before) } } : {};
    const docs = await scoped(Message, req.ctx)
      .find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1);
    const hasMore = docs.length > limit;
    const page = docs.slice(0, limit).reverse();
    res.json({ messages: await viewMessages(req.ctx, page), hasMore });
  });

  router.post('/', async (req, res) => {
    res.status(201).json({ message: await createMessage(req.ctx, req.body, hub) });
  });

  router.patch('/:messageId', async (req, res) => {
    const { body } = parse(editMessageSchema, req.body);
    const message = await scoped(Message, req.ctx).byId(req.params.messageId);
    if (!message || message.deletedAt) throw notFound();
    if (!sameId(message.senderId, req.ctx.userId)) throw forbidden('You can only edit your own messages');
    message.body = body;
    message.editedAt = new Date();
    await message.save();
    const [view] = await viewMessages(req.ctx, [message]);
    hub.toRelationship(req.ctx.relationshipId, EVENTS.MESSAGE_UPDATED, { message: view });
    res.json({ message: view });
  });

  router.delete('/:messageId', async (req, res) => {
    const message = await scoped(Message, req.ctx).byId(req.params.messageId);
    if (!message) throw notFound();
    if (!sameId(message.senderId, req.ctx.userId)) throw forbidden('You can only delete your own messages');
    message.deletedAt = new Date();
    message.body = '';
    await message.save();
    const [view] = await viewMessages(req.ctx, [message]);
    hub.toRelationship(req.ctx.relationshipId, EVENTS.MESSAGE_UPDATED, { message: view });
    res.json({ message: view });
  });

  router.post('/:messageId/reactions', async (req, res) => {
    res.json({ message: await toggleReaction(req.ctx, req.params.messageId, req.body, hub) });
  });

  return router;
}
