import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Attachment, Message, Relationship, User } from '../src/models/index.js';
import { EVENTS } from '@olw/shared';
import {
  PASSWORD,
  connectSocket,
  createSpace,
  emitAck,
  registerUser,
  sendMessage,
  sleep,
  startTestApp,
  uploadPng,
} from './helpers.js';

let t;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(() => t?.close());

const rel = (id, rest = '') => `/api/relationships/${id}${rest}`;

describe('archive', () => {
  it('makes the space read-only for both, and can be undone', async () => {
    const A = await registerUser(t, 'Arch1');
    const B = await registerUser(t, 'Arch2');
    const { id } = await createSpace(A, B);
    await sendMessage(A, id, 'before archive');
    expect((await B.client.post(rel(id, '/archive'))).status).toBe(200);
    expect((await A.client.get(rel(id, '/messages'))).status).toBe(200);
    const blocked = await A.client.post(rel(id, '/messages'), { clientId: 'c1', body: 'x' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('space_read_only');
    expect((await A.client.post(rel(id, '/unarchive'))).status).toBe(200);
    expect((await A.client.post(rel(id, '/messages'), { clientId: 'c2', body: 'x' })).status).toBe(201);
  });
});

describe('end', () => {
  it('requires password + END, keeps all data, blocks writes, kicks sockets', async () => {
    const A = await registerUser(t, 'End1');
    const B = await registerUser(t, 'End2');
    const { id } = await createSpace(A, B);
    await sendMessage(A, id, 'kept forever');
    const sb = await connectSocket(t, B);
    await emitAck(sb, EVENTS.RELATIONSHIP_JOIN, { relationshipId: id });

    expect((await A.client.post(rel(id, '/end'), { password: 'wrong', confirm: 'END' })).status).toBe(400);
    expect((await A.client.post(rel(id, '/end'), { password: PASSWORD, confirm: 'nope' })).status).toBe(422);
    expect((await A.client.post(rel(id, '/end'), { password: PASSWORD, confirm: 'END' })).status).toBe(200);

    const r = await Relationship.findById(id);
    expect(r.status).toBe('ended');
    expect(r.pairKey).toBeUndefined();
    expect(await Message.countDocuments({ relationshipId: id })).toBe(1);
    expect((await B.client.get(rel(id, '/messages'))).body.messages[0].body).toBe('kept forever');
    expect((await B.client.post(rel(id, '/messages'), { clientId: 'x', body: 'x' })).status).toBe(403);
    expect((await B.client.post(rel(id, '/calls'), {})).status).toBe(403);

    // The socket was removed from the room: new events no longer reach it.
    sb.received.length = 0;
    t.hub.toRelationship(id, 'probe', {});
    await sleep(150);
    expect(sb.received.find((e) => e.event === 'probe')).toBeUndefined();

    // The same pair can start a brand new space afterwards.
    await expect(createSpace(A, B, 'second chapter')).resolves.toBeTruthy();
  });
});

describe('export', () => {
  it('contains the shared conversation but never the partner\'s drafts or locked letters', async () => {
    const A = await registerUser(t, 'Exp1');
    const B = await registerUser(t, 'Exp2');
    const { id } = await createSpace(A, B);
    await sendMessage(A, id, 'hello');
    await sendMessage(B, id, 'hi back');
    await B.client.post(rel(id, '/surprises'), { title: 'B secret draft', message: 'shh' });
    await B.client.post(rel(id, '/letters'), { title: 'Open in 2099', body: 'sealed body', unlockAt: '2099-01-01' });
    await A.client.post(rel(id, '/surprises'), { title: 'A own draft', message: 'mine' });

    const res = await A.client.get(rel(id, '/export'));
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    const dump = JSON.stringify(res.body);
    expect(res.body.messages.map((m) => m.body)).toEqual(['hello', 'hi back']);
    expect(dump).not.toContain('B secret draft');
    expect(dump).not.toContain('sealed body');
    expect(dump).toContain('Open in 2099');
    expect(dump).toContain('A own draft');
    expect(dump).not.toContain(B.email);
  });
});

describe('deletion', () => {
  it('a pending space can be deleted by its owner', async () => {
    const A = await registerUser(t, 'Pend1');
    const { id } = await createSpace(A, null);
    expect((await A.client.delete(rel(id), { password: PASSWORD, confirm: 'DELETE' })).status).toBe(200);
    expect(await Relationship.exists({ _id: id })).toBeNull();
  });

  it('an active space cannot be deleted directly', async () => {
    const A = await registerUser(t, 'Act1');
    const B = await registerUser(t, 'Act2');
    const { id } = await createSpace(A, B);
    expect((await A.client.delete(rel(id), { password: PASSWORD, confirm: 'DELETE' })).status).toBe(403);
    expect((await A.client.post(rel(id, '/deletion-request'), { password: PASSWORD, confirm: 'DELETE' })).status).toBe(409);
  });

  it('needs BOTH participants; then purges documents and stored files', async () => {
    const A = await registerUser(t, 'Del1');
    const B = await registerUser(t, 'Del2');
    const { id } = await createSpace(A, B);
    const pic = await uploadPng(A, id);
    await sendMessage(A, id, 'bye', { attachmentIds: [pic.id] });
    const att = await Attachment.findById(pic.id);
    const file = path.join(t.config.storage.uploadDir, att.storageKey);
    expect(fs.existsSync(file)).toBe(true);

    await A.client.post(rel(id, '/end'), { password: PASSWORD, confirm: 'END' });
    const first = await A.client.post(rel(id, '/deletion-request'), { password: PASSWORD, confirm: 'DELETE' });
    expect(first.body.purged).toBe(false);
    expect(await Message.countDocuments({ relationshipId: id })).toBe(1);

    const second = await B.client.post(rel(id, '/deletion-request'), { password: PASSWORD, confirm: 'DELETE' });
    expect(second.body.purged).toBe(true);
    expect(await Relationship.exists({ _id: id })).toBeNull();
    expect(await Message.countDocuments({ relationshipId: id })).toBe(0);
    expect(await Attachment.countDocuments({ relationshipId: id })).toBe(0);
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe('account deletion', () => {
  it('ends spaces, keeps shared history for the partner, removes private drafts, anonymises', async () => {
    const A = await registerUser(t, 'Leaver');
    const B = await registerUser(t, 'Stayer');
    const { id } = await createSpace(A, B);
    const pending = await createSpace(A, null);
    await sendMessage(A, id, 'memories stay');
    await A.client.post(rel(id, '/surprises'), { title: 'never sent' });

    expect((await A.client.post('/api/auth/delete-account', { password: PASSWORD, confirm: 'nope' })).status).toBe(422);
    expect((await A.client.post('/api/auth/delete-account', { password: PASSWORD, confirm: 'DELETE' })).status).toBe(200);

    expect((await A.client.get('/api/auth/me')).status).toBe(401);
    const user = await User.findById(A.id);
    expect(user.email).not.toBe(A.email);
    expect(user.displayName).toBe('Deleted user');
    expect(await Relationship.exists({ _id: pending.id })).toBeNull();

    const view = await B.client.get(rel(id));
    expect(view.body.relationship.status).toBe('ended');
    expect(view.body.relationship.partner.displayName).toBe('Deleted user');
    const msgs = await B.client.get(rel(id, '/messages'));
    expect(msgs.body.messages[0].body).toBe('memories stay');
    // The partner can now delete the space alone (the leaver counts as agreed).
    const del = await B.client.post(rel(id, '/deletion-request'), { password: PASSWORD, confirm: 'DELETE' });
    expect(del.body.purged).toBe(true);
    // Email is free again.
    const again = await registerUser(t, 'Leaver');
    expect(again.id).not.toBe(A.id);
  });
});

describe('idempotent message sends', () => {
  it('resending the same clientId does not duplicate', async () => {
    const A = await registerUser(t, 'Idem1');
    const B = await registerUser(t, 'Idem2');
    const { id } = await createSpace(A, B);
    const clientId = crypto.randomUUID();
    const one = await A.client.post(rel(id, '/messages'), { clientId, body: 'once' });
    const two = await A.client.post(rel(id, '/messages'), { clientId, body: 'once' });
    expect(one.body.message.id).toBe(two.body.message.id);
    expect(await Message.countDocuments({ relationshipId: id })).toBe(1);
  });
});
