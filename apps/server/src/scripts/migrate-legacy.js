/**
 * Migrates data from the old single-couple version (no relationshipId anywhere) into one
 * relationship space. Safe by design:
 *   - dry run unless --apply is passed;
 *   - idempotent (records itself in the `migrations` collection, only touches docs missing relationshipId);
 *   - never deletes anything.
 *
 * Usage:
 *   npm run migrate:legacy                       # dry run: shows what would change
 *   npm run migrate:legacy -- --apply            # do it (auto-detects the two users if exactly two exist)
 *   npm run migrate:legacy -- --apply --users=<ownerId>,<partnerId> --title="Our Little World"
 */
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { PARTICIPANT_ROLE, PARTICIPANT_STATUS, RELATIONSHIP_STATUS } from '@olw/shared';
import { Message, Migration, Relationship, SCOPED_MODELS, User, pairKeyFor } from '../models/index.js';

export const MIGRATION_VERSION = 'legacy-single-relationship-v1';
const MISSING = { relationshipId: { $exists: false } };

export async function migrateLegacy({ apply = false, userIds, title = 'Our Little World', log = console.log } = {}) {
  if (await Migration.exists({ version: MIGRATION_VERSION })) {
    log(`✔ ${MIGRATION_VERSION} already applied — nothing to do.`);
    return { alreadyApplied: true };
  }

  const counts = {};
  for (const Model of SCOPED_MODELS) {
    counts[Model.collection.collectionName] = await Model.collection.countDocuments(MISSING);
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  log('Legacy documents without relationshipId:', counts);
  if (total === 0) {
    log('No legacy data found.');
    if (apply) await Migration.create({ version: MIGRATION_VERSION, details: { counts, total } });
    return { total: 0, counts };
  }

  let users;
  if (userIds?.length === 2) {
    users = await User.find({ _id: { $in: userIds } }).sort({ createdAt: 1 });
  } else {
    users = await User.find({ deletedAt: null }).sort({ createdAt: 1 }).limit(3);
    if (users.length !== 2) {
      throw new Error(`Found ${users.length} users; pass --users=<ownerId>,<partnerId> to pick the legacy couple.`);
    }
  }
  if (users.length !== 2) throw new Error('Both --users must exist.');
  const [owner, partner] = userIds?.length === 2 ? userIds.map((id) => users.find((u) => String(u._id) === id)) : users;
  const pairKey = pairKeyFor(owner._id, partner._id);
  let rel = await Relationship.findOne({ pairKey });
  log(`Legacy couple: ${owner.displayName} (owner) + ${partner.displayName}. Space: ${rel ? `reuse ${rel._id}` : 'create new'}`);

  if (!apply) {
    log('Dry run only. Re-run with --apply to migrate.');
    return { dryRun: true, total, counts };
  }

  if (!rel) {
    rel = await Relationship.create({
      status: RELATIONSHIP_STATUS.ACTIVE,
      createdBy: owner._id,
      title,
      pairKey,
      participants: [
        { userId: owner._id, role: PARTICIPANT_ROLE.OWNER, status: PARTICIPANT_STATUS.ACTIVE },
        { userId: partner._id, role: PARTICIPANT_ROLE.PARTNER, status: PARTICIPANT_STATUS.ACTIVE },
      ],
    });
  }

  // Messages need a clientId for the idempotency index; derive a stable one from the legacy _id.
  await Message.collection.updateMany({ ...MISSING, clientId: { $exists: false } }, [
    { $set: { clientId: { $concat: ['legacy-', { $toString: '$_id' }] } } },
  ]);
  const updated = {};
  for (const Model of SCOPED_MODELS) {
    const res = await Model.collection.updateMany(MISSING, { $set: { relationshipId: rel._id } });
    updated[Model.collection.collectionName] = res.modifiedCount;
  }
  await Migration.create({ version: MIGRATION_VERSION, details: { relationshipId: rel._id, updated } });
  log('✔ Migrated:', updated, `→ relationship ${rel._id}`);
  return { relationshipId: String(rel._id), updated, total };
}

async function cli() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, ...v] = a.replace(/^--/, '').split('=');
      return [k, v.length ? v.join('=') : true];
    }),
  );
  const { loadConfig } = await import('../config/env.js');
  const { connectDb, disconnectDb } = await import('../db/connect.js');
  const config = loadConfig();
  await connectDb(config);
  try {
    await migrateLegacy({
      apply: Boolean(args.apply),
      userIds: typeof args.users === 'string' ? args.users.split(',') : undefined,
      title: typeof args.title === 'string' ? args.title : undefined,
    });
  } finally {
    await disconnectDb();
    await mongoose.disconnect().catch(() => {});
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  cli().catch((err) => {
    console.error('Migration failed:', err.message);
    process.exit(1);
  });
}
