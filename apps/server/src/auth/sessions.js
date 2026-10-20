import { parseCookie } from 'cookie';
import { SESSION_COOKIE } from '@olw/shared';
import { Session, User } from '../models/index.js';
import { hmac, randomToken } from '../lib/crypto.js';
import { unauthenticated } from '../lib/errors.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ROLL_AFTER_MS = 60 * 60 * 1000;

const cookieOptions = (config) => ({
  httpOnly: true,
  secure: config.isProd,
  sameSite: 'lax',
  path: '/',
  maxAge: SESSION_TTL_MS,
});

const hashSessionToken = (config, token) => hmac(config.secrets.session, token);

export async function createSession(config, req, res, user) {
  const token = randomToken(32);
  await Session.create({
    tokenHash: hashSessionToken(config, token),
    userId: user._id,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    ip: req.ip,
    userAgent: String(req.get('user-agent') ?? '').slice(0, 300),
  });
  res.cookie(SESSION_COOKIE, token, cookieOptions(config));
}

export function clearSessionCookie(config, res) {
  const { maxAge: _maxAge, ...opts } = cookieOptions(config);
  res.clearCookie(SESSION_COOKIE, opts);
}

/** Resolves a raw session token to { session, user } or null. Shared by HTTP and Socket.IO. */
export async function resolveSession(config, token) {
  if (!token || typeof token !== 'string' || token.length > 200) return null;
  const session = await Session.findOne({
    tokenHash: hashSessionToken(config, token),
    expiresAt: { $gt: new Date() },
  });
  if (!session) return null;
  const user = await User.findOne({ _id: session.userId, deletedAt: null });
  if (!user) return null;
  return { session, user };
}

export async function resolveSessionFromCookieHeader(config, cookieHeader) {
  if (!cookieHeader) return null;
  return resolveSession(config, parseCookie(cookieHeader)[SESSION_COOKIE]);
}

/** Express middleware: attaches req.user / req.authSession when a valid session cookie is present. */
export function authenticate(config) {
  return async (req, res, next) => {
    const token = req.cookies?.[SESSION_COOKIE];
    const found = await resolveSession(config, token);
    if (found) {
      req.user = found.user;
      req.authSession = found.session;
      if (Date.now() - found.session.lastSeenAt.getTime() > ROLL_AFTER_MS) {
        found.session.lastSeenAt = new Date();
        found.session.expiresAt = new Date(Date.now() + SESSION_TTL_MS);
        await found.session.save();
        res.cookie(SESSION_COOKIE, token, cookieOptions(config));
      }
    }
    next();
  };
}

export function requireAuth() {
  return (req, _res, next) => {
    if (!req.user) throw unauthenticated();
    next();
  };
}

export function revokeAllSessions(userId, { except } = {}) {
  const filter = { userId };
  if (except) filter._id = { $ne: except };
  return Session.deleteMany(filter);
}
