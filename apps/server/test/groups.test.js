import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EVENTS, MAX_GROUP_PARTICIPANTS } from '@olw/shared';
import { Relationship } from '../src/models/index.js';
import { PASSWORD, connectSocket, emitAck, registerUser, sendMessage, sleep, startTestApp } from './helpers.js';

let t;
let owner;
let u1;
let u2;
let outsider;
let G; // group id
const url = (path = '') => `/api/relationships/${G}${path}`;
const makeGroup = async (user, title = 'Trip crew') => {
  const res = await user.client.post('/api/relationships', { kind: 'group', title });
  if (res.status !== 201) throw new Error(`create group: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.relationship;
};
const newLink = async (user, gid, body = {}) => (await user.client.post(`/api/relationships/${gid}/invitations`, body)).body.invitation;
const join = (user, link) => user.client.post('/api/invitations/accept', { token: link.token });

beforeAll(async () => {
  t = await startTestApp();
  owner = await registerUser(t, 'Olive');
  u1 = await registerUser(t, 'Uma');
  u2 = await registerUser(t, 'Vik');
  outsider = await registerUser(t, 'Zed');
  const g = await makeGroup(owner);
  G = g.id;
});
afterAll(() => t?.close());

describe('group spaces', () => {
  it('a group is usable immediately and the creator is its admin', async () => {
    const view = (await owner.client.get(url())).body.relationship;
    expect(view).toMatchObject({ kind: 'group', status: 'active', title: 'Trip crew', memberCount: 1, partner: null });
    expect(view.me.isAdmin).toBe(true);
    expect((await owner.client.post(url('/messages'), { clientId: 'g1', body: 'hello group' })).status).toBe(201);
  });

  it('a group needs a name and 1:1 creation is unchanged', async () => {
    expect((await owner.client.post('/api/relationships', { kind: 'group' })).status).toBe(422);
    const direct = await owner.client.post('/api/relationships', { title: 'Just us' });
    expect(direct.body.relationship).toMatchObject({ kind: 'direct', status: 'pending' });
  });

  it('only admins can create a link; the link works for several people and is not used up by one', async () => {
    const link = await newLink(owner, G);
    expect(link.url).toContain('/invite/');
    expect((await join(u1, link)).status).toBe(200);
    expect((await join(u2, link)).status).toBe(200);
    const view = (await owner.client.get(url())).body.relationship;
    expect(view.memberCount).toBe(3);
    expect(view.members.map((m) => m.displayName).sort()).toEqual(['Olive', 'Uma', 'Vik']);
    // A plain member cannot make links.
    expect((await u1.client.post(url('/invitations'), {})).status).toBe(403);
    // Opening the link again is harmless.
    expect((await join(u1, link)).status).toBe(200);
    expect((await u1.client.get(url())).body.relationship.memberCount).toBe(3);
  });

  it('the invite preview names the group and reveals only the member count', async () => {
    const link = await newLink(owner, G);
    const res = await outsider.client.post('/api/invitations/preview', { token: link.token });
    expect(res.body.invitation).toMatchObject({ kind: 'group', spaceTitle: 'Trip crew', inviterName: 'Olive', memberCount: 3 });
  });

  it('everyone sees messages, and people outside the group see nothing', async () => {
    const m = await sendMessage(u1, G, 'hi all');
    expect((await u2.client.get(url('/messages'))).body.messages.some((x) => x.id === m.id)).toBe(true);
    expect((await outsider.client.get(url('/messages'))).status).toBe(404);
    expect((await outsider.client.get(url())).status).toBe(404);
    expect((await outsider.client.post(url('/messages'), { clientId: 'x', body: 'let me in' })).status).toBe(404);
  });

  it('delivers messages in realtime to every member and to nobody else', async () => {
    const [so, s1, s2, sx] = await Promise.all([owner, u1, u2, outsider].map((u) => connectSocket(t, u)));
    for (const s of [so, s1, s2]) expect((await emitAck(s, EVENTS.RELATIONSHIP_JOIN, { relationshipId: G })).ok).toBe(true);
    expect((await emitAck(sx, EVENTS.RELATIONSHIP_JOIN, { relationshipId: G })).ok).toBe(false);
    await sendMessage(owner, G, 'realtime ping');
    await sleep(200);
    for (const s of [so, s1, s2]) expect(s.received.some((e) => e.event === EVENTS.MESSAGE_NEW && e.payload.message.body === 'realtime ping')).toBe(true);
    expect(sx.received.some((e) => e.event === EVENTS.MESSAGE_NEW)).toBe(false);
  });

  it('notifies every other member (not the sender) of new activity', async () => {
    const [so, s1, s2] = await Promise.all([owner, u1, u2].map((u) => connectSocket(t, u)));
    await sendMessage(u1, G, 'notify me');
    await sleep(200);
    const got = (s) => s.received.filter((e) => e.event === EVENTS.NOTIFY && e.payload.type === 'message').length;
    expect(got(so)).toBe(1);
    expect(got(s2)).toBe(1);
    expect(got(s1)).toBe(0);
  });

  it('calls, letters and surprises are not available in groups', async () => {
    expect((await owner.client.post(url('/calls'), { kind: 'audio' })).status).toBe(409);
    expect((await owner.client.get(url('/letters'))).status).toBe(409);
    expect((await owner.client.get(url('/surprises'))).status).toBe(409);
  });

  it('admins promote members; only the owner can demote or remove an admin', async () => {
    expect((await u1.client.patch(url(`/members/${u2.id}`), { role: 'admin' })).status).toBe(403);
    expect((await owner.client.patch(url(`/members/${u1.id}`), { role: 'admin' })).status).toBe(200);
    expect((await u1.client.get(url())).body.relationship.me.isAdmin).toBe(true);
    // Admin u1 can remove a plain member but not the owner or promote-demote the owner.
    expect((await u1.client.delete(url(`/members/${owner.id}`))).status).toBe(403);
    expect((await u1.client.patch(url(`/members/${owner.id}`), { role: 'member' })).status).toBe(403);
    // u1 (admin, not owner) cannot demote another admin.
    expect((await owner.client.patch(url(`/members/${u2.id}`), { role: 'admin' })).status).toBe(200);
    expect((await u1.client.patch(url(`/members/${u2.id}`), { role: 'member' })).status).toBe(403);
    expect((await owner.client.patch(url(`/members/${u2.id}`), { role: 'member' })).status).toBe(200);
  });

  it('a removed member loses access immediately, cannot rejoin, and is dropped from realtime', async () => {
    const fresh = await registerUser(t, 'Wes');
    await join(fresh, await newLink(owner, G));
    const sw = await connectSocket(t, fresh);
    expect((await emitAck(sw, EVENTS.RELATIONSHIP_JOIN, { relationshipId: G })).ok).toBe(true);

    expect((await owner.client.delete(url(`/members/${fresh.id}`))).status).toBe(200);
    expect((await fresh.client.get(url())).status).toBe(404);
    expect((await fresh.client.get(url('/messages'))).status).toBe(404);
    await sendMessage(owner, G, 'after removal');
    await sleep(200);
    expect(sw.received.some((e) => e.event === EVENTS.MESSAGE_NEW && e.payload.message.body === 'after removal')).toBe(false);
    expect((await emitAck(sw, EVENTS.RELATIONSHIP_JOIN, { relationshipId: G })).ok).toBe(false);

    const again = await join(fresh, await newLink(owner, G));
    expect(again.status).toBe(403);
    expect(again.body.error.code).toBe('removed');
  });

  it('leaving works, a left member can rejoin with a new link, and a lone admin hands the role on', async () => {
    const g = await makeGroup(owner, 'Small group');
    const link = await newLink(owner, g.id);
    await join(u1, link);
    // Owner (the only admin) leaves: u1 becomes admin and the group lives on.
    expect((await owner.client.post(`/api/relationships/${g.id}/leave`)).body).toEqual({ left: true });
    expect((await owner.client.get(`/api/relationships/${g.id}`)).status).toBe(404);
    expect((await u1.client.get(`/api/relationships/${g.id}`)).body.relationship.me.isAdmin).toBe(true);
    // The left person can come back through a fresh link.
    expect((await join(owner, await newLink(u1, g.id))).status).toBe(200);
    expect((await owner.client.get(`/api/relationships/${g.id}`)).body.relationship.memberCount).toBe(2);
    // The last person to leave deletes the group.
    await owner.client.post(`/api/relationships/${g.id}/leave`);
    expect((await u1.client.post(`/api/relationships/${g.id}/leave`)).body).toEqual({ deleted: true });
    expect(await Relationship.countDocuments({ _id: g.id })).toBe(0);
  });

  it('enforces the member cap even when many join at the same time', async () => {
    const g = await makeGroup(owner, 'Big group');
    const link = await newLink(owner, g.id);
    const people = await Promise.all(Array.from({ length: MAX_GROUP_PARTICIPANTS + 4 }, (_, i) => registerUser(t, `Cap${i}`)));
    const results = await Promise.all(people.map((p) => join(p, link)));
    const ok = results.filter((r) => r.status === 200).length;
    expect(ok).toBe(MAX_GROUP_PARTICIPANTS - 1); // the owner already holds one seat
    const rel = await Relationship.findById(g.id);
    expect(rel.participants.filter((p) => p.status === 'active').length).toBe(MAX_GROUP_PARTICIPANTS);
  }, 60_000);

  it('a link with a use limit stops working after that many people', async () => {
    const g = await makeGroup(owner, 'Limited');
    const link = await newLink(owner, g.id, { maxUses: 1 });
    expect((await join(await registerUser(t, 'Lim1'), link)).status).toBe(200);
    expect((await join(await registerUser(t, 'Lim2'), link)).status).toBe(404);
  });

  it('only an admin can delete a group, and then it is gone for everybody', async () => {
    const g = await makeGroup(owner, 'Doomed');
    await join(u1, await newLink(owner, g.id));
    const body = { password: PASSWORD, confirm: 'DELETE' };
    expect((await u1.client.delete(`/api/relationships/${g.id}`, body)).status).toBe(403);
    expect((await owner.client.delete(`/api/relationships/${g.id}`, body)).status).toBe(200);
    expect((await u1.client.get(`/api/relationships/${g.id}`)).status).toBe(404);
    expect(await Relationship.countDocuments({ _id: g.id })).toBe(0);
  });
});
