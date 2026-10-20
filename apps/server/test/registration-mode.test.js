import { afterAll, beforeAll, expect, it } from 'vitest';
import { PASSWORD, makeClient, registerUser, startTestApp } from './helpers.js';

let t;
beforeAll(async () => {
  t = await startTestApp({ env: { REGISTRATION_MODE: 'invite_only', EMAIL_VERIFICATION: 'off' } });
});
afterAll(() => t?.close());

it('invite-only: blocks open sign-up but allows the first user and people holding a valid invite', async () => {
  const first = await registerUser(t, 'Founder', { verify: false });
  const stranger = await makeClient(t).post('/api/auth/register', {
    email: 's@example.test',
    username: 'stranger',
    displayName: 'S',
    password: PASSWORD,
  });
  expect(stranger.status).toBe(403);
  expect(stranger.body.error.code).toBe('invite_only');

  const space = await first.client.post('/api/relationships', {});
  const inv = await first.client.post(`/api/relationships/${space.body.relationship.id}/invitations`, {});
  const partner = makeClient(t);
  const invited = await partner.post('/api/auth/register', {
    email: 'p@example.test',
    username: 'partner',
    displayName: 'P',
    password: PASSWORD,
    inviteToken: inv.body.invitation.token,
  });
  expect(invited.status).toBe(201);
  // Registering with an invite does NOT join the space by itself — accepting is a separate step.
  expect((await partner.get('/api/relationships')).body.relationships).toEqual([]);
  expect((await partner.post('/api/invitations/accept', { token: inv.body.invitation.token })).status).toBe(200);
  expect((await partner.get('/api/relationships')).body.relationships).toHaveLength(1);
});
