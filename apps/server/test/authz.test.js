import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { Relationship } from '../src/models/index.js';
import { requireMember, scoped } from '../src/authz/relationship.js';
import { Message } from '../src/models/index.js';
import { createSpace, registerUser, sendMessage, startTestApp } from './helpers.js';

/** Direct tests of the central authorization helper, against a real database. */
let t;
let A;
let B;
let C;
let AB;
beforeAll(async () => {
  t = await startTestApp();
  A = await registerUser(t, 'Ann');
  B = await registerUser(t, 'Ben');
  C = await registerUser(t, 'Cat');
  AB = (await createSpace(A, B)).id;
});
afterAll(() => t?.close());

const expect404 = (p) => expect(p).rejects.toMatchObject({ status: 404 });

describe('requireMember()', () => {
  it('allows active participants', async () => {
    const ctx = await requireMember(new mongoose.Types.ObjectId(A.id), AB, { write: true });
    expect(String(ctx.relationshipId)).toBe(AB);
    expect(String(ctx.partner.userId)).toBe(B.id);
  });

  it('rejects non-members, missing users and garbage ids with 404', async () => {
    await expect404(requireMember(new mongoose.Types.ObjectId(C.id), AB));
    await expect404(requireMember(null, AB));
    await expect404(requireMember(new mongoose.Types.ObjectId(A.id), 'nope'));
    await expect404(requireMember(new mongoose.Types.ObjectId(A.id), { $ne: null }));
    await expect404(requireMember(new mongoose.Types.ObjectId(A.id), new mongoose.Types.ObjectId().toString()));
  });

  it('archived/ended spaces are readable but not writable', async () => {
    for (const status of ['archived', 'ended']) {
      await Relationship.updateOne({ _id: AB }, { $set: { status } });
      await expect(requireMember(new mongoose.Types.ObjectId(B.id), AB)).resolves.toBeTruthy();
      await expect(requireMember(new mongoose.Types.ObjectId(B.id), AB, { write: true })).rejects.toMatchObject({ status: 403 });
    }
    await Relationship.updateOne({ _id: AB }, { $set: { status: 'active' } });
  });

  it('a participant who left loses access', async () => {
    await Relationship.updateOne({ _id: AB, 'participants.userId': B.id }, { $set: { 'participants.$.status': 'left' } });
    await expect404(requireMember(new mongoose.Types.ObjectId(B.id), AB));
    await Relationship.updateOne({ _id: AB, 'participants.userId': B.id }, { $set: { 'participants.$.status': 'active' } });
  });
});

describe('scoped()', () => {
  it('always pins relationshipId, even if the caller filter tries to override it', async () => {
    const other = await registerUser(t, 'Dot');
    const AD = (await createSpace(A, other)).id;
    const m = await sendMessage(A, AD, 'in AD');
    const ctx = await requireMember(new mongoose.Types.ObjectId(A.id), AB);
    const s = scoped(Message, ctx);
    expect(await s.byId(m.id)).toBeNull();
    expect(await s.findOne({ _id: m.id, relationshipId: AD })).toBeNull();
    expect(await s.count({ relationshipId: AD })).toBe(0);
  });
});
