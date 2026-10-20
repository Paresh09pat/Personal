import express from 'express';
import {
  albumItemsSchema,
  albumSchema,
  confirmDestructiveSchema,
  createInvitationSchema,
  createRelationshipSchema,
  loveNoteSchema,
  memorySchema,
  milestoneSchema,
  readSchema,
  updateMyParticipantSchema,
  updateRelationshipSchema,
} from '@olw/shared';
import { Album, LoveNote, Memory, Milestone } from '../models/index.js';
import {
  assertAttachments,
  assertWritable,
  loadMembership,
  requireWritableForMutations,
  scoped,
} from '../authz/relationship.js';
import { requireAuth } from '../auth/sessions.js';
import { verifyDestructiveConfirmation } from '../auth/account.js';
import { requireVerifiedEmail } from '../auth/verified.js';
import { HttpError, notFound } from '../lib/errors.js';
import { parse, parsePatch, toObjectId } from '../lib/validate.js';
import { createInvitation, currentInvitation, revokeCurrentInvitation } from '../invitations/service.js';
import {
  createRelationship,
  listForUser,
  updateMyParticipant,
  updateRelationship,
  viewFor,
} from './service.js';
import {
  archive,
  deletePendingSpace,
  endRelationship,
  requestDeletion,
  unarchive,
  withdrawDeletion,
} from './lifecycle.js';
import { EVENTS } from '@olw/shared';
import { messageRoutes, updateReadMarker } from '../features/messages.js';
import { attachmentRoutes } from '../features/attachments.js';
import { crudRoutes } from '../features/crud.js';
import { letterRoutes } from '../features/letters.js';
import { surpriseRoutes } from '../features/surprises.js';
import { callRoutes } from '../features/calls.js';
import { notificationRoutes } from '../features/notifications.js';
import { buildExport } from '../features/export.js';
import { contentChanged } from '../features/notify.js';

export function relationshipRoutes(deps) {
  const { config, hub, limiters } = deps;
  const router = express.Router();
  router.use(requireAuth());

  // ── Dashboard + create ────────────────────────────────────────────────
  router.get('/', async (req, res) => {
    res.json({ relationships: await listForUser(req.user._id) });
  });

  router.post('/', requireVerifiedEmail(config), async (req, res) => {
    if (config.spaceCreation === 'admin_only' && req.user.role !== 'admin') {
      throw new HttpError(403, 'Only the owner of this site can create new spaces', { code: 'admin_only' });
    }
    const rel = await createRelationship(req.user, parse(createRelationshipSchema, req.body));
    const ctx = { rel, relationshipId: rel._id, userId: req.user._id, me: rel.participants[0], partner: null };
    res.status(201).json({ relationship: await viewFor(ctx) });
  });

  // ── Everything below: membership verified on EVERY request ────────────
  const space = express.Router({ mergeParams: true });
  router.use('/:relationshipId', loadMembership(), space);

  const respondWithSpace = async (req, res) => {
    res.json({ relationship: await viewFor(req.ctx) });
  };

  space.get('/', respondWithSpace);

  space.patch('/', async (req, res) => {
    await updateRelationship(req.ctx, parsePatch(updateRelationshipSchema, req.body));
    hub.toRelationship(req.ctx.relationshipId, EVENTS.RELATIONSHIP_UPDATED, { status: req.ctx.rel.status });
    await respondWithSpace(req, res);
  });

  space.patch('/me', async (req, res) => {
    await updateMyParticipant(req.ctx, parsePatch(updateMyParticipantSchema, req.body));
    hub.toRelationship(req.ctx.relationshipId, EVENTS.RELATIONSHIP_UPDATED, { status: req.ctx.rel.status });
    await respondWithSpace(req, res);
  });

  space.post('/read', async (req, res) => {
    const { messageId } = parse(readSchema, req.body);
    res.json(await updateReadMarker(req.ctx, messageId, hub));
  });

  // ── Invitations (owner of a pending space) ────────────────────────────
  space.get('/invitations/current', async (req, res) => {
    res.json({ invitation: await currentInvitation(req.ctx) });
  });
  space.post('/invitations', limiters.invitation, async (req, res) => {
    res.status(201).json({ invitation: await createInvitation(req.ctx, parse(createInvitationSchema, req.body), config) });
  });
  space.delete('/invitations/current', async (req, res) => {
    res.json(await revokeCurrentInvitation(req.ctx));
  });

  // ── Lifecycle (see docs/DATA-RETENTION.md) ────────────────────────────
  space.post('/archive', async (req, res) => {
    await archive(req.ctx, hub);
    await respondWithSpace(req, res);
  });
  space.post('/unarchive', async (req, res) => {
    await unarchive(req.ctx, hub);
    await respondWithSpace(req, res);
  });
  space.post('/end', limiters.destructive, async (req, res) => {
    await verifyDestructiveConfirmation(req.ctx.userId, parse(confirmDestructiveSchema, req.body), 'END');
    await endRelationship(req.ctx, hub);
    await respondWithSpace(req, res);
  });
  space.post('/deletion-request', limiters.destructive, async (req, res) => {
    await verifyDestructiveConfirmation(req.ctx.userId, parse(confirmDestructiveSchema, req.body));
    res.json(await requestDeletion(req.ctx, deps));
  });
  space.delete('/deletion-request', async (req, res) => {
    res.json(await withdrawDeletion(req.ctx));
  });
  space.delete('/', limiters.destructive, async (req, res) => {
    await verifyDestructiveConfirmation(req.ctx.userId, parse(confirmDestructiveSchema, req.body));
    res.json(await deletePendingSpace(req.ctx, deps));
  });
  space.get('/export', limiters.export, async (req, res) => {
    const data = await buildExport(req.ctx, deps);
    res.set('Content-Disposition', `attachment; filename="our-little-world-${req.ctx.relationshipId}.json"`);
    res.json(data);
  });

  // Attachments + notifications have their own state rules (profile photos while pending, etc.).
  space.use('/attachments', attachmentRoutes(deps));
  space.use('/notifications', notificationRoutes(deps));

  // ── Feature routes: mutations require an ACTIVE space ─────────────────
  space.use(requireWritableForMutations());
  space.use('/messages', messageRoutes(deps));
  space.use('/letters', letterRoutes(deps));
  space.use('/surprises', surpriseRoutes(deps));
  space.use('/calls', callRoutes(deps));
  space.use(
    '/memories',
    crudRoutes({ Model: Memory, schema: memorySchema, ownerField: 'authorId', editableBy: 'owner', mediaField: 'mediaIds', sort: { date: -1 }, kind: 'memories', notifyText: (d) => `✨ New memory: ${d.title}`, hub }),
  );
  space.use(
    '/notes',
    crudRoutes({ Model: LoveNote, schema: loveNoteSchema, ownerField: 'authorId', editableBy: 'owner', sort: { pinned: -1, createdAt: -1 }, kind: 'notes', notifyText: () => '💗 You have a new love note', hub }),
  );
  space.use(
    '/milestones',
    crudRoutes({ Model: Milestone, schema: milestoneSchema, ownerField: 'createdBy', editableBy: 'both', sort: { date: 1 }, kind: 'milestones', hub }),
  );

  // Albums: generic CRUD + item management.
  const albums = crudRoutes({ Model: Album, schema: albumSchema, ownerField: 'createdBy', editableBy: 'both', mediaField: 'attachmentIds', sort: { createdAt: -1 }, kind: 'albums', hub });
  space.post('/albums/:albumId/items', async (req, res) => {
    assertWritable(req.ctx);
    const { attachmentIds } = parse(albumItemsSchema, req.body);
    const media = await assertAttachments(req.ctx, attachmentIds);
    const album = await scoped(Album, req.ctx).findOneAndUpdate(
      { _id: toObjectId(req.params.albumId) },
      { $addToSet: { attachmentIds: { $each: media.map((a) => a._id) } } },
    );
    if (!album) throw notFound();
    contentChanged(req.ctx, hub, 'albums');
    res.json({ ok: true, count: album.attachmentIds.length });
  });
  space.delete('/albums/:albumId/items/:attachmentId', async (req, res) => {
    const album = await scoped(Album, req.ctx).findOneAndUpdate(
      { _id: toObjectId(req.params.albumId) },
      { $pull: { attachmentIds: toObjectId(req.params.attachmentId) } },
    );
    if (!album) throw notFound();
    contentChanged(req.ctx, hub, 'albums');
    res.json({ ok: true });
  });
  space.use('/albums', albums);

  return router;
}
