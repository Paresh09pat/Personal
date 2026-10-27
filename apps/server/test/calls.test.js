import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EVENTS } from '@olw/shared';
import { CallRecord } from '../src/models/index.js';
import { expireRingingCalls } from '../src/features/calls.js';
import { connectSocket, createSpace, emitAck, registerUser, sleep, startTestApp } from './helpers.js';

let t;
let A;
let B;
let AB;
const url = (path = '') => `/api/relationships/${AB}/calls${path}`;
const lastEvent = (socket, event) => socket.received.filter((e) => e.event === event).at(-1)?.payload;

beforeAll(async () => {
  t = await startTestApp();
  A = await registerUser(t, 'Ann');
  B = await registerUser(t, 'Ben');
  AB = (await createSpace(A, B)).id;
});
afterAll(() => t?.close());

describe('calls', () => {
  it('a leftover call of my own never blocks my next call', async () => {
    const first = await A.client.post(url(), { kind: 'audio' });
    expect(first.status).toBe(201);
    const second = await A.client.post(url(), { kind: 'video' });
    expect(second.status).toBe(201);
    expect((await CallRecord.findById(first.body.call.id)).status).toBe('missed');
    await A.client.post(url(`/${second.body.call.id}/end`));
  });

  it('my partner calling me is reported as busy with a helpful message', async () => {
    const call = await A.client.post(url(), { kind: 'audio' });
    const res = await B.client.post(url(), { kind: 'audio' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/calling you/i);
    await A.client.post(url(`/${call.body.call.id}/end`));
  });

  it('tells both people when a call ends, even when they are not in the chat room', async () => {
    const sa = await connectSocket(t, A);
    const sb = await connectSocket(t, B); // never joins the space room
    const call = await A.client.post(url(), { kind: 'audio' });
    await B.client.post(url(`/${call.body.call.id}/decline`));
    await sleep(150);
    expect(lastEvent(sb, EVENTS.CALL_ENDED)).toMatchObject({ callId: call.body.call.id, status: 'declined' });
    expect(lastEvent(sa, EVENTS.CALL_ENDED)).toMatchObject({ callId: call.body.call.id, status: 'declined' });
  });

  it('joining reports whether the other side is already waiting', async () => {
    const sa = await connectSocket(t, A);
    const sb = await connectSocket(t, B);
    const call = await A.client.post(url(), { kind: 'audio' });
    const callId = call.body.call.id;
    const bTok = await B.client.post(url(`/${callId}/token`));
    const bJoin = await emitAck(sb, EVENTS.CALL_JOIN, { callId, token: bTok.body.token });
    expect(bJoin.ok).toBe(true);
    expect(bJoin.peers).toBe(0); // B got there first
    const aJoin = await emitAck(sa, EVENTS.CALL_JOIN, { callId, token: call.body.token });
    expect(aJoin.peers).toBe(1); // so the caller knows to send the offer immediately
    await A.client.post(url(`/${callId}/end`));
  });

  it('an "active" call that nobody is on any more is cleaned up', async () => {
    const call = await A.client.post(url(), { kind: 'audio' });
    await CallRecord.updateOne({ _id: call.body.call.id }, { $set: { status: 'active', startedAt: new Date(Date.now() - 60_000) } });
    expect(await expireRingingCalls(t.hub)).toBeGreaterThanOrEqual(1);
    expect((await CallRecord.findById(call.body.call.id)).status).toBe('ended');
    expect((await A.client.post(url(), { kind: 'audio' })).status).toBe(201);
  });
});
