import { fileTypeFromBuffer } from 'file-type';
import { LocalDiskStorage } from './local.js';
import { S3Storage } from './s3.js';
import { GridFsStorage } from './gridfs.js';

const DRIVERS = { local: LocalDiskStorage, s3: S3Storage, mongo: GridFsStorage };

export async function createStorage(config) {
  const storage = new DRIVERS[config.storage.driver](config);
  await storage.init();
  return storage;
}

// Container "families": a voice note declared audio/webm is detected as video/webm, etc.
const FAMILY = {
  'video/webm': 'webm',
  'audio/webm': 'webm',
  'video/mp4': 'isobmff',
  'audio/mp4': 'isobmff',
  'audio/x-m4a': 'isobmff',
  'audio/m4a': 'isobmff',
  'video/quicktime': 'isobmff',
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'video/ogg': 'ogg',
  'application/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/vnd.wave': 'wav',
  'audio/mpeg': 'mp3',
  'image/heic': 'heif',
  'image/heif': 'heif',
  'image/heic-sequence': 'heif',
};

/** Checks the real file signature ("magic bytes") against the declared MIME type. */
export async function contentMatchesDeclaredType(head, declaredMime) {
  const detected = await fileTypeFromBuffer(head);
  if (!detected) return false;
  if (detected.mime === declaredMime) return true;
  const family = FAMILY[declaredMime];
  return Boolean(family) && FAMILY[detected.mime] === family;
}
