import express from 'express';
import { Notification } from '../models/index.js';
import { scoped } from '../authz/relationship.js';
import { id } from '../lib/serialize.js';
import { toObjectId } from '../lib/validate.js';

/** Only MY notifications, only for THIS space. */
export function notificationRoutes() {
  const router = express.Router({ mergeParams: true });

  router.get('/', async (req, res) => {
    const mine = { userId: req.ctx.userId };
    const items = await scoped(Notification, req.ctx).find(mine).sort({ createdAt: -1 }).limit(50);
    const unread = await scoped(Notification, req.ctx).count({ ...mine, readAt: null });
    res.json({
      unread,
      items: items.map((n) => ({
        id: id(n._id),
        type: n.type,
        text: n.text,
        refId: id(n.refId),
        readAt: n.readAt,
        createdAt: n.createdAt,
      })),
    });
  });

  router.post('/read-all', async (req, res) => {
    await scoped(Notification, req.ctx).updateMany({ userId: req.ctx.userId, readAt: null }, { $set: { readAt: new Date() } });
    res.json({ ok: true });
  });

  router.post('/:notificationId/read', async (req, res) => {
    await scoped(Notification, req.ctx).updateOne(
      { _id: toObjectId(req.params.notificationId), userId: req.ctx.userId },
      { $set: { readAt: new Date() } },
    );
    res.json({ ok: true });
  });

  return router;
}
