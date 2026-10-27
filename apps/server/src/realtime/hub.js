/**
 * The only way server code emits realtime events. There is deliberately no "broadcast to everyone"
 * method: events go to one relationship room, one user's private channel, or one call room.
 */
export const relRoom = (relationshipId) => `rel:${relationshipId}`;
export const userRoom = (userId) => `user:${userId}`;
export const callRoom = (callId) => `call:${callId}`;

export class RealtimeHub {
  constructor() {
    this.io = null;
  }

  attach(io) {
    this.io = io;
  }

  toRelationship(relationshipId, event, payload) {
    this.io?.to(relRoom(relationshipId)).emit(event, { ...payload, relationshipId: String(relationshipId) });
  }

  /** Private per-user channel. Payloads must only reference spaces that user belongs to. */
  toUser(userId, event, payload) {
    this.io?.to(userRoom(userId)).emit(event, payload);
  }

  toCall(callId, event, payload) {
    this.io?.to(callRoom(callId)).emit(event, payload);
  }

  /** How many sockets are currently inside a call's room (0 when nobody is really on the call). */
  async callOccupancy(callId) {
    if (!this.io) return 0;
    return (await this.io.in(callRoom(callId)).fetchSockets()).length;
  }

  /** Remove sockets from a space's live rooms (end, delete, account deletion). */
  async evictFromRelationship(relationshipId, { userIds, callIds = [] } = {}) {
    if (!this.io) return;
    const room = relRoom(relationshipId);
    if (userIds) {
      for (const uid of userIds) this.io.in(userRoom(uid)).socketsLeave(room);
    } else {
      this.io.in(room).socketsLeave(room);
    }
    for (const callId of callIds) this.io.in(callRoom(callId)).socketsLeave(callRoom(callId));
  }
}
