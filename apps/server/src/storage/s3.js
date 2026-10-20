import crypto from 'node:crypto';

/**
 * S3-compatible private bucket (AWS S3, Cloudflare R2, Backblaze B2, MinIO). The bucket must NOT be
 * public. Uploads and downloads use presigned URLs that expire in minutes; the server only issues
 * them after re-checking relationship membership.
 */
export class S3Storage {
  constructor(config) {
    this.kind = 's3';
    this.cfg = config.storage.s3;
  }

  async init() {
    const { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } =
      await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    this.sdk = { GetObjectCommand, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand, getSignedUrl };
    this.client = new S3Client({
      region: this.cfg.region,
      endpoint: this.cfg.endpoint,
      forcePathStyle: this.cfg.forcePathStyle,
      credentials:
        this.cfg.accessKeyId && this.cfg.secretAccessKey
          ? { accessKeyId: this.cfg.accessKeyId, secretAccessKey: this.cfg.secretAccessKey }
          : undefined,
    });
  }

  newKey() {
    return crypto.randomUUID();
  }

  async createUploadTarget({ attachment, ttlMs = 10 * 60 * 1000 }) {
    const cmd = new this.sdk.PutObjectCommand({
      Bucket: this.cfg.bucket,
      Key: attachment.storageKey,
      ContentType: attachment.mime,
      ContentLength: attachment.size,
    });
    const url = await this.sdk.getSignedUrl(this.client, cmd, { expiresIn: Math.floor(ttlMs / 1000) });
    return { method: 'PUT', url, headers: { 'Content-Type': attachment.mime }, sameOrigin: false };
  }

  async createDownloadUrl({ attachment, ttlMs = 5 * 60 * 1000 }) {
    const cmd = new this.sdk.GetObjectCommand({
      Bucket: this.cfg.bucket,
      Key: attachment.storageKey,
      ResponseContentType: attachment.mime,
      ResponseCacheControl: 'private, no-store',
      ResponseContentDisposition: `inline; filename="${encodeURIComponent(attachment.fileName)}"`,
    });
    const url = await this.sdk.getSignedUrl(this.client, cmd, { expiresIn: Math.floor(ttlMs / 1000) });
    return { url, expiresAt: new Date(Date.now() + ttlMs) };
  }

  async stat(key) {
    try {
      const head = await this.client.send(new this.sdk.HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      return { size: head.ContentLength };
    } catch {
      return null;
    }
  }

  async readHead(key, bytes = 4100) {
    const obj = await this.client.send(
      new this.sdk.GetObjectCommand({ Bucket: this.cfg.bucket, Key: key, Range: `bytes=0-${bytes - 1}` }),
    );
    return Buffer.from(await obj.Body.transformToByteArray());
  }

  async delete(key) {
    await this.client.send(new this.sdk.DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }

  /** Content requests are authorised by the server, then redirected to a fresh 5-minute URL. */
  async send(res, attachment) {
    const { url } = await this.createDownloadUrl({ attachment, ttlMs: 5 * 60 * 1000 });
    res.set('Cache-Control', 'private, no-store');
    res.redirect(302, url);
  }
}
