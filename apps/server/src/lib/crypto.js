import crypto from 'node:crypto';

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export const hmac = (secret, value) =>
  crypto.createHmac('sha256', secret).update(value).digest('base64url');

export function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/**
 * Compact signed token: base64url(JSON payload) + "." + HMAC. Used for media URLs and call tokens.
 * Payload always carries `exp` (ms epoch) and a `typ` so one kind of token can't be replayed as another.
 */
export function signToken(secret, typ, payload, ttlMs) {
  const body = Buffer.from(JSON.stringify({ ...payload, typ, exp: Date.now() + ttlMs })).toString(
    'base64url',
  );
  return `${body}.${hmac(secret, `${typ}.${body}`)}`;
}

export function verifyToken(secret, typ, token) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  if (!safeEqual(sig, hmac(secret, `${typ}.${body}`))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.typ !== typ || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
