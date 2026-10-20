import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');

const DEV_SECRET = 'dev-only-insecure-secret-change-me-0000000000';

const bool = (fallback) =>
  z
    .enum(['true', 'false', '1', '0', 'yes', 'no'])
    .optional()
    .transform((v) => (v === undefined ? fallback : ['true', '1', 'yes'].includes(v)));

const csv = (fallback) =>
  z
    .string()
    .optional()
    .transform((v) =>
      (v ?? fallback)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  APP_ORIGIN: z.string().url().default('http://localhost:3000'),
  MONGODB_URI: z.string().optional(),
  MONGO_DATA_DIR: z.string().default('.data/mongo'),
  MONGO_DEV_PORT: z.coerce.number().int().default(27027),
  SESSION_SECRET: z.string().min(16).default(DEV_SECRET),
  MEDIA_SIGNING_SECRET: z.string().min(16).default(DEV_SECRET),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  UPLOAD_DIR: z.string().default('.data/uploads'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool(false),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: bool(false),
  EMAIL_FROM: z.string().default('Our Little World <no-reply@localhost>'),
  EMAIL_VERIFICATION: z.enum(['auto', 'required', 'off']).default('auto'),
  REGISTRATION_MODE: z.enum(['open', 'invite_only']).optional(),
  SPACE_CREATION: z.enum(['admin_only', 'everyone']).default('admin_only'),
  STUN_URLS: csv('stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302'),
  TURN_URL: z.string().optional(),
  TURN_USERNAME: z.string().optional(),
  TURN_CREDENTIAL: z.string().optional(),
  TRUST_PROXY: z.string().optional(),
  SERVE_WEB: bool(true),
  INVITE_TTL_HOURS: z.coerce.number().int().min(1).max(336).default(72),
  RATE_LIMIT: bool(true),
});

function loadDotEnv() {
  const file = path.join(REPO_ROOT, '.env');
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

/**
 * Build the runtime config. `overrides` lets tests run against the real app with tweaks
 * (e.g. no web server, low rate limits) without touching process.env.
 */
export function loadConfig(overrides = {}) {
  if (!overrides.skipDotEnv) loadDotEnv();
  const parsed = schema.safeParse({ ...process.env, ...overrides.env });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const e = parsed.data;
  const isProd = e.NODE_ENV === 'production';
  const smtpConfigured = Boolean(e.SMTP_HOST);

  const config = {
    env: e.NODE_ENV,
    isProd,
    isTest: e.NODE_ENV === 'test',
    port: e.PORT,
    host: e.HOST,
    appOrigin: e.APP_ORIGIN.replace(/\/$/, ''),
    mongo: {
      uri: e.MONGODB_URI,
      dataDir: path.resolve(REPO_ROOT, e.MONGO_DATA_DIR),
      // The persisted replica-set config remembers host:port, so the local dev DB needs a stable port.
      devPort: e.MONGO_DEV_PORT,
    },
    secrets: { session: e.SESSION_SECRET, media: e.MEDIA_SIGNING_SECRET },
    storage: {
      driver: e.STORAGE_DRIVER,
      uploadDir: path.resolve(REPO_ROOT, e.UPLOAD_DIR),
      s3: {
        bucket: e.S3_BUCKET,
        region: e.S3_REGION,
        endpoint: e.S3_ENDPOINT,
        accessKeyId: e.S3_ACCESS_KEY_ID,
        secretAccessKey: e.S3_SECRET_ACCESS_KEY,
        forcePathStyle: e.S3_FORCE_PATH_STYLE,
      },
    },
    email: {
      smtp: smtpConfigured
        ? {
            host: e.SMTP_HOST,
            port: e.SMTP_PORT,
            secure: e.SMTP_SECURE,
            auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASS } : undefined,
          }
        : null,
      from: e.EMAIL_FROM,
      requireVerification:
        e.EMAIL_VERIFICATION === 'required' || (e.EMAIL_VERIFICATION === 'auto' && smtpConfigured),
    },
    registrationMode: e.REGISTRATION_MODE ?? (isProd ? 'invite_only' : 'open'),
    spaceCreation: e.SPACE_CREATION,
    ice: {
      stun: e.STUN_URLS,
      turn: e.TURN_URL
        ? { urls: e.TURN_URL, username: e.TURN_USERNAME, credential: e.TURN_CREDENTIAL }
        : null,
    },
    trustProxy: e.TRUST_PROXY ?? (isProd ? '1' : 'loopback'),
    serveWeb: e.SERVE_WEB,
    inviteTtlHours: e.INVITE_TTL_HOURS,
    rateLimit: { enabled: e.RATE_LIMIT, ...overrides.rateLimit },
    ...overrides.config,
  };

  if (isProd) assertProductionSafe(config);
  return config;
}

function assertProductionSafe(config) {
  const problems = [];
  if (!config.mongo.uri) problems.push('MONGODB_URI is required in production (e.g. MongoDB Atlas).');
  for (const [name, value] of Object.entries(config.secrets)) {
    if (value === DEV_SECRET || value.length < 32) {
      problems.push(`${name.toUpperCase()} secret must be set to a random value of 32+ characters.`);
    }
  }
  if (!config.appOrigin.startsWith('https://') && !config.appOrigin.includes('localhost')) {
    problems.push('APP_ORIGIN must be an https:// URL in production.');
  }
  if (config.storage.driver === 's3' && !config.storage.s3.bucket) {
    problems.push('S3_BUCKET is required when STORAGE_DRIVER=s3.');
  }
  if (problems.length) {
    throw new Error(`Refusing to start in production:\n  - ${problems.join('\n  - ')}`);
  }
}
