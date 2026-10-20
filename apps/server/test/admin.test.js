import { afterAll, beforeAll, expect, it } from 'vitest';
import { User } from '../src/models/index.js';
import { createAdmin } from '../src/scripts/create-admin.js';
import { PASSWORD, makeClient, registerUser, startTestApp } from './helpers.js';

let t;
beforeAll(async () => {
  t = await startTestApp({ env: { SPACE_CREATION: 'admin_only' } });
});
afterAll(() => t?.close());

it('the first account becomes admin; later accounts are members', async () => {
  const owner = await registerUser(t, 'Owner');
  const girl = await registerUser(t, 'Girl');
  expect((await owner.client.get('/api/auth/me')).body.user.isAdmin).toBe(true);
  expect((await girl.client.get('/api/auth/me')).body.user.isAdmin).toBe(false);
});

it('only the admin can create spaces; members can still join through an invite', async () => {
  const owner = makeClient(t);
  await owner.post('/api/auth/login', { identifier: 'owner', password: PASSWORD });
  const girl = makeClient(t);
  await girl.post('/api/auth/login', { identifier: 'girl', password: PASSWORD });

  const denied = await girl.post('/api/relationships', {});
  expect(denied.status).toBe(403);
  expect(denied.body.error.code).toBe('admin_only');

  const created = await owner.post('/api/relationships', { title: 'Girl' });
  expect(created.status).toBe(201);
  const inv = await owner.post(`/api/relationships/${created.body.relationship.id}/invitations`, {});
  expect((await girl.post('/api/invitations/accept', { token: inv.body.invitation.token })).status).toBe(200);
  expect((await girl.get('/api/relationships')).body.relationships).toHaveLength(1);
});

it('create-admin promotes an existing user or creates a new verified admin', async () => {
  const promoted = await createAdmin({ email: 'girl@example.test' });
  expect(promoted.created).toBe(false);
  expect((await User.findOne({ email: 'girl@example.test' })).role).toBe('admin');

  const fresh = await createAdmin({ email: 'boss@example.test', username: 'boss', displayName: 'Boss' });
  expect(fresh.created).toBe(true);
  expect(fresh.generatedPassword.length).toBeGreaterThanOrEqual(10);
  const login = await makeClient(t).post('/api/auth/login', { identifier: 'boss', password: fresh.generatedPassword });
  expect(login.status).toBe(200);
  expect(login.body.user.isAdmin).toBe(true);
});
