import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { signToken } from '../lib/crypto.js';
import { HttpError } from '../lib/errors.js';

const KEY_RE = /^[a-f0-9-]{36}$/;

/**
 * Private files on local disk, outside any public/static directory. Files are only reachable through
 * HMAC-signed, short-lived, user-bound URLs that the server re-authorises on every request.
 */
export class LocalDiskStorage {
  constructor(config) {
    this.kind = 'local';
    this.root = config.storage.uploadDir;
    this.secret = config.secrets.media;
  }

  async init() {
    await fsp.mkdir(this.root, { recursive: true });
  }

  newKey() {
    return crypto.randomUUID();
  }

  filePath(key) {
    if (!KEY_RE.test(key)) throw new HttpError(400, 'Bad storage key');
    return path.join(this.root, key);
  }

  createUploadTarget({ attachment, ttlMs = 10 * 60 * 1000 }) {
    const token = signToken(
      this.secret,
      'up',
      { a: String(attachment._id), r: String(attachment.relationshipId), u: String(attachment.uploaderId) },
      ttlMs,
    );
    return { method: 'PUT', url: `/api/media/upload/${token}`, headers: {}, sameOrigin: true };
  }

  createDownloadUrl({ attachment, userId, ttlMs = 5 * 60 * 1000 }) {
    const token = signToken(
      this.secret,
      'dl',
      { a: String(attachment._id), r: String(attachment.relationshipId), u: String(userId) },
      ttlMs,
    );
    return { url: `/api/media/file/${token}`, expiresAt: new Date(Date.now() + ttlMs) };
  }

  /** Streams the request body to disk, aborting if it exceeds `maxBytes`. */
  async write(key, stream, maxBytes) {
    const finalPath = this.filePath(key);
    const tmpPath = `${finalPath}.part`;
    let bytes = 0;
    const limiter = new Transform({
      transform(chunk, _enc, cb) {
        bytes += chunk.length;
        if (bytes > maxBytes) cb(new HttpError(413, 'File is larger than declared'));
        else cb(null, chunk);
      },
    });
    try {
      await pipeline(stream, limiter, fs.createWriteStream(tmpPath, { flags: 'w', mode: 0o600 }));
      await fsp.rename(tmpPath, finalPath);
    } catch (err) {
      await fsp.rm(tmpPath, { force: true });
      throw err;
    }
    return bytes;
  }

  async stat(key) {
    try {
      const s = await fsp.stat(this.filePath(key));
      return { size: s.size };
    } catch {
      return null;
    }
  }

  async readHead(key, bytes = 4100) {
    const handle = await fsp.open(this.filePath(key), 'r');
    try {
      const buf = Buffer.alloc(bytes);
      const { bytesRead } = await handle.read(buf, 0, bytes, 0);
      return buf.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  async delete(key) {
    await fsp.rm(this.filePath(key), { force: true });
  }

  /** Streams the file with range support (video seeking) and private caching headers. */
  send(res, attachment) {
    return new Promise((resolve, reject) => {
      res.sendFile(
        attachment.storageKey,
        {
          root: this.root,
          dotfiles: 'deny',
          headers: {
            'Content-Type': attachment.mime,
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
            'Content-Disposition': `inline; filename="${encodeURIComponent(attachment.fileName)}"`,
          },
        },
        (err) => (err && !res.headersSent ? reject(err) : resolve()),
      );
    });
  }
}
