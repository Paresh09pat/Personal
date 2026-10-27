import express from 'express';
import { tokenSchema } from '@olw/shared';
import { requireAuth } from '../auth/sessions.js';
import { requireVerifiedEmail } from '../auth/verified.js';
import { parse } from '../lib/validate.js';
import { buildContext } from '../authz/relationship.js';
import { viewFor } from '../relationships/service.js';
import { postSystemMessage } from '../features/messages.js';
import { loadUsers } from '../lib/serialize.js';
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
    const { relationship: rel, joined } = await acceptInvitation(req.user, token);
    const ctx = buildContext(rel, req.user._id);
    if (joined) {
      hub.toRelationship(rel._id, EVENTS.RELATIONSHIP_UPDATED, { status: rel.status });
      // People who are not looking at this space right now still need their chat list refreshed.
      for (const other of ctx.others) {
        hub.toUser(other.userId, EVENTS.RELATIONSHIP_UPDATED, { relationshipId: String(rel._id), status: rel.status });
      }
      if (ctx.kind === 'group') {
        const users = await loadUsers([req.user._id]);
        const name = ctx.me.displayName || users.get(String(req.user._id))?.displayName || 'Someone';
        await postSystemMessage(ctx, `${name} joined`, hub);
      }
    }
    res.json({ relationship: await viewFor(ctx) });
  });

  router.post('/decline', requireAuth(), async (req, res) => {
    const { token } = parse(tokenSchema, req.body);
    res.json(await declineInvitation(req.user, token));
  });

  return router;
}
