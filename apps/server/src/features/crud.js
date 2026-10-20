import express from 'express';
import { Attachment } from '../models/index.js';
import { assertAttachments, canViewAttachment, scoped } from '../authz/relationship.js';
import { forbidden, notFound } from '../lib/errors.js';
import { parse, parsePatch, sameId } from '../lib/validate.js';
import { attachmentView, id } from '../lib/serialize.js';
import { contentChanged, notifyPartner } from './notify.js';

export async function mediaLookup(ctx, docs, field) {
  const ids = docs.flatMap((d) => d[field] ?? []);
  if (!ids.length) return new Map();
  const found = await scoped(Attachment, ctx).find({ _id: { $in: ids }, status: 'ready' });
  return new Map(found.filter((a) => canViewAttachment(ctx, a)).map((a) => [String(a._id), attachmentView(a)]));
}

/**
 * Generic relationship-scoped CRUD. Every query goes through `scoped()`, so ids from another
 * space simply don't exist here.
 *
 * @param {object} o
 * @param {import('mongoose').Model} o.Model
 * @param {import('zod').ZodObject} o.schema
 * @param {string} o.ownerField  field holding the creating user
 * @param {'owner'|'both'} o.editableBy
 * @param {string} [o.mediaField] array of attachment ids to validate and expand
 * @param {object} o.sort
 * @param {string} o.kind content kind for realtime refresh + notifications
 * @param {(doc: any) => string} [o.notifyText]
 */
export function crudRoutes({ Model, schema, ownerField, editableBy, mediaField, sort, kind, notifyText, hub }) {
  const router = express.Router({ mergeParams: true });

  const view = (doc, media) => {
    const o = doc.toObject();
    const out = { ...o, id: id(o._id), relationshipId: id(o.relationshipId), [ownerField]: id(o[ownerField]) };
    delete out._id;
    delete out.__v;
    if (mediaField) {
      out[mediaField] = (o[mediaField] ?? []).map(String);
      out.media = out[mediaField].map((m) => media.get(m)).filter(Boolean);
    }
    return out;
  };

  const load = async (ctx, docId) => {
    const doc = await scoped(Model, ctx).byId(docId);
    if (!doc) throw notFound();
    return doc;
  };

  const assertCanEdit = (ctx, doc) => {
    if (editableBy === 'owner' && !sameId(doc[ownerField], ctx.userId)) {
      throw forbidden('Only the person who created this can change it');
    }
  };

  router.get('/', async (req, res) => {
    const docs = await scoped(Model, req.ctx).find({}).sort(sort).limit(500);
    const media = mediaField ? await mediaLookup(req.ctx, docs, mediaField) : new Map();
    res.json({ items: docs.map((d) => view(d, media)) });
  });

  router.get('/:itemId', async (req, res) => {
    const doc = await load(req.ctx, req.params.itemId);
    const media = mediaField ? await mediaLookup(req.ctx, [doc], mediaField) : new Map();
    res.json({ item: view(doc, media) });
  });

  router.post('/', async (req, res) => {
    const input = parse(schema, req.body);
    if (mediaField) input[mediaField] = (await assertAttachments(req.ctx, input[mediaField])).map((a) => a._id);
    if (input.coverAttachmentId) await assertAttachments(req.ctx, [input.coverAttachmentId]);
    const doc = await scoped(Model, req.ctx).create({ ...input, [ownerField]: req.ctx.userId });
    contentChanged(req.ctx, hub, kind);
    if (notifyText) await notifyPartner(req.ctx, hub, { type: kind, refId: doc._id, text: notifyText(doc) });
    const media = mediaField ? await mediaLookup(req.ctx, [doc], mediaField) : new Map();
    res.status(201).json({ item: view(doc, media) });
  });

  router.patch('/:itemId', async (req, res) => {
    const doc = await load(req.ctx, req.params.itemId);
    assertCanEdit(req.ctx, doc);
    const patch = parsePatch(schema, req.body);
    if (mediaField && patch[mediaField]) {
      patch[mediaField] = (await assertAttachments(req.ctx, patch[mediaField])).map((a) => a._id);
    }
    if (patch.coverAttachmentId) await assertAttachments(req.ctx, [patch.coverAttachmentId]);
    doc.set(patch);
    await doc.save();
    contentChanged(req.ctx, hub, kind);
    const media = mediaField ? await mediaLookup(req.ctx, [doc], mediaField) : new Map();
    res.json({ item: view(doc, media) });
  });

  router.delete('/:itemId', async (req, res) => {
    const doc = await load(req.ctx, req.params.itemId);
    assertCanEdit(req.ctx, doc);
    await doc.deleteOne();
    contentChanged(req.ctx, hub, kind);
    res.json({ ok: true });
  });

  return router;
}
