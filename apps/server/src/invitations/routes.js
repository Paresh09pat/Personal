import express from 'express';
import { tokenSchema } from '@olw/shared';
import { requireAuth } from '../auth/sessions.js';
import { requireVerifiedEmail } from '../auth/verified.js';
import { parse } from '../lib/validate.js';
import { buildContext } from '../authz/relationship.js';
import { viewFor } from '../relationships/service.js';
import { EVENTS } from '@olw/shared';
import { acceptInvitation, declineInvitation, previewInvitation } from './service.js';

export function invitationRoutes({ config, limiters, hub }) {
  const router = express.Router();
  router.use(limiters.invitation);

  // POST so the token never lands in access logs as a query string.
  router.post('/preview', async (req, res) => {
    const { token } = parse(tokenSchema, req.body);
    res.json({ invitation: await previewInvitation(token) });
  });

  router.post('/accept', requireAuth(), requireVerifiedEmail(config), async (req, res) => {
    const { token } = parse(tokenSchema, req.body);
    const rel = await acceptInvitation(req.user, token);
    const ctx = buildContext(rel, req.user._id);
    hub.toRelationship(rel._id, EVENTS.RELATIONSHIP_UPDATED, { status: rel.status });
    hub.toUser(ctx.partner.userId, EVENTS.RELATIONSHIP_UPDATED, { relationshipId: String(rel._id), status: rel.status });
    res.json({ relationship: await viewFor(ctx) });
  });

  router.post('/decline', requireAuth(), async (req, res) => {
    const { token } = parse(tokenSchema, req.body);
    res.json(await declineInvitation(req.user, token));
  });

  return router;
}
