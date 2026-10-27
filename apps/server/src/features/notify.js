import { EVENTS } from '@olw/shared';
import { Notification } from '../models/index.js';
import { scoped } from '../authz/relationship.js';

const PREF_FOR = { message: 'messages', call: 'calls' };

/**
 * Tell every OTHER active person in this space that something happened. Each event goes to that
 * user's private channel only and carries just the relationshipId they already belong to.
 * `persist` stores an in-app notification (messages don't: unread counts come from read markers).
 */
export async function notifyOthers(ctx, hub, { type, refId = null, text = '', persist = true }) {
  for (const target of ctx.others) {
    const prefs = target.notificationPrefs ?? {};
    const silent = Boolean(prefs.muted) || prefs[PREF_FOR[type] ?? 'activity'] === false;
    let notification = null;
    if (persist) {
      notification = await scoped(Notification, ctx).create({
        userId: target.userId,
        actorId: ctx.userId,
        type,
        refId,
        text,
      });
    }
    hub.toUser(target.userId, EVENTS.NOTIFY, {
      relationshipId: String(ctx.relationshipId),
      type,
      text,
      silent,
      kind: ctx.kind,
      fromName: ctx.me.displayName || '',
      notificationId: notification ? String(notification._id) : null,
    });
  }
}

/** Same thing: in a 1:1 space "the others" is just your partner. Kept for existing call sites. */
export const notifyPartner = notifyOthers;

/** Lets both open clients in this space refresh a section (memories, notes, gallery, …). */
export function contentChanged(ctx, hub, kind) {
  hub.toRelationship(ctx.relationshipId, EVENTS.CONTENT_CHANGED, { kind });
}
