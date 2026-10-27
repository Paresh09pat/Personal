import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LIMITS } from '@olw/shared';
import { Invitation, Relationship } from '../src/models/index.js';
import { sha256 } from '../src/lib/crypto.js';
import { createSpace, makeClient, registerUser, startTestApp } from './helpers.js';

let t;
let n = 0;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(() => t?.close());

const newUser = (prefix) => registerUser(t, `${prefix}${++n}`);

/** A fresh owner with one pending space and a live invitation. */
async function pendingSpace(opts = {}) {
  const owner = await newUser('Owner');
  const created = await owner.client.post('/api/relationships', { title: 'pending' });
  const relId = created.body.relationship.id;
  const inv = await owner.client.post(`/api/relationships/${relId}/invitations`, opts);
  return { owner, relId, token: inv.body.invitation.token, url: inv.body.invitation.url };
}

describe('invitations', () => {
  it('stores only a hash of the token and builds a link', async () => {
    const { token, url } = await pendingSpace();
    expect(url).toContain(`/invite/${token}`);
    expect(await Invitation.exists({ tokenHash: token })).toBeNull();
    expect(await Invitation.exists({ tokenHash: sha256(token) })).toBeTruthy();
  });

  it('preview shows only inviter name and title', async () => {
    const { token } = await pendingSpace();
    const res = await makeClient(t).post('/api/invitations/preview', { token });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.invitation).sort()).toEqual(['emailRestricted', 'expiresAt', 'inviterName', 'kind', 'spaceTitle']);
  });

  it('requires sign-in to accept', async () => {
    const { token } = await pendingSpace();
    expect((await makeClient(t).post('/api/invitations/accept', { token })).status).toBe(401);
  });

  it('is single use', async () => {
    const { token } = await pendingSpace();
    const p1 = await newUser('Partner');
    const p2 = await newUser('Partner');
    expect((await p1.client.post('/api/invitations/accept', { token })).status).toBe(200);
    expect((await p2.client.post('/api/invitations/accept', { token })).status).toBe(404);
  });

  it('concurrent accepts: exactly one wins and the space has exactly two people', async () => {
    const { relId, token } = await pendingSpace();
    const racers = await Promise.all([1, 2, 3].map(() => newUser('Racer')));
    const results = await Promise.all(racers.map((r) => r.client.post('/api/invitations/accept', { token })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const rel = await Relationship.findById(relId);
    expect(rel.participants).toHaveLength(2);
    expect(rel.status).toBe('active');
  });

  it('cannot be accepted by the inviter', async () => {
    const { owner, token } = await pendingSpace();
    expect((await owner.client.post('/api/invitations/accept', { token })).status).toBe(400);
  });

  it('expired tokens are rejected', async () => {
    const { token } = await pendingSpace();
    await Invitation.updateOne({ tokenHash: sha256(token) }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const p = await newUser('Late');
    expect((await p.client.post('/api/invitations/accept', { token })).status).toBe(404);
  });

  it('revoked tokens are rejected; a new invite revokes the previous one', async () => {
    const { owner, relId, token } = await pendingSpace();
    const second = await owner.client.post(`/api/relationships/${relId}/invitations`, {});
    const p = await newUser('Revoked');
    expect((await p.client.post('/api/invitations/accept', { token })).status).toBe(404);
    await owner.client.delete(`/api/relationships/${relId}/invitations/current`);
    expect((await p.client.post('/api/invitations/accept', { token: second.body.invitation.token })).status).toBe(404);
  });

  it('email-restricted invites only work for that email', async () => {
    const right = await newUser('Right');
    const { token } = await pendingSpace({ inviteeEmail: right.email });
    const wrong = await newUser('Wrong');
    expect((await wrong.client.post('/api/invitations/accept', { token })).status).toBe(403);
    expect((await right.client.post('/api/invitations/accept', { token })).status).toBe(200);
  });

  it('the same pair cannot end up with two active spaces', async () => {
    const owner = await newUser('Owner');
    const pair = await newUser('Pair');
    await createSpace(owner, pair, 'first');
    const created = await owner.client.post('/api/relationships', {});
    const inv = await owner.client.post(`/api/relationships/${created.body.relationship.id}/invitations`, {});
    const res = await pair.client.post('/api/invitations/accept', { token: inv.body.invitation.token });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('duplicate_pair');
  });

  it('no third person can ever be added to an active space', async () => {
    const owner = await newUser('Owner');
    const p = await newUser('Second');
    const { id } = await createSpace(owner, p);
    const inv = await owner.client.post(`/api/relationships/${id}/invitations`, {});
    expect(inv.status).toBe(409);
    // Even bypassing the API, the schema refuses a third participant.
    const rel = await Relationship.findById(id);
    rel.participants.push({ userId: owner.id, role: 'partner' });
    await expect(rel.save()).rejects.toThrow(/space is full/);
  });

  it('only the owner can invite, and only for their own space', async () => {
    const { relId } = await pendingSpace();
    const stranger = await newUser('Stranger');
    expect((await stranger.client.post(`/api/relationships/${relId}/invitations`, {})).status).toBe(404);
  });

  it('decline marks the invitation declined', async () => {
    const { token } = await pendingSpace();
    const p = await newUser('Decliner');
    expect((await p.client.post('/api/invitations/decline', { token })).status).toBe(200);
    expect((await p.client.post('/api/invitations/accept', { token })).status).toBe(404);
  });

  it('limits how many spaces can wait for a partner at once', async () => {
    const owner = await newUser('Busy');
    for (let i = 0; i < LIMITS.maxPendingSpacesPerUser; i++) {
      expect((await owner.client.post('/api/relationships', {})).status).toBe(201);
    }
    expect((await owner.client.post('/api/relationships', {})).status).toBe(429);
  });
});
