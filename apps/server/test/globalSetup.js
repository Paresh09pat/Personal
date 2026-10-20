import { MongoMemoryReplSet } from 'mongodb-memory-server-core';

/** One real MongoDB replica set (transactions work) shared by all test files; each file gets its own DB. */
export default async function setup(project) {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [{ launchTimeout: 120_000 }],
  });
  project.provide('mongoUri', replSet.getUri());
  return async () => {
    await replSet.stop();
  };
}
