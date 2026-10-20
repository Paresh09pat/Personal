import { afterAll, beforeAll, expect, it } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { PNG_BYTES, createSpace, registerUser, startTestApp, uploadPng } from './helpers.js';

/** Same private-media guarantees when files live in MongoDB (STORAGE_DRIVER=mongo, e.g. Render free). */
let t;
let A;
let B;
let C;
let AB;
let AC;
beforeAll(async () => {
  t = await startTestApp({ env: { STORAGE_DRIVER: 'mongo' } });
  A = await registerUser(t, 'Ama');
  B = await registerUser(t, 'Bea');
  C = await registerUser(t, 'Cia');
  AB = (await createSpace(A, B)).id;
  AC = (await createSpace(A, C)).id;
});
afterAll(() => t?.close());

const files = () => mongoose.connection.db.collection('media.files');

it('stores uploads in GridFS and serves them only to members', async () => {
  expect(t.storage.kind).toBe('mongo');
  const pic = await uploadPng(A, AC);
  expect(await files().countDocuments()).toBe(1);

  const ok = await C.client.get(pic.url);
  expect(ok.status).toBe(200);
  expect(ok.headers['cache-control']).toContain('no-store');
  expect(Buffer.compare(ok.body, PNG_BYTES)).toBe(0);

  expect((await B.client.get(pic.url)).status).toBe(404);
  expect((await B.client.get(`/api/relationships/${AB}/attachments/${pic.id}/content`)).status).toBe(404);
  expect((await request(t.server).get(pic.url)).status).toBe(401);

  const signed = await A.client.get(`/api/relationships/${AC}/attachments/${pic.id}/url`);
  expect((await A.client.get(signed.body.url)).status).toBe(200);
  expect((await B.client.get(signed.body.url)).status).toBe(404);
});

it('supports byte ranges (video/voice seeking)', async () => {
  const pic = await uploadPng(A, AB);
  const part = await B.client.get(pic.url, { Range: 'bytes=0-7' });
  expect(part.status).toBe(206);
  expect(part.headers['content-range']).toBe(`bytes 0-7/${PNG_BYTES.length}`);
  expect(Buffer.compare(part.body, PNG_BYTES.subarray(0, 8))).toBe(0);
});

it('rejects files whose bytes do not match the declared type, and leaves nothing behind', async () => {
  const before = await files().countDocuments();
  const intent = await A.client.post(`/api/relationships/${AB}/attachments`, {
    fileName: 'fake.png',
    mime: 'image/png',
    size: 10,
  });
  await A.client.put(intent.body.upload.url, Buffer.from('not-an-img'), { 'Content-Type': 'image/png' });
  const done = await A.client.post(`/api/relationships/${AB}/attachments/${intent.body.attachment.id}/complete`);
  expect(done.status).toBe(422);
  expect(await files().countDocuments()).toBe(before);
});

it('deleting an attachment removes the stored bytes', async () => {
  const pic = await uploadPng(A, AB);
  const before = await files().countDocuments();
  expect((await A.client.delete(`/api/relationships/${AB}/attachments/${pic.id}`)).status).toBe(200);
  expect(await files().countDocuments()).toBe(before - 1);
});
