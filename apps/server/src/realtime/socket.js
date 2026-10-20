import { Server } from 'socket.io';
import { z } from 'zod';
import { EVENTS, objectId } from '@olw/shared';
import { CallRecord } from '../models/index.js';
import { requireMember, scoped } from '../authz/relationship.js';
import { resolveSessionFromCookieHeader } from '../auth/sessions.js';
import { notFound } from '../lib/errors.js';
import { parse, sameId } from '../lib/validate.js';
import { createMessage, toggleReaction, updateReadMarker } from '../features/messages.js';
import { callView, finishCall, readCallToken } from '../features/calls.js';
import { callRoom, relRoom, userRoom } from './hub.js';

const relPayload = z.object({ relationshipId: objectId });
const MAX_SIGNAL_BYTES = 64 * 1024;

/**
 * Socket.IO with per-relationship rooms.
 *  - Handshake authenticates from the httpOnly session cookie; identity lives in socket.data only.
 *  - Joining `rel:<id>` requires active membership.
 *  - EVERY relationship-scoped event re-runs requireMember() — being in a room is not trusted.
 *  - Sender identity is socket.data.userId; any userId/senderId in a payload is ignored.
 */
export function attachSocketServer(httpServer, deps) {
  const { config, hub } = deps;
  const io = new Server(httpServer, {
    path: '/socket.io',
    serveClient: false,
    maxHttpBufferSize: 256 * 1024,
    // Leave non-Socket.IO upgrades (Next.js dev HMR) alone.
    destroyUpgrade: false,
    cors: config.isProd ? undefined : { origin: config.appOrigin, credentials: true },
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      cb(null, !origin || origin === config.appOrigin);
    },
  });

  io.use(async (socket, next) => {
    try {
      const found = await resolveSessionFromCookieHeader(config, socket.request.headers.cookie);
      if (!found) return next(new Error('unauthorized'));
      socket.data.userId = found.user._id;
      next();
    } catch (err) {
      next(err);
    }
  });

  const onlineUserIds = async (relationshipId) => {
    const sockets = await io.in(relRoom(relationshipId)).fetchSockets();
    return [...new Set(sockets.map((s) => String(s.data.userId)))];
  };

  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    socket.join(userRoom(userId));

    /** Validates payload, re-authorises, runs handler, acks {ok, ...} or {ok:false, error}. */
    const on = (event, schema, handler, { write = false, scopedToRel = true } = {}) => {
      socket.on(event, async (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        try {
          const data = parse(schema, payload);
          const ctx = scopedToRel ? await requireMember(userId, data.relationshipId, { write }) : null;
          reply({ ok: true, ...((await handler(ctx, data)) ?? {}) });
        } catch (err) {
          reply({
            ok: false,
            error: { code: err.code ?? 'error', message: err.status ? err.message : 'Something went wrong' },
          });
        }
      });
    };

    on(EVENTS.RELATIONSHIP_JOIN, relPayload, async (ctx) => {
      const room = relRoom(ctx.relationshipId);
      socket.join(room);
      socket.to(room).emit(EVENTS.PRESENCE, {
        relationshipId: String(ctx.relationshipId),
        userId: String(userId),
        online: true,
      });
      return { online: await onlineUserIds(ctx.relationshipId), status: ctx.rel.status };
    });

    socket.on(EVENTS.RELATIONSHIP_LEAVE, (payload) => {
      const id = relPayload.safeParse(payload);
      if (!id.success) return;
      const room = relRoom(id.data.relationshipId);
      if (!socket.rooms.has(room)) return;
      socket.leave(room);
      socket.to(room).emit(EVENTS.PRESENCE, { relationshipId: id.data.relationshipId, userId: String(userId), online: false });
    });

    on(
      EVENTS.MESSAGE_SEND,
      relPayload.extend({ message: z.record(z.string(), z.unknown()) }),
      async (ctx, data) => ({ message: await createMessage(ctx, data.message, hub) }),
      { write: true },
    );

    on(
      EVENTS.MESSAGE_REACT,
      relPayload.extend({ messageId: objectId, emoji: z.string() }),
      async (ctx, data) => ({ message: await toggleReaction(ctx, data.messageId, { emoji: data.emoji }, hub) }),
      { write: true },
    );

    on(EVENTS.TYPING, relPayload.extend({ isTyping: z.boolean() }), async (ctx, data) => {
      if (!ctx.rel.preferences.showTyping) return;
      socket.to(relRoom(ctx.relationshipId)).emit(EVENTS.TYPING, {
        relationshipId: String(ctx.relationshipId),
        userId: String(userId),
        isTyping: data.isTyping,
      });
    }, { write: true });

    on(EVENTS.READ_UPDATE, relPayload.extend({ messageId: objectId }), (ctx, data) =>
      updateReadMarker(ctx, data.messageId, hub),
    );

    // ── Calls: room membership needs a valid call token for THIS user, call and space ──
    const loadLiveCall = async (callId) => {
      const call = await CallRecord.findOne({ _id: callId, status: { $in: ['ringing', 'active'] } });
      if (!call) throw notFound();
      const ctx = await requireMember(userId, call.relationshipId, { write: true });
      return { ctx, call };
    };

    on(
      EVENTS.CALL_JOIN,
      z.object({ callId: objectId, token: z.string().max(2048) }),
      async (_ctx, data) => {
        const claims = readCallToken(config, data.token);
        if (!claims || claims.c !== data.callId || !sameId(claims.u, userId)) throw notFound();
        const ctx = await requireMember(userId, claims.r, { write: true });
        const call = await scoped(CallRecord, ctx).findOne({ _id: data.callId, status: { $in: ['ringing', 'active'] } });
        if (!call) throw notFound();
        socket.join(callRoom(call._id));
        if (call.status === 'ringing' && !sameId(call.callerId, userId)) {
          call.status = 'active';
          call.startedAt = new Date();
          await call.save();
        }
        socket.to(callRoom(call._id)).emit(EVENTS.CALL_PEER_JOINED, { callId: data.callId, userId: String(userId) });
        return { call: callView(call) };
      },
      { scopedToRel: false },
    );

    on(
      EVENTS.CALL_SIGNAL,
      z.object({ callId: objectId, data: z.unknown() }),
      async (_ctx, payload) => {
        const room = callRoom(payload.callId);
        if (!socket.rooms.has(room)) throw notFound();
        if (JSON.stringify(payload.data ?? null).length > MAX_SIGNAL_BYTES) throw notFound();
        await loadLiveCall(payload.callId);
        socket.to(room).emit(EVENTS.CALL_SIGNAL, { callId: payload.callId, fromUserId: String(userId), data: payload.data });
      },
      { scopedToRel: false },
    );

    on(
      EVENTS.CALL_END,
      z.object({ callId: objectId }),
      async (_ctx, payload) => {
        const { call } = await loadLiveCall(payload.callId);
        await finishCall(call, 'ended', userId, hub);
        io.in(callRoom(call._id)).socketsLeave(callRoom(call._id));
      },
      { scopedToRel: false },
    );

    socket.on('disconnecting', () => {
      for (const room of socket.rooms) {
        if (!room.startsWith('rel:')) continue;
        socket.to(room).emit(EVENTS.PRESENCE, { relationshipId: room.slice(4), userId: String(userId), online: false });
      }
    });
  });

  hub.attach(io);
  return io;
}
