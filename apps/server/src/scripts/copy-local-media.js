/**
 * Copies photos/videos that exist only on THIS computer's disk (uploaded while running locally with
 * STORAGE_DRIVER=local) into the database (GridFS), so a hosted copy that shares the same database
 * (Render with STORAGE_DRIVER=mongo) can show them too.
 *
 *   node src/scripts/copy-local-media.js            # dry run: only reports
 *   node src/scripts/copy-local-media.js --apply    # actually copies
 *
 * Safe to run repeatedly: files already in the database are skipped, nothing is deleted or changed.
 */
import fs from 'node:fs';
import { loadConfig } from '../config/env.js';
import { connectDb, disconnectDb } from '../db/connect.js';
import { Attachment } from '../models/index.js';
import { GridFsStorage } from '../storage/gridfs.js';
import { LocalDiskStorage } from '../storage/local.js';

const apply = process.argv.includes('--apply');

const config = loadConfig({ env: { STORAGE_DRIVER: 'mongo' } });
if (!config.mongo.uri) throw new Error('Set MONGODB_URI (in .env) so there is a shared database to copy into');
await connectDb(config);

const local = new LocalDiskStorage({ ...config, storage: { ...config.storage, driver: 'local' } });
const db = new GridFsStorage(config);
await db.init();

const report = { alreadyInDatabase: 0, copied: 0, wouldCopy: 0, missingEverywhere: 0 };
for (const a of await Attachment.find({ status: 'ready' }, { storageKey: 1, fileName: 1, purpose: 1 })) {
  if (await db.stat(a.storageKey)) {
    report.alreadyInDatabase += 1;
    continue;
  }
  const path = local.filePath(a.storageKey);
  if (!fs.existsSync(path)) {
    report.missingEverywhere += 1;
    console.log(`  missing everywhere: ${a.purpose} ${a.fileName} (${a.storageKey.slice(0, 8)}…)`);
    continue;
  }
  if (!apply) {
    report.wouldCopy += 1;
    console.log(`  would copy: ${a.purpose} ${a.fileName} (${a.storageKey.slice(0, 8)}…)`);
    continue;
  }
  await db.write(a.storageKey, fs.createReadStream(path), fs.statSync(path).size + 1);
  report.copied += 1;
  console.log(`  copied: ${a.purpose} ${a.fileName} (${a.storageKey.slice(0, 8)}…)`);
}
console.log(apply ? 'Done.' : 'Dry run only. Re-run with --apply to copy.', report);
await disconnectDb();
