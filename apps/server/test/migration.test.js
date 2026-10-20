import { afterAll, beforeAll, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { LoveNote, Memory, Message, Migration, Relationship } from '../src/models/index.js';
import { migrateLegacy } from '../src/scripts/migrate-legacy.js';
import { registerUser, startTestApp } from './helpers.js';

let t;
let A;
let B;
beforeAll(async () => {
  t = await startTestApp();
  A = await registerUser(t, 'Legacy1');
  B = await registerUser(t, 'Legacy2');
  // Simulate the old single-couple schema: documents with no relationshipId (raw inserts bypass validation).
  const oid = (id) => new mongoose.Types.ObjectId(id);
  await Message.collection.insertMany([
    { senderId: oid(A.id), type: 'text', body: 'old hello', attachmentIds: [], reactions: [], createdAt: new Date('2022-01-01') },
    { senderId: oid(B.id), type: 'text', body: 'old reply', attachmentIds: [], reactions: [], createdAt: new Date('2022-01-02') },
  ]);
  await Memory.collection.insertOne({ authorId: oid(A.id), title: 'first date', date: new Date('2021-12-24'), mediaIds: [] });
  await LoveNote.collection.insertOne({ authorId: oid(B.id), body: 'old note' });
});
afterAll(() => t?.close());

const quiet = () => {};

it('dry run changes nothing', async () => {
  const res = await migrateLegacy({ log: quiet });
  expect(res.dryRun).toBe(true);
  expect(res.total).toBe(4);
  expect(await Message.collection.countDocuments({ relationshipId: { $exists: false } })).toBe(2);
  expect(await Relationship.countDocuments()).toBe(0);
});

it('apply moves every legacy document into one space, losing nothing, and is idempotent', async () => {
  const before = await Message.collection.countDocuments();
  const res = await migrateLegacy({ apply: true, log: quiet });
  expect(res.updated.messages).toBe(2);
  expect(await Message.collection.countDocuments()).toBe(before);
  expect(await Message.collection.countDocuments({ relationshipId: { $exists: false } })).toBe(0);
  expect(await Memory.collection.countDocuments({ relationshipId: { $exists: false } })).toBe(0);

  const rel = await Relationship.findById(res.relationshipId);
  expect(rel.status).toBe('active');
  expect(rel.participants.map((p) => String(p.userId)).sort()).toEqual([A.id, B.id].sort());
  expect(await Migration.exists({ version: 'legacy-single-relationship-v1' })).toBeTruthy();

  // Both legacy users now see the history through the normal, authorized API.
  const msgs = await A.client.get(`/api/relationships/${res.relationshipId}/messages`);
  expect(msgs.body.messages.map((m) => m.body)).toEqual(['old hello', 'old reply']);

  const again = await migrateLegacy({ apply: true, log: quiet });
  expect(again.alreadyApplied).toBe(true);
});
