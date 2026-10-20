/**
 * Relationship isolation suite — users A, B, C; spaces AB and AC.
 * Runs the real HTTP routes, Socket.IO server, storage and authorization against a real MongoDB.
 */
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { EVENTS } from '@olw/shared';
import {
  PNG_BYTES,
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
let A;
let B;
let C;
let AB;
let AC;
const seed = {};

beforeAll(async () => {
  t = await startTestApp();
  A = await registerUser(t, 'Alex');
  B = await registerUser(t, 'Bella');
  C = await registerUser(t, 'Cleo');
  AB = (await createSpace(A, B, 'Alex & Bella')).id;
  AC = (await createSpace(A, C, 'Alex & Cleo')).id;

  // Seed private content in both spaces.
  seed.abMsg = await sendMessage(A, AB, 'secret for Bella');
  seed.acMsg = await sendMessage(A, AC, 'secret for Cleo');
  seed.abPic = await uploadPng(A, AB);
  seed.acPic = await uploadPng(A, AC);
  for (const [rel, key] of [[AB, 'ab'], [AC, 'ac']]) {
    const mem = await A.client.post(`/api/relationships/${rel}/memories`, { title: `memory ${key}`, date: '2024-02-14' });
    seed[`${key}Memory`] = mem.body.item;
    const note = await A.client.post(`/api/relationships/${rel}/notes`, { body: `note ${key}` });
    seed[`${key}Note`] = note.body.item;
    const letter = await A.client.post(`/api/relationships/${rel}/letters`, { title: `open when ${key}`, body: `letter ${key}` });
    seed[`${key}Letter`] = letter.body.item;
    const ms = await A.client.post(`/api/relationships/${rel}/milestones`, { title: `milestone ${key}`, date: '2023-06-01' });
    seed[`${key}Milestone`] = ms.body.item;
    const album = await A.client.post(`/api/relationships/${rel}/albums`, { title: `album ${key}` });
    seed[`${key}Album`] = album.body.item;
    const surprisePic = await uploadPng(A, rel, { purpose: 'surprise' });
    const draft = await A.client.post(`/api/relationships/${rel}/surprises`, {
      title: `draft surprise ${key}`,
      message: 'unpublished',
      mediaIds: [surprisePic.id],
    });
    seed[`${key}Surprise`] = draft.body.item;
    seed[`${key}SurprisePic`] = surprisePic;
  }
}, 180_000);

afterAll(async () => {
  await t?.close();
});

const rel = (id, rest = '') => `/api/relationships/${id}${rest}`;

describe('1–3. who can access which space', () => {
  it('1. User A can access both AB and AC', async () => {
    const dash = await A.client.get('/api/relationships');
    expect(dash.status).toBe(200);
    expect(dash.body.relationships.map((r) => r.id).sort()).toEqual([AB, AC].sort());
    for (const id of [AB, AC]) {
      expect((await A.client.get(rel(id))).status).toBe(200);
      expect((await A.client.get(rel(id, '/messages'))).status).toBe(200);
    }
  });

  it('2. Partner B can access only AB', async () => {
    const dash = await B.client.get('/api/relationships');
    expect(dash.body.relationships.map((r) => r.id)).toEqual([AB]);
    expect(JSON.stringify(dash.body)).not.toContain(AC);
    expect(JSON.stringify(dash.body)).not.toContain('Cleo');
    expect((await B.client.get(rel(AB, '/messages'))).status).toBe(200);
    expect((await B.client.get(rel(AC))).status).toBe(404);
  });

  it('3. Partner C can access only AC', async () => {
    const dash = await C.client.get('/api/relationships');
    expect(dash.body.relationships.map((r) => r.id)).toEqual([AC]);
    expect(JSON.stringify(dash.body)).not.toContain(AB);
    expect(JSON.stringify(dash.body)).not.toContain('Bella');
    expect((await C.client.get(rel(AC, '/messages'))).status).toBe(200);
    expect((await C.client.get(rel(AB))).status).toBe(404);
  });
});

describe('4–5. messages cannot be read across spaces', () => {
  it('4. Partner B cannot read AC messages using its relationship ID', async () => {
    const res = await B.client.get(rel(AC, '/messages'));
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('secret for Cleo');
    // B's own space never contains AC data either.
    const own = await B.client.get(rel(AB, '/messages'));
    expect(own.body.messages.map((m) => m.body)).toEqual(['secret for Bella']);
  });

  it('5. Partner C cannot read AB messages using its relationship ID', async () => {
    const res = await C.client.get(rel(AB, '/messages'));
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('secret for Bella');
    const own = await C.client.get(rel(AC, '/messages'));
    expect(own.body.messages.map((m) => m.body)).toEqual(['secret for Cleo']);
  });

  it('a message id from another space is "not found" even through your own space', async () => {
    expect((await B.client.patch(rel(AB, `/messages/${seed.acMsg.id}`), { body: 'hijack' })).status).toBe(404);
    expect((await B.client.delete(rel(AB, `/messages/${seed.acMsg.id}`))).status).toBe(404);
    expect((await B.client.post(rel(AB, `/messages/${seed.acMsg.id}/reactions`), { emoji: '❤️' })).status).toBe(404);
    expect((await B.client.post(rel(AB, '/read'), { messageId: seed.acMsg.id })).status).toBe(404);
  });
});

describe('6. private attachments', () => {
  it('B cannot fetch an AC attachment by id via either space', async () => {
    for (const path of ['/content', '/url', '']) {
      expect((await B.client.get(rel(AC, `/attachments/${seed.acPic.id}${path}`))).status).toBe(404);
      expect((await B.client.get(rel(AB, `/attachments/${seed.acPic.id}${path}`))).status).toBe(404);
    }
  });

  it('C cannot fetch an AB attachment by id via either space', async () => {
    expect((await C.client.get(rel(AB, `/attachments/${seed.abPic.id}/content`))).status).toBe(404);
    expect((await C.client.get(rel(AC, `/attachments/${seed.abPic.id}/content`))).status).toBe(404);
  });

  it('a leaked signed media URL is useless to the other partner, to anonymous users, and when tampered', async () => {
    const signed = await A.client.get(rel(AC, `/attachments/${seed.acPic.id}/url`));
    expect(signed.status).toBe(200);
    const url = signed.body.url;
    // The legitimate owner of the URL can use it.
    const ok = await A.client.get(url);
    expect(ok.status).toBe(200);
    expect(Buffer.compare(ok.body, PNG_BYTES)).toBe(0);
    // B (logged in) cannot; nobody anonymous can; a tampered token is rejected.
    expect((await B.client.get(url)).status).toBe(404);
    expect((await request(t.server).get(url)).status).toBe(404);
    const [body, sig] = url.split('/').pop().split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), u: B.id })).toString('base64url');
    expect((await B.client.get(`/api/media/file/${forged}.${sig}`)).status).toBe(404);
  });

  it('the legitimate partner can view the attachment, the other cannot even with the content URL', async () => {
    expect((await C.client.get(seed.acPic.url)).status).toBe(200);
    expect((await B.client.get(seed.acPic.url)).status).toBe(404);
  });

  it('another space\'s attachment cannot be smuggled into my space', async () => {
    const res = await B.client.post(rel(AB, '/messages'), { clientId: crypto.randomUUID(), attachmentIds: [seed.acPic.id] });
    expect(res.status).toBe(422);
    const mem = await B.client.post(rel(AB, '/memories'), { title: 'x', date: '2024-01-01', mediaIds: [seed.acPic.id] });
    expect(mem.status).toBe(422);
    const album = await B.client.post(rel(AB, `/albums/${seed.abAlbum.id}/items`), { attachmentIds: [seed.acPic.id] });
    expect(album.status).toBe(422);
    const avatar = await B.client.patch(rel(AB, '/me'), { avatarAttachmentId: seed.acPic.id });
    expect(avatar.status).toBe(422);
  });

  it('B cannot upload into AC, nor complete or PUT to an AC upload slot', async () => {
    const intent = await B.client.post(rel(AC, '/attachments'), { fileName: 'x.png', mime: 'image/png', size: PNG_BYTES.length });
    expect(intent.status).toBe(404);
    const aIntent = await A.client.post(rel(AC, '/attachments'), { fileName: 'y.png', mime: 'image/png', size: PNG_BYTES.length });
    expect(aIntent.status).toBe(201);
    const put = await B.client.put(aIntent.body.upload.url, PNG_BYTES, { 'Content-Type': 'image/png' });
    expect(put.status).toBe(404);
    expect((await B.client.post(rel(AC, `/attachments/${aIntent.body.attachment.id}/complete`))).status).toBe(404);
    expect((await B.client.post(rel(AB, `/attachments/${aIntent.body.attachment.id}/complete`))).status).toBe(404);
  });

  it('gallery listings contain only the space\'s own media', async () => {
    const abGallery = await B.client.get(rel(AB, '/attachments'));
    const ids = abGallery.body.attachments.map((a) => a.id);
    expect(ids).toContain(seed.abPic.id);
    expect(ids).not.toContain(seed.acPic.id);
    expect(ids).not.toContain(seed.abSurprisePic.id); // private surprise media is never in the gallery
  });
});

describe('7. Socket.IO isolation', () => {
  it('B and C cannot join each other\'s rooms', async () => {
    const sb = await connectSocket(t, B);
    const sc = await connectSocket(t, C);
    expect((await emitAck(sb, EVENTS.RELATIONSHIP_JOIN, { relationshipId: AC })).ok).toBe(false);
    expect((await emitAck(sc, EVENTS.RELATIONSHIP_JOIN, { relationshipId: AB })).ok).toBe(false);
    expect((await emitAck(sb, EVENTS.RELATIONSHIP_JOIN, { relationshipId: AB })).ok).toBe(true);
    expect((await emitAck(sc, EVENTS.RELATIONSHIP_JOIN, { relationshipId: AC })).ok).toBe(true);
  });

  it('neither partner receives the other\'s events (messages, typing, reads, notifications, content)', async () => {
    const sa = await connectSocket(t, A);
    const sb = await connectSocket(t, B);
    const sc = await connectSocket(t, C);
    await emitAck(sa, EVENTS.RELATIONSHIP_JOIN, { relationshipId: AB });
    await emitAck(sa, EVENTS.RELATIONSHIP_JOIN, { relationshipId: AC });
    await emitAck(sb, EVENTS.RELATIONSHIP_JOIN, { relationshipId: AB });
    await emitAck(sc, EVENTS.RELATIONSHIP_JOIN, { relationshipId: AC });
    // B also *tries* to join AC; refused.
    await emitAck(sb, EVENTS.RELATIONSHIP_JOIN, { relationshipId: AC });
    sb.received.length = 0;
    sc.received.length = 0;

    const toAC = await sendMessage(A, AC, 'only Cleo may see this');
    await emitAck(sa, EVENTS.TYPING, { relationshipId: AC, isTyping: true });
    await A.client.post(rel(AC, '/notes'), { body: 'for Cleo' });
    const cMsg = await sendMessage(C, AC, 'reply from Cleo');
    await emitAck(sa, EVENTS.READ_UPDATE, { relationshipId: AC, messageId: cMsg.id });
    const toAB = await sendMessage(A, AB, 'only Bella may see this');
    await sleep(400);

    const bDump = JSON.stringify(sb.received);
    const cDump = JSON.stringify(sc.received);
    expect(bDump).not.toContain(AC);
    expect(bDump).not.toContain('only Cleo may see this');
    expect(bDump).not.toContain(toAC.id);
    expect(cDump).not.toContain(AB);
    expect(cDump).not.toContain('only Bella may see this');
    expect(cDump).not.toContain(toAB.id);
    // …while each does receive their own space's events.
    expect(sb.received.some((e) => e.event === EVENTS.MESSAGE_NEW && e.payload.message.id === toAB.id)).toBe(true);
    expect(sc.received.some((e) => e.event === EVENTS.MESSAGE_NEW && e.payload.message.id === toAC.id)).toBe(true);
    expect(sc.received.some((e) => e.event === EVENTS.TYPING)).toBe(true);
    expect(sb.received.some((e) => e.event === EVENTS.TYPING)).toBe(false);
  });

  it('B cannot emit events into AC (send, typing, read, react)', async () => {
    const sb = await connectSocket(t, B);
    const sc = await connectSocket(t, C);
    await emitAck(sc, EVENTS.RELATIONSHIP_JOIN, { relationshipId: AC });
    sc.received.length = 0;
    const send = await emitAck(sb, EVENTS.MESSAGE_SEND, { relationshipId: AC, message: { clientId: 'x1', body: 'intrusion' } });
    expect(send.ok).toBe(false);
    expect((await emitAck(sb, EVENTS.TYPING, { relationshipId: AC, isTyping: true })).ok).toBe(false);
    expect((await emitAck(sb, EVENTS.READ_UPDATE, { relationshipId: AC, messageId: seed.acMsg.id })).ok).toBe(false);
    expect((await emitAck(sb, EVENTS.MESSAGE_REACT, { relationshipId: AC, messageId: seed.acMsg.id, emoji: '❤️' })).ok).toBe(false);
    await sleep(200);
    expect(sc.received).toEqual([]);
    const acMessages = await A.client.get(rel(AC, '/messages'));
    expect(JSON.stringify(acMessages.body)).not.toContain('intrusion');
  });

  it('a spoofed senderId / userId in a payload is ignored', async () => {
    const sb = await connectSocket(t, B);
    await emitAck(sb, EVENTS.RELATIONSHIP_JOIN, { relationshipId: AB });
    const res = await emitAck(sb, EVENTS.MESSAGE_SEND, {
      relationshipId: AB,
      senderId: A.id,
      userId: A.id,
      message: { clientId: crypto.randomUUID(), body: 'pretending to be Alex', senderId: A.id },
    });
    expect(res.ok).toBe(true);
    expect(res.message.senderId).toBe(B.id);
    const http = await B.client.post(rel(AB, '/messages'), { clientId: crypto.randomUUID(), body: 'again', senderId: A.id });
    expect(http.body.message.senderId).toBe(B.id);
  });

  it('unauthenticated sockets are refused', async () => {
    await expect(connectSocket(t, null)).rejects.toThrow();
  });
});

describe('8. calls', () => {
  it('neither partner can start, join or get a token for the other\'s call', async () => {
    expect((await B.client.post(rel(AC, '/calls'), { kind: 'video' })).status).toBe(404);
    expect((await C.client.post(rel(AB, '/calls'), { kind: 'video' })).status).toBe(404);

    const acCall = await A.client.post(rel(AC, '/calls'), { kind: 'video' });
    expect(acCall.status).toBe(201);
    const callId = acCall.body.call.id;

    expect((await B.client.post(rel(AC, `/calls/${callId}/token`))).status).toBe(404);
    expect((await B.client.post(rel(AB, `/calls/${callId}/token`))).status).toBe(404);
    expect((await B.client.get(rel(AC, '/calls'))).status).toBe(404);

    const sb = await connectSocket(t, B);
    // Stolen token (minted for A) does not work for B.
    expect((await emitAck(sb, EVENTS.CALL_JOIN, { callId, token: acCall.body.token })).ok).toBe(false);
    // B's own legit AB call token cannot open the AC call room.
    const abCall = await A.client.post(rel(AB, '/calls'), { kind: 'audio' });
    const bTok = await B.client.post(rel(AB, `/calls/${abCall.body.call.id}/token`));
    expect(bTok.status).toBe(200);
    expect((await emitAck(sb, EVENTS.CALL_JOIN, { callId, token: bTok.body.token })).ok).toBe(false);
    // Signals into a room you're not in go nowhere.
    expect((await emitAck(sb, EVENTS.CALL_SIGNAL, { callId, data: { sdp: 'x' } })).ok).toBe(false);

    // The legitimate partner C can join.
    const cTok = await C.client.post(rel(AC, `/calls/${callId}/token`));
    const sc = await connectSocket(t, C);
    const joined = await emitAck(sc, EVENTS.CALL_JOIN, { callId, token: cTok.body.token });
    expect(joined.ok).toBe(true);
    await A.client.post(rel(AC, `/calls/${callId}/end`));
    await A.client.post(rel(AB, `/calls/${abCall.body.call.id}/end`));
  });
});

describe('9. surprises', () => {
  it('unpublished surprises are invisible to the partner in the same space and to other spaces', async () => {
    const bList = await B.client.get(rel(AB, '/surprises'));
    expect(bList.status).toBe(200);
    expect(bList.body.items.map((s) => s.id)).not.toContain(seed.abSurprise.id);
    expect((await B.client.get(rel(AB, `/surprises/${seed.abSurprise.id}`))).status).toBe(404);
    expect((await B.client.get(seed.abSurprisePic.url)).status).toBe(404);
    // Cross-space attempts.
    expect((await B.client.get(rel(AC, `/surprises/${seed.acSurprise.id}`))).status).toBe(404);
    expect((await B.client.get(rel(AB, `/surprises/${seed.acSurprise.id}`))).status).toBe(404);
    expect((await C.client.get(rel(AB, `/surprises/${seed.abSurprise.id}`))).status).toBe(404);
    expect((await C.client.get(rel(AC, `/surprises/${seed.abSurprise.id}`))).status).toBe(404);
    expect((await C.client.get(seed.abSurprisePic.url)).status).toBe(404);
  });

  it('after publishing, only the intended partner sees it', async () => {
    const pub = await A.client.post(rel(AB, `/surprises/${seed.abSurprise.id}/publish`), {});
    expect(pub.status).toBe(200);
    const bView = await B.client.get(rel(AB, `/surprises/${seed.abSurprise.id}`));
    expect(bView.status).toBe(200);
    expect(bView.body.item.message).toBe('unpublished');
    expect((await B.client.get(seed.abSurprisePic.url)).status).toBe(200);
    expect((await C.client.get(rel(AC, `/surprises/${seed.abSurprise.id}`))).status).toBe(404);
    expect((await C.client.get(seed.abSurprisePic.url)).status).toBe(404);
    // B still cannot see AC's (still unpublished) surprise.
    expect((await B.client.get(rel(AC, '/surprises'))).status).toBe(404);
  });

  it('B cannot edit, publish or delete A\'s surprise', async () => {
    expect((await B.client.patch(rel(AB, `/surprises/${seed.abSurprise.id}`), { title: 'mine now' })).status).toBe(403);
    expect((await C.client.post(rel(AC, `/surprises/${seed.abSurprise.id}/publish`))).status).toBe(404);
    expect((await B.client.delete(rel(AB, `/surprises/${seed.acSurprise.id}`))).status).toBe(404);
  });
});

describe('10. URL guessing / parameter tampering / forged state never bypass the server', () => {
  const readPaths = [
    '',
    '/messages',
    '/attachments',
    '/memories',
    '/notes',
    '/letters',
    '/surprises',
    '/milestones',
    '/albums',
    '/calls',
    '/notifications',
    '/export',
    '/invitations/current',
  ];

  it('every read endpoint of AC returns 404 for B (and AB for C)', async () => {
    for (const p of readPaths) {
      const b = await B.client.get(rel(AC, p));
      expect(b.status, `B GET ${p}`).toBe(404);
      expect(JSON.stringify(b.body)).not.toContain('Cleo');
      expect((await C.client.get(rel(AB, p))).status, `C GET ${p}`).toBe(404);
    }
  });

  it('every mutating endpoint of AC returns 404 for B, and AC is unchanged', async () => {
    const before = await A.client.get(rel(AC, '/export'));
    const attempts = [
      ['post', '/messages', { clientId: 'zz', body: 'x' }],
      ['post', '/memories', { title: 'x', date: '2024-01-01' }],
      ['patch', `/memories/${seed.acMemory.id}`, { title: 'pwned' }],
      ['delete', `/memories/${seed.acMemory.id}`],
      ['post', '/notes', { body: 'x' }],
      ['delete', `/notes/${seed.acNote.id}`],
      ['post', '/letters', { title: 'x', body: 'y' }],
      ['post', `/letters/${seed.acLetter.id}/open`],
      ['post', '/surprises', { title: 'x' }],
      ['post', '/milestones', { title: 'x', date: '2024-01-01' }],
      ['delete', `/milestones/${seed.acMilestone.id}`],
      ['post', '/albums', { title: 'x' }],
      ['post', `/albums/${seed.acAlbum.id}/items`, { attachmentIds: [seed.abPic.id] }],
      ['delete', `/attachments/${seed.acPic.id}`],
      ['post', '/calls', { kind: 'audio' }],
      ['post', '/read', { messageId: seed.acMsg.id }],
      ['post', '/invitations', {}],
      ['delete', '/invitations/current'],
      ['patch', '', { title: 'pwned' }],
      ['patch', '/me', { displayName: 'pwned' }],
      ['post', '/archive'],
      ['post', '/end', { password: 'whatever', confirm: 'END' }],
      ['post', '/deletion-request', { password: 'whatever', confirm: 'DELETE' }],
      ['delete', '', { password: 'whatever', confirm: 'DELETE' }],
      ['post', '/notifications/read-all'],
    ];
    for (const [method, p, body] of attempts) {
      const res = await B.client[method](rel(AC, p), body);
      expect(res.status, `B ${method.toUpperCase()} ${p}`).toBe(404);
    }
    const after = await A.client.get(rel(AC, '/export'));
    const strip = (x) => JSON.stringify({ ...x.body, exportedAt: null, media: x.body.media.map((m) => m.id) });
    expect(strip(after)).toBe(strip(before));
  });

  it('a relationshipId in the body or query is ignored — the URL space + membership decide', async () => {
    const res = await B.client.post(rel(AB, '/messages'), {
      clientId: crypto.randomUUID(),
      body: 'where does this go?',
      relationshipId: AC,
    });
    expect(res.status).toBe(201);
    expect(res.body.message.relationshipId).toBe(AB);
    const q = await B.client.get(`${rel(AB, '/messages')}?relationshipId=${AC}`);
    expect(q.body.messages.every((m) => m.relationshipId === AB)).toBe(true);
    const acNow = await C.client.get(rel(AC, '/messages'));
    expect(JSON.stringify(acNow.body)).not.toContain('where does this go?');
  });

  it('random / malformed / injected ids are plain 404s', async () => {
    for (const id of ['000000000000000000000000', 'not-an-id', '{"$ne":null}', `${AC}x`, encodeURIComponent('{"$gt":""}')]) {
      expect((await B.client.get(rel(id, '/messages'))).status).toBe(404);
    }
  });

  it('a forged session cookie value does not authenticate', async () => {
    const res = await request(t.server).get(rel(AC, '/messages')).set('Cookie', `olw_sid=${B.client.cookie.split('=')[1]}x`);
    expect(res.status).toBe(401);
  });

  it('an invitation token cannot be reused to join an existing space', async () => {
    // Re-create a token scenario: C tries to accept AB's (already used) invitation.
    const D = await registerUser(t, 'Dana');
    const space = await createSpace(A, null, 'pending one');
    const ok = await D.client.post('/api/invitations/accept', { token: space.inviteToken });
    expect(ok.status).toBe(200);
    const again = await C.client.post('/api/invitations/accept', { token: space.inviteToken });
    expect(again.status).toBe(404);
    expect((await C.client.get(rel(space.id))).status).toBe(404);
  });
});
