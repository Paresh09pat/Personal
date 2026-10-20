import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import mongoose from 'mongoose';
import { HttpError } from '../lib/errors.js';
import { LocalDiskStorage } from './local.js';

/**
 * Private files stored inside MongoDB (GridFS). Use it on hosts whose disk is wiped on restart
 * (e.g. Render free) when you don't want an S3 bucket. Uses the same signed, user-bound,
 * re-authorized URLs as the local driver — only where the bytes live differs.
 * Mind the database size limit (Atlas free M0 ≈ 512 MB in total).
 */
export class GridFsStorage extends LocalDiskStorage {
  constructor(config) {
    super(config);
    this.kind = 'mongo';
  }

  async init() {
    if (!mongoose.connection.db) throw new Error('GridFS storage needs the database connected first');
    this.bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'media' });
    this.files = mongoose.connection.db.collection('media.files');
  }

  checkKey(key) {
    if (!/^[a-f0-9-]{36}$/.test(key)) throw new HttpError(400, 'Bad storage key');
  }

  async write(key, stream, maxBytes) {
    this.checkKey(key);
    await this.delete(key); // a retried upload replaces any partial earlier attempt
    let bytes = 0;
    const limiter = new Transform({
      transform(chunk, _enc, cb) {
        bytes += chunk.length;
        if (bytes > maxBytes) cb(new HttpError(413, 'File is larger than declared'));
        else cb(null, chunk);
      },
    });
    const upload = this.bucket.openUploadStream(key);
    try {
      await pipeline(stream, limiter, upload);
    } catch (err) {
      await upload.abort().catch(() => {});
      await this.delete(key);
      throw err;
    }
    return bytes;
  }

  async stat(key) {
    this.checkKey(key);
    const file = await this.files.findOne({ filename: key }, { sort: { uploadDate: -1 } });
    return file ? { size: file.length } : null;
  }

  async readHead(key, bytes = 4100) {
    const stat = await this.stat(key);
    if (!stat || stat.size === 0) return Buffer.alloc(0);
    const chunks = [];
    for await (const c of this.bucket.openDownloadStreamByName(key, { start: 0, end: Math.min(bytes, stat.size) })) {
      chunks.push(c);
    }
    return Buffer.concat(chunks);
  }

  async delete(key) {
    this.checkKey(key);
    const files = await this.files.find({ filename: key }, { projection: { _id: 1 } }).toArray();
    for (const f of files) await this.bucket.delete(f._id).catch(() => {});
  }

  /** Streams from the database with HTTP Range support (so videos and voice notes can seek). */
  async send(res, attachment) {
    const stat = await this.stat(attachment.storageKey);
    if (!stat) throw new HttpError(404, 'Not found');
    const size = stat.size;
    res.set({
      'Content-Type': attachment.mime,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Accept-Ranges': 'bytes',
      'Content-Disposition': `inline; filename="${encodeURIComponent(attachment.fileName)}"`,
    });

    let start = 0;
    let end = size - 1;
    const range = /^bytes=(\d*)-(\d*)$/.exec(res.req?.headers?.range ?? '');
    if (range && size > 0) {
      if (range[1] === '') {
        start = Math.max(0, size - Number(range[2]));
      } else {
        start = Number(range[1]);
        if (range[2] !== '') end = Math.min(Number(range[2]), size - 1);
      }
      if (start > end || start >= size) {
        res.status(416).set('Content-Range', `bytes */${size}`).end();
        return;
      }
      res.status(206).set('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    res.set('Content-Length', String(size === 0 ? 0 : end - start + 1));
    if (size === 0) return void res.end();
    await pipeline(this.bucket.openDownloadStreamByName(attachment.storageKey, { start, end: end + 1 }), res);
  }
}
