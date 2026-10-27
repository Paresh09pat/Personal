import express from 'express';
import { EVENTS, startCallSchema } from '@olw/shared';
import { CallRecord, Relationship } from '../models/index.js';
import { assertDirect, assertWritable, partnerId, scoped } from '../authz/relationship.js';
import { HttpError, notFound } from '../lib/errors.js';
import { signToken, verifyToken } from '../lib/crypto.js';
import { parse, sameId } from '../lib/validate.js';
import { id } from '../lib/serialize.js';
import { notifyPartner } from './notify.js';

const CALL_TOKEN_TTL_MS = 2 * 60 * 1000;
const RING_TIMEOUT_MS = 60 * 1000;
const LIVE = ['ringing', 'active'];

export const iceServers = (config) => [
  { urls: config.ice.stun },
  ...(config.ice.turn ? [config.ice.turn] : []),
];

/** A call token is bound to one call, one space and one user, and expires in 2 minutes. */
export const mintCallToken = (config, call, userId) =>
  signToken(
    config.secrets.media,
    'call',
    { c: String(call._id), r: String(call.relationshipId), u: String(userId) },
    CALL_TOKEN_TTL_MS,
  );

export const readCallToken = (config, token) => verifyToken(config.secrets.media, 'call', token);

export const callView = (c) => ({
  id: id(c._id),
  relationshipId: id(c.relationshipId),
  callerId: id(c.callerId),
  kind: c.kind,
  status: c.status,
  startedAt: c.startedAt,
  endedAt: c.endedAt,
  createdAt: c.createdAt,
  durationSec: c.startedAt && c.endedAt ? Math.round((c.endedAt - c.startedAt) / 1000) : 0,
});

export async function finishCall(call, status, userId, hub) {
  if (!LIVE.includes(call.status)) return call;
  call.status = status === 'ended' && call.status === 'ringing' ? 'missed' : status;
  call.endedAt = new Date();
  call.endedBy = userId;
  await call.save();
  const payload = { callId: String(call._id), status: call.status };
  hub.toCall(call._id, EVENTS.CALL_ENDED, payload);
  hub.toRelationship(call.relationshipId, EVENTS.CALL_ENDED, payload);
  // Each participant's private channel too: a ringing banner must disappear even when that person
  // is not looking at this chat (and so has not joined its room).
  const rel = await Relationship.findOne({ _id: call.relationshipId }, { participants: 1 });
  for (const p of rel?.participants ?? []) {
    hub.toUser(p.userId, EVENTS.CALL_ENDED, { ...payload, relationshipId: String(call.relationshipId) });
  }
  return call;
}

const ACTIVE_GRACE_MS = 30 * 1000;

/**
 * Cleans up calls nobody is on any more:
 *  - ringing for over a minute -> "missed"
 *  - "active" but with nobody left in the call room (tab closed, crash, lost connection) -> ended
 * Without this a dead call blocks every new call with "already in progress".
 */
export async function expireRingingCalls(hub) {
  const ringing = await CallRecord.find({ status: 'ringing', createdAt: { $lt: new Date(Date.now() - RING_TIMEOUT_MS) } });
  for (const call of ringing) await finishCall(call, 'missed', null, hub);
  const active = await CallRecord.find({ status: 'active', startedAt: { $lt: new Date(Date.now() - ACTIVE_GRACE_MS) } });
  let abandoned = 0;
  for (const call of active) {
    if ((await hub.callOccupancy(call._id)) === 0) {
      await finishCall(call, 'ended', null, hub);
      abandoned += 1;
    }
  }
  return ringing.length + abandoned;
}

export function callRoutes({ config, hub }) {
  const router = express.Router({ mergeParams: true });

  const loadCall = async (ctx, callId) => {
    const call = await scoped(CallRecord, ctx).byId(callId);
    if (!call) throw notFound();
    return call;
  };

  router.get('/', async (req, res) => {
    const calls = await scoped(CallRecord, req.ctx).find({}).sort({ createdAt: -1 }).limit(50);
    res.json({ items: calls.map(callView) });
  });

  router.post('/', async (req, res) => {
    assertDirect(req.ctx, 'Calls are not available in group chats yet');
    assertWritable(req.ctx);
    const { kind } = parse(startCallSchema, req.body);
    const target = partnerId(req.ctx);
    if (!target) throw new HttpError(409, 'Your partner has not joined yet');
    await expireRingingCalls(hub);
    const live = await scoped(CallRecord, req.ctx).findOne({ status: { $in: LIVE } });
    if (live) {
      // My own leftover (a failed attempt, closed tab, ...): replace it. Only my partner's live call blocks me.
      if (sameId(live.callerId, req.ctx.userId)) await finishCall(live, 'ended', req.ctx.userId, hub);
      else {
        throw new HttpError(409, live.status === 'ringing' ? 'Your partner is calling you right now. Answer the incoming call.' : 'A call is already in progress', {
          code: 'call_busy',
          details: { callId: String(live._id) },
        });
      }
    }
    const call = await scoped(CallRecord, req.ctx).create({ callerId: req.ctx.userId, kind });
    hub.toUser(target, EVENTS.CALL_INCOMING, {
      relationshipId: String(req.ctx.relationshipId),
      callId: String(call._id),
      kind,
      fromUserId: String(req.ctx.userId),
      fromName: req.ctx.me.displayName || req.user.displayName,
    });
    await notifyPartner(req.ctx, hub, { type: 'call', refId: call._id, persist: false, text: `📞 Incoming ${kind} call` });
    res.status(201).json({
      call: callView(call),
      token: mintCallToken(config, call, req.ctx.userId),
      iceServers: iceServers(config),
    });
  });

  // The callee (or a reconnecting caller) asks for a token for an existing live call of THIS space.
  router.post('/:callId/token', async (req, res) => {
    assertWritable(req.ctx);
    const call = await loadCall(req.ctx, req.params.callId);
    if (!LIVE.includes(call.status)) throw new HttpError(410, 'This call has ended', { code: 'call_over' });
    res.json({ call: callView(call), token: mintCallToken(config, call, req.ctx.userId), iceServers: iceServers(config) });
  });

  router.post('/:callId/decline', async (req, res) => {
    const call = await loadCall(req.ctx, req.params.callId);
    if (sameId(call.callerId, req.ctx.userId)) throw new HttpError(400, 'Use end to cancel your own call');
    res.json({ call: callView(await finishCall(call, 'declined', req.ctx.userId, hub)) });
  });

  router.post('/:callId/end', async (req, res) => {
    const call = await loadCall(req.ctx, req.params.callId);
    res.json({ call: callView(await finishCall(call, 'ended', req.ctx.userId, hub)) });
  });

  return router;
}
