import crypto from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import request from 'supertest';
import { io as ioClient } from 'socket.io-client';
import { inject } from 'vitest';
import { CSRF_HEADER, SESSION_COOKIE } from '@olw/shared';
import { loadConfig } from '../src/config/env.js';
import { connectDb, disconnectDb } from '../src/db/connect.js';
import { createApp } from '../src/app.js';
import { createMailer } from '../src/email/mailer.js';
import { createStorage } from '../src/storage/index.js';
import { RealtimeHub } from '../src/realtime/hub.js';
import { attachSocketServer } from '../src/realtime/socket.js';

export const PASSWORD = 'correct horse battery staple';

/** A real 1×1 PNG, so magic-byte verification passes. */
export const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Boots the REAL application (routes, authorization, Socket.IO, storage) against a fresh database.
 * Nothing about authorization is mocked.
 */
export async function startTestApp({ env = {}, rateLimit, config: configOverrides } = {}) {
  const uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'olw-test-'));
  const config = loadConfig({
    skipDotEnv: true,
    env: {
      NODE_ENV: 'test',
      SERVE_WEB: 'false',
      RATE_LIMIT: rateLimit ? 'true' : 'false',
      APP_ORIGIN: 'http://localhost:3999',
      EMAIL_VERIFICATION: 'required',
      REGISTRATION_MODE: 'open',
      // Most suites exercise spaces owned by many different users; admin-only creation has its own test.
      SPACE_CREATION: 'everyone',
      MONGODB_URI: inject('mongoUri'),
      UPLOAD_DIR: uploadDir,
      SESSION_SECRET: 'test-session-secret-0123456789abcdef',
      MEDIA_SIGNING_SECRET: 'test-media-secret-0123456789abcdef',
      ...env,
    },
    rateLimit,
    config: configOverrides,
  });
  await connectDb(config, { dbName: `olw_test_${crypto.randomUUID().slice(0, 8)}` });
  const [mailer, storage] = await Promise.all([createMailer(config, { memory: true }), createStorage(config)]);
  const hub = new RealtimeHub();
  const app = createApp({ config, mailer, storage, hub });
  const server = http.createServer(app);
  const io = attachSocketServer(server, { config, hub });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const sockets = new Set();
  return {
    config,
    app,
    server,
    io,
    hub,
    mailer,
    storage,
    baseUrl,
    sockets,
    async close() {
      for (const s of sockets) s.disconnect();
      io.close();
      await new Promise((resolve) => server.close(resolve));
      await import('mongoose').then(({ default: m }) => m.connection.dropDatabase()).catch(() => {});
      await disconnectDb();
      await fs.rm(uploadDir, { recursive: true, force: true });
    },
  };
}

/** A browser-like client: keeps its own session cookie and always sends the CSRF header. */
export function makeClient(t) {
  let cookie = '';
  const send = (method, url, body, headers = {}) => {
    let r = request(t.server)[method](url).set(CSRF_HEADER, '1');
    if (cookie) r = r.set('Cookie', cookie);
    for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
    if (body !== undefined) r = r.send(body);
    return r.then((res) => {
      const setCookie = res.headers['set-cookie'];
      const session = setCookie?.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
      if (session) cookie = session.split(';')[0];
      return res;
    });
  };
  return {
    get: (url, headers) => send('get', url, undefined, headers),
    post: (url, body = {}, headers) => send('post', url, body, headers),
    patch: (url, body = {}, headers) => send('patch', url, body, headers),
    put: (url, body, headers) => send('put', url, body, headers),
    delete: (url, body, headers) => send('delete', url, body, headers),
    get cookie() {
      return cookie;
    },
    set cookie(v) {
      cookie = v;
    },
  };
}

export function lastEmailTo(t, email) {
  const msg = [...t.mailer.outbox].reverse().find((m) => m.to === email);
  if (!msg) throw new Error(`no email to ${email}`);
  return msg;
}

export const tokenFromEmail = (msg) => /token=([A-Za-z0-9_-]+)/.exec(msg.text)?.[1];

/** Registers + verifies a user through the public API. */
export async function registerUser(t, name, { verify = true } = {}) {
  const client = makeClient(t);
  const email = `${name.toLowerCase()}@example.test`;
  const res = await client.post('/api/auth/register', {
    email,
    username: name.toLowerCase(),
    displayName: name,
    password: PASSWORD,
  });
  if (res.status !== 201) throw new Error(`register ${name}: ${res.status} ${JSON.stringify(res.body)}`);
  if (verify) {
    const token = tokenFromEmail(lastEmailTo(t, email));
    const v = await client.post('/api/auth/verify-email', { token });
    if (v.status !== 200) throw new Error(`verify ${name}: ${v.status}`);
  }
  return { client, id: res.body.user.id, email, name };
}

/** Creates a space owned by `owner` and has `partner` join through a real invitation. */
export async function createSpace(owner, partner, title = 'Our space') {
  const created = await owner.client.post('/api/relationships', { title });
  if (created.status !== 201) throw new Error(`create space: ${created.status} ${JSON.stringify(created.body)}`);
  const relId = created.body.relationship.id;
  const inv = await owner.client.post(`/api/relationships/${relId}/invitations`, {});
  if (inv.status !== 201) throw new Error(`invite: ${inv.status} ${JSON.stringify(inv.body)}`);
  if (partner) {
    const acc = await partner.client.post('/api/invitations/accept', { token: inv.body.invitation.token });
    if (acc.status !== 200) throw new Error(`accept: ${acc.status} ${JSON.stringify(acc.body)}`);
  }
  return { id: relId, inviteToken: inv.body.invitation.token };
}

/** Full private upload flow: intent → PUT bytes → complete. Returns the attachment view. */
export async function uploadPng(user, relId, { purpose = 'message' } = {}) {
  const intent = await user.client.post(`/api/relationships/${relId}/attachments`, {
    fileName: 'pic.png',
    mime: 'image/png',
    size: PNG_BYTES.length,
    purpose,
  });
  if (intent.status !== 201) throw new Error(`upload intent: ${intent.status} ${JSON.stringify(intent.body)}`);
  const put = await user.client.put(intent.body.upload.url, PNG_BYTES, { 'Content-Type': 'image/png' });
  if (put.status !== 200) throw new Error(`upload put: ${put.status} ${JSON.stringify(put.body)}`);
  const done = await user.client.post(`/api/relationships/${relId}/attachments/${intent.body.attachment.id}/complete`);
  if (done.status !== 200) throw new Error(`upload complete: ${done.status} ${JSON.stringify(done.body)}`);
  return done.body.attachment;
}

export async function sendMessage(user, relId, body, extra = {}) {
  const res = await user.client.post(`/api/relationships/${relId}/messages`, {
    clientId: crypto.randomUUID(),
    body,
    ...extra,
  });
  if (res.status !== 201) throw new Error(`send: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.message;
}

// ── Sockets ──────────────────────────────────────────────────────────────
export async function connectSocket(t, user) {
  const socket = ioClient(t.baseUrl, {
    transports: ['websocket'],
    extraHeaders: user ? { cookie: user.client.cookie } : {},
    forceNew: true,
    reconnection: false,
  });
  t.sockets.add(socket);
  socket.received = [];
  socket.onAny((event, payload) => socket.received.push({ event, payload }));
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}

export const emitAck = (socket, event, payload, timeoutMs = 3000) =>
  socket.timeout(timeoutMs).emitWithAck(event, payload);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
