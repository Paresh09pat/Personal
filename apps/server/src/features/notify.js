import { EVENTS } from '@olw/shared';
import { Notification } from '../models/index.js';
import { partnerId, scoped } from '../authz/relationship.js';

const PREF_FOR = { message: 'messages', call: 'calls' };

/**
 * Tell the *other* participant of this space that something happened. The event goes to that
 * user's private channel only and carries just the relationshipId they already belong to.
 * `persist` stores an in-app notification (messages don't: unread counts come from read markers).
 */
export async function notifyPartner(ctx, hub, { type, refId = null, text = '', persist = true }) {
  const target = partnerId(ctx);
  if (!target) return;
  const prefs = ctx.partner.notificationPrefs ?? {};
  const silent = Boolean(prefs.muted) || prefs[PREF_FOR[type] ?? 'activity'] === false;
  let notification = null;
  if (persist) {
    notification = await scoped(Notification, ctx).create({
      userId: target,
      actorId: ctx.userId,
      type,
      refId,
      text,
    });
  }
  hub.toUser(target, EVENTS.NOTIFY, {
    relationshipId: String(ctx.relationshipId),
    type,
    text,
    silent,
    notificationId: notification ? String(notification._id) : null,
  });
}

/** Lets both open clients in this space refresh a section (memories, notes, gallery, …). */
export function contentChanged(ctx, hub, kind) {
  hub.toRelationship(ctx.relationshipId, EVENTS.CONTENT_CHANGED, { kind });
}
