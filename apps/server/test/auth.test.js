import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { CSRF_HEADER } from '@olw/shared';
import { Session, User } from '../src/models/index.js';
import { PASSWORD, lastEmailTo, makeClient, registerUser, startTestApp, tokenFromEmail } from './helpers.js';

let t;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(() => t?.close());

describe('registration & sessions', () => {
  it('registers, stores an argon2id hash, and sets an httpOnly SameSite session cookie', async () => {
    const c = makeClient(t);
    const res = await c.post('/api/auth/register', {
      email: 'New@Example.test',
      username: 'newbie',
      displayName: 'New',
      password: PASSWORD,
    });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('new@example.test');
    expect(res.body.user).not.toHaveProperty('passwordHash');
    const cookie = res.headers['set-cookie'].join(';');
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const user = await User.findOne({ email: 'new@example.test' }).select('+passwordHash');
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    // Only a hash of the session token is stored.
    const raw = c.cookie.split('=')[1];
    expect(await Session.exists({ tokenHash: raw })).toBeNull();
    expect((await c.get('/api/auth/me')).status).toBe(200);
  });

  it('a new account has no spaces', async () => {
    const u = await registerUser(t, 'Lonely');
    const dash = await u.client.get('/api/relationships');
    expect(dash.body.relationships).toEqual([]);
  });

  it('rejects duplicates and weak passwords', async () => {
    const c = makeClient(t);
    const dup = await c.post('/api/auth/register', { email: 'new@example.test', username: 'other', displayName: 'x', password: PASSWORD });
    expect(dup.status).toBe(409);
    const weak = await c.post('/api/auth/register', { email: 'w@example.test', username: 'weak', displayName: 'x', password: 'short' });
    expect(weak.status).toBe(422);
  });

  it('logs in with email or username, logs out, and the old cookie stops working', async () => {
    const u = await registerUser(t, 'Logan');
    const c = makeClient(t);
    expect((await c.post('/api/auth/login', { identifier: 'logan', password: PASSWORD })).status).toBe(200);
    const old = c.cookie;
    expect((await c.post('/api/auth/logout')).status).toBe(200);
    const after = await request(t.server).get('/api/auth/me').set('Cookie', old);
    expect(after.status).toBe(401);
    expect((await makeClient(t).post('/api/auth/login', { identifier: u.email, password: PASSWORD })).status).toBe(200);
  });

  it('wrong password and unknown user give the same generic error', async () => {
    await registerUser(t, 'Gina');
    const a = await makeClient(t).post('/api/auth/login', { identifier: 'gina', password: 'wrong password!!' });
    const b = await makeClient(t).post('/api/auth/login', { identifier: 'nobody', password: 'wrong password!!' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('locks the account after repeated failures', async () => {
    await registerUser(t, 'Lockie');
    for (let i = 0; i < 5; i++) await makeClient(t).post('/api/auth/login', { identifier: 'lockie', password: 'bad password 123' });
    const res = await makeClient(t).post('/api/auth/login', { identifier: 'lockie', password: PASSWORD });
    expect(res.status).toBe(429);
  });
});

describe('CSRF protection', () => {
  it('mutations without the CSRF header or from another origin are refused', async () => {
    const u = await registerUser(t, 'Csrf');
    const noHeader = await request(t.server).post('/api/relationships').set('Cookie', u.client.cookie).send({});
    expect(noHeader.status).toBe(403);
    const evil = await request(t.server)
      .post('/api/relationships')
      .set('Cookie', u.client.cookie)
      .set(CSRF_HEADER, '1')
      .set('Origin', 'https://evil.example')
      .send({});
    expect(evil.status).toBe(403);
  });
});

describe('email verification & password reset', () => {
  it('unverified users cannot create or join spaces when verification is required', async () => {
    const u = await registerUser(t, 'Unverified', { verify: false });
    const res = await u.client.post('/api/relationships', {});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('email_unverified');
  });

  it('verification tokens are single-use', async () => {
    const u = await registerUser(t, 'Vera', { verify: false });
    const token = tokenFromEmail(lastEmailTo(t, u.email));
    expect((await u.client.post('/api/auth/verify-email', { token })).status).toBe(200);
    expect((await u.client.post('/api/auth/verify-email', { token })).status).toBe(400);
    expect((await u.client.get('/api/auth/me')).body.user.emailVerified).toBe(true);
  });

  it('forgot-password never reveals whether an account exists', async () => {
    const a = await makeClient(t).post('/api/auth/forgot-password', { email: 'ghost@example.test' });
    const u = await registerUser(t, 'Rosa');
    const b = await makeClient(t).post('/api/auth/forgot-password', { email: u.email });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body).toEqual(b.body);
  });

  it('reset works once, changes the password and revokes all sessions', async () => {
    const u = await registerUser(t, 'Resa');
    await makeClient(t).post('/api/auth/forgot-password', { email: u.email });
    const token = tokenFromEmail(lastEmailTo(t, u.email));
    const newPassword = 'a brand new long password';
    expect((await makeClient(t).post('/api/auth/reset-password', { token, password: newPassword })).status).toBe(200);
    expect((await makeClient(t).post('/api/auth/reset-password', { token, password: newPassword })).status).toBe(400);
    expect((await u.client.get('/api/auth/me')).status).toBe(401);
    expect((await makeClient(t).post('/api/auth/login', { identifier: 'resa', password: PASSWORD })).status).toBe(401);
    expect((await makeClient(t).post('/api/auth/login', { identifier: 'resa', password: newPassword })).status).toBe(200);
  });
});

