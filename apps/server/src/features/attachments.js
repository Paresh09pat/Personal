import express from 'express';
import {
  ALLOWED_MIME,
  RELATIONSHIP_STATUS,
  UPLOAD_LIMITS,
  paginationSchema,
  uploadIntentSchema,
} from '@olw/shared';
import { Album, Attachment } from '../models/index.js';
import { assertWritable, canViewAttachment, requireMember, scoped } from '../authz/relationship.js';
import { HttpError, forbidden, notFound } from '../lib/errors.js';
import { verifyToken } from '../lib/crypto.js';
import { parse, sameId, toObjectId } from '../lib/validate.js';
import { attachmentView } from '../lib/serialize.js';
import { contentMatchesDeclaredType } from '../storage/index.js';
import { contentChanged } from './notify.js';

const PROFILE_PURPOSES = new Set(['avatar', 'cover']);

/** Profile pictures may be uploaded while waiting for a partner; everything else needs an active space. */
function assertCanUpload(ctx, purpose) {
  if (ctx.rel.status === RELATIONSHIP_STATUS.PENDING && PROFILE_PURPOSES.has(purpose)) return;
  assertWritable(ctx);
}

async function findViewable(ctx, attachmentId) {
  const a = await scoped(Attachment, ctx).byId(attachmentId);
  if (!a || a.status !== 'ready' || !canViewAttachment(ctx, a)) throw notFound();
  return a;
}

export function attachmentRoutes({ storage, limiters, hub }) {
  const router = express.Router({ mergeParams: true });

  // 1. Ask for an upload slot. Membership + write access were already verified for this space.
  router.post('/', limiters.upload, async (req, res) => {
    const input = parse(uploadIntentSchema, req.body);
    assertCanUpload(req.ctx, input.purpose);
    const kind = ALLOWED_MIME[input.mime];
    if (input.size > UPLOAD_LIMITS[kind]) {
      throw new HttpError(413, `That ${kind} is too large (max ${Math.round(UPLOAD_LIMITS[kind] / 1048576)} MB)`);
    }
    const attachment = await scoped(Attachment, req.ctx).create({
      uploaderId: req.ctx.userId,
      storageKey: storage.newKey(),
      fileName: input.fileName,
      mime: input.mime,
      size: input.size,
      kind,
      purpose: input.purpose,
      durationMs: input.durationMs ?? null,
      // Surprise media stays private to its creator until the surprise is revealed.
      restrictedTo: input.purpose === 'surprise' ? req.ctx.userId : null,
    });
    const upload = await storage.createUploadTarget({ attachment });
    res.status(201).json({ attachment: attachmentView(attachment), upload });
  });

  // 2. Confirm the upload: size must match and the bytes must really be the declared type.
  router.post('/:attachmentId/complete', async (req, res) => {
    const a = await scoped(Attachment, req.ctx).byId(req.params.attachmentId);
    if (!a || !sameId(a.uploaderId, req.ctx.userId)) throw notFound();
    if (a.status === 'ready') return res.json({ attachment: attachmentView(a) });
    const stat = await storage.stat(a.storageKey);
    const valid =
      stat && stat.size === a.size && (await contentMatchesDeclaredType(await storage.readHead(a.storageKey), a.mime));
    if (!valid) {
      await storage.delete(a.storageKey).catch(() => {});
      await a.deleteOne();
      throw new HttpError(422, 'The uploaded file did not match its declared type or size', { code: 'bad_upload' });
    }
    a.status = 'ready';
    a.inGallery = ['message', 'gallery'].includes(a.purpose) && ['image', 'video'].includes(a.kind);
    await a.save();
    if (a.inGallery) contentChanged(req.ctx, hub, 'gallery');
    res.json({ attachment: attachmentView(a) });
  });

  // Shared gallery: ready, non-private photos & videos of THIS space only.
  router.get('/', async (req, res) => {
    const { before, limit } = parse(paginationSchema, req.query);
    const filter = { status: 'ready', inGallery: true, restrictedTo: null };
    if (before) filter._id = { $lt: toObjectId(before) };
    const docs = await scoped(Attachment, req.ctx).find(filter).sort({ _id: -1 }).limit(limit + 1);
    res.json({ attachments: docs.slice(0, limit).map(attachmentView), hasMore: docs.length > limit });
  });

  router.get('/:attachmentId', async (req, res) => {
    res.json({ attachment: attachmentView(await findViewable(req.ctx, req.params.attachmentId)) });
  });

  // Short-lived signed URL (downloads, export). Re-authorised every time.
  router.get('/:attachmentId/url', async (req, res) => {
    const a = await findViewable(req.ctx, req.params.attachmentId);
    res.json(await storage.createDownloadUrl({ attachment: a, userId: req.ctx.userId }));
  });

  // What <img>/<video> tags point at: session + membership + visibility checked on every request.
  router.get('/:attachmentId/content', async (req, res) => {
    await storage.send(res, await findViewable(req.ctx, req.params.attachmentId));
  });

  router.delete('/:attachmentId', async (req, res) => {
    assertWritable(req.ctx);
    const a = await scoped(Attachment, req.ctx).byId(req.params.attachmentId);
    if (!a) throw notFound();
    if (!sameId(a.uploaderId, req.ctx.userId)) throw forbidden('Only the person who uploaded this can delete it');
    await storage.delete(a.storageKey).catch(() => {});
    await scoped(Album, req.ctx).updateMany({}, { $pull: { attachmentIds: a._id } });
    await a.deleteOne();
    contentChanged(req.ctx, hub, 'gallery');
    res.json({ ok: true });
  });

  return router;
}

/**
 * Token-addressed endpoints for the local storage driver. A token alone is NOT enough: the caller's
 * session must be the user the token was minted for, and that user must still be an active
 * participant of the attachment's space.
 */
export function mediaRoutes({ config, storage }) {
  const router = express.Router();

  const authorize = async (req, typ) => {
    const payload = verifyToken(config.secrets.media, typ, req.params.token);
    if (!payload || !req.user || !sameId(payload.u, req.user._id)) throw notFound();
    const ctx = await requireMember(req.user._id, payload.r);
    const attachment = await scoped(Attachment, ctx).byId(payload.a);
    if (!attachment) throw notFound();
    return { ctx, attachment };
  };

  router.put('/upload/:token', async (req, res) => {
    if (storage.kind !== 'local') throw notFound();
    const { attachment } = await authorize(req, 'up');
    if (attachment.status !== 'pending' || !sameId(attachment.uploaderId, req.user._id)) throw notFound();
    const declared = Number(req.get('content-length'));
    if (Number.isFinite(declared) && declared > attachment.size) throw new HttpError(413, 'File is larger than declared');
    const written = await storage.write(attachment.storageKey, req, attachment.size);
    res.json({ ok: true, bytes: written });
  });

  router.get('/file/:token', async (req, res) => {
    if (storage.kind !== 'local') throw notFound();
    const { ctx, attachment } = await authorize(req, 'dl');
    if (attachment.status !== 'ready' || !canViewAttachment(ctx, attachment)) throw notFound();
    await storage.send(res, attachment);
  });

  return router;
}
