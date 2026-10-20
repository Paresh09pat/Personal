import fs from 'node:fs';
import mongoose from 'mongoose';
import '../models/index.js';

// Unknown filter keys are dropped. Untrusted input never reaches a filter un-parsed: every value is
// validated by zod / toObjectId() first, so operator injection ({ $ne: … }) is impossible.
mongoose.set('strictQuery', true);

let memoryServer = null;

/**
 * Connects to MONGODB_URI when provided; otherwise starts a local single-node replica set
 * (transactions supported) whose data persists in `.data/mongo`. No install or account needed.
 */
export async function connectDb(config, { dbName } = {}) {
  let uri = config.mongo.uri;
  if (!uri) {
    if (config.isProd) throw new Error('MONGODB_URI is required in production');
    const { MongoMemoryReplSet } = await import('mongodb-memory-server-core');
    fs.mkdirSync(config.mongo.dataDir, { recursive: true });
    console.log('[db] starting local MongoDB (first run downloads the binary once)…');
    memoryServer = await MongoMemoryReplSet.create({
      replSet: { count: 1, name: 'olw-dev', storageEngine: 'wiredTiger' },
      instanceOpts: [{ dbPath: config.mongo.dataDir, port: config.mongo.devPort, launchTimeout: 120_000 }],
    });
    uri = memoryServer.getUri();
    console.log(`[db] local MongoDB ready, data in ${config.mongo.dataDir}`);
  }
  await mongoose.connect(uri, { dbName: dbName ?? 'our_little_world', autoIndex: true });
  await syncIndexes();
  return mongoose.connection;
}

export async function syncIndexes() {
  await Promise.all(Object.values(mongoose.models).map((m) => m.createIndexes()));
}

export async function disconnectDb() {
  await mongoose.disconnect();
  if (memoryServer) {
    await memoryServer.stop({ doCleanup: false });
    memoryServer = null;
  }
}
