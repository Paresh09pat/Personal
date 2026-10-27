import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Attachment, Message } from '../src/models/index.js';
import { sweepExpiredMessages } from '../src/jobs.js';
import { createSpace, registerUser, sendMessage, startTestApp, uploadPng } from './helpers.js';

let t;
let A;
let B;
let C;
let AB;
let AC;
const url = (rid, path = '') => `/api/relationships/${rid}${path}`;
const list = async (user, rid) => (await user.client.get(url(rid, '/messages'))).body.messages;

beforeAll(async () => {
  t = await startTestApp();
  A = await registerUser(t, 'Ann');
  B = await registerUser(t, 'Ben');
  C = await registerUser(t, 'Cat');
  AB = (await createSpace(A, B)).id;
  AC = (await createSpace(A, C)).id;
});
afterAll(() => t?.close());

describe('disappearing messages', () => {
  it('is off by default and either person can set the timer', async () => {
    const m = await sendMessage(A, AB, 'stays');
    expect(m.expiresAt).toBeNull();
    const res = await B.client.patch(url(AB), { preferences: { disappearAfterSec: 3600 } });
    expect(res.status).toBe(200);
    expect(res.body.relationship.preferences.disappearAfterSec).toBe(3600);
    const notice = (await list(A, AB)).find((x) => x.type === 'system');
    expect(notice.body).toBe('Disappearing messages: 1 hour');
  });

  it('only applies to new messages, with expiresAt = now + timer', async () => {
    const before = await sendMessage(A, AB, 'sent before? no, after');
    const exp = new Date(before.expiresAt).getTime() - Date.now();
    expect(exp).toBeGreaterThan(3500 * 1000);
    expect(exp).toBeLessThanOrEqual(3600 * 1000);
    const old = (await list(A, AB)).find((x) => x.body === 'stays');
    expect(old.expiresAt).toBeNull();
  });

  it('rejects silly timers', async () => {
    for (const bad of [5, 59, 31 * 86400, -1, 1.5]) {
      const res = await A.client.patch(url(AB), { preferences: { disappearAfterSec: bad } });
      expect(res.status, String(bad)).toBe(422);
    }
    expect((await A.client.patch(url(AB), { preferences: { disappearAfterSec: 90 * 60 } })).status).toBe(200);
  });

  it('hides expired messages from both people immediately and the sweep erases them with their media', async () => {
    const photo = await uploadPng(A, AB);
    const msg = await sendMessage(A, AB, 'gone soon', { attachmentIds: [photo.id] });
    await Message.updateOne({ _id: msg.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    for (const who of [A, B]) expect((await list(who, AB)).some((x) => x.id === msg.id)).toBe(false);
    expect(await Message.countDocuments({ _id: msg.id })).toBe(1);

    expect(await sweepExpiredMessages({ hub: t.hub, storage: t.storage })).toBeGreaterThanOrEqual(1);
    expect(await Message.countDocuments({ _id: msg.id })).toBe(0);
    expect(await Attachment.countDocuments({ _id: photo.id })).toBe(0);
  });

  it('cannot react to an expired message', async () => {
    const msg = await sendMessage(A, AB, 'react too late');
    await Message.updateOne({ _id: msg.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await B.client.post(url(AB, `/messages/${msg.id}/reactions`), { emoji: '❤️' });
    expect(res.status).toBe(404);
  });

  it('timers and themes never leak into another space', async () => {
    expect((await sendMessage(A, AC, 'other space')).expiresAt).toBeNull();
    await A.client.patch(url(AB), { preferences: { theme: 'love', themeAnimated: false } });
    const ac = (await A.client.get(url(AC))).body.relationship;
    expect(ac.preferences.theme).toBe('classic');
    expect(ac.preferences.disappearAfterSec).toBe(0);
    const ab = (await B.client.get(url(AB))).body.relationship;
    expect(ab.preferences.theme).toBe('love');
    expect(ab.preferences.themeAnimated).toBe(false);
  });
});
