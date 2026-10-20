import express from 'express';
import {
  changePasswordSchema,
  confirmDestructiveSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  tokenSchema,
  updateProfileSchema,
} from '@olw/shared';
import { AuthToken, Session, User } from '../models/index.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { HttpError, conflict, unauthenticated } from '../lib/errors.js';
import { parse, parsePatch, toObjectId } from '../lib/validate.js';
import { publicUser } from '../lib/serialize.js';
import { templates } from '../email/mailer.js';
import { findValidInvitation } from '../invitations/service.js';
import { hashPassword, verifyDummy, verifyPassword } from './password.js';
import {
  clearSessionCookie,
  createSession,
  requireAuth,
  revokeAllSessions,
} from './sessions.js';
import { deleteAccount } from './account.js';

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 30 * 60 * 1000;
const MAX_FAILED = 5;
const BASE_LOCK_MS = 15 * 60 * 1000;
const MAX_LOCK_MS = 24 * 60 * 60 * 1000;
const INVALID_LOGIN = 'Invalid email/username or password';

async function issueAuthToken(userId, type, ttlMs) {
  await AuthToken.deleteMany({ userId, type, usedAt: null });
  const token = randomToken(32);
  await AuthToken.create({ userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) });
  return token;
}

/** Atomically consumes a single-use token; returns its document or null. */
function consumeAuthToken(type, token) {
  return AuthToken.findOneAndUpdate(
    { type, tokenHash: sha256(String(token)), usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
    { new: true },
  );
}

export function authRoutes({ config, mailer, limiters, hub, storage }) {
  const router = express.Router();

  const sendVerification = async (user) => {
    const token = await issueAuthToken(user._id, 'verify_email', VERIFY_TTL_MS);
    await mailer.send({ to: user.email, ...templates.verifyEmail(`${config.appOrigin}/verify-email?token=${token}`) });
  };

  const meResponse = (user) => ({
    user: publicUser(user),
    requireVerification: config.email.requireVerification,
  });

  router.get('/config', (_req, res) => {
    res.json({
      registrationMode: config.registrationMode,
      spaceCreation: config.spaceCreation,
      requireVerification: config.email.requireVerification,
      emailProvider: mailer.kind,
    });
  });

  router.post('/register', limiters.register, async (req, res) => {
    const input = parse(registerSchema, req.body);
    // The very first account on a fresh install is the site owner (admin).
    const firstUser = (await User.countDocuments()) === 0;
    if (config.registrationMode === 'invite_only') {
      const invite = input.inviteToken ? await findValidInvitation(input.inviteToken) : null;
      if (!firstUser && !invite) {
        throw new HttpError(403, 'Sign-up is by invitation only. Ask your partner for an invite link.', {
          code: 'invite_only',
        });
      }
    }
    const taken = await User.exists({ $or: [{ email: input.email }, { username: input.username }] });
    if (taken) throw conflict('That email or username is already in use', { code: 'account_exists' });

    const user = await User.create({
      email: input.email,
      username: input.username,
      displayName: input.displayName,
      role: firstUser ? 'admin' : 'member',
      passwordHash: await hashPassword(input.password),
    });
    await sendVerification(user);
    await createSession(config, req, res, user);
    // A new account is standalone: it never grants access to any existing space.
    res.status(201).json(meResponse(user));
  });

  router.post('/login', limiters.loginIp, limiters.loginIdentifier, async (req, res) => {
    const { identifier, password } = parse(loginSchema, req.body);
    const user = await User.findOne({
      $or: [{ email: identifier }, { username: identifier }],
      deletedAt: null,
    }).select('+passwordHash +failedLoginCount +lockUntil');

    if (!user) {
      await verifyDummy(password);
      throw unauthenticated(INVALID_LOGIN);
    }
    if (user.lockUntil && user.lockUntil > new Date()) {
      await verifyDummy(password);
      throw new HttpError(429, 'Too many failed attempts. Try again later or reset your password.', {
        code: 'locked',
      });
    }
    if (!(await verifyPassword(user.passwordHash, password))) {
      const failed = (user.failedLoginCount ?? 0) + 1;
      const update = { failedLoginCount: failed };
      if (failed >= MAX_FAILED) {
        update.lockUntil = new Date(Date.now() + Math.min(BASE_LOCK_MS * 2 ** (failed - MAX_FAILED), MAX_LOCK_MS));
      }
      await User.updateOne({ _id: user._id }, { $set: update });
      throw unauthenticated(INVALID_LOGIN);
    }
    await User.updateOne({ _id: user._id }, { $set: { failedLoginCount: 0, lockUntil: null } });
    await createSession(config, req, res, user);
    res.json(meResponse(user));
  });

  router.post('/logout', async (req, res) => {
    if (req.authSession) await Session.deleteOne({ _id: req.authSession._id });
    clearSessionCookie(config, res);
    res.json({ ok: true });
  });

  router.get('/me', requireAuth(), (req, res) => res.json(meResponse(req.user)));

  router.patch('/me', requireAuth(), async (req, res) => {
    const patch = parsePatch(updateProfileSchema, req.body);
    if (patch.displayName !== undefined) req.user.displayName = patch.displayName;
    if (patch.onboarded) req.user.onboardedAt ??= new Date();
    await req.user.save();
    res.json(meResponse(req.user));
  });

  router.post('/verify-email', limiters.resetPassword, async (req, res) => {
    const { token } = parse(tokenSchema, req.body);
    const doc = await consumeAuthToken('verify_email', token);
    if (!doc) throw new HttpError(400, 'This verification link is invalid or has expired', { code: 'token_invalid' });
    await User.updateOne({ _id: doc.userId, emailVerifiedAt: null }, { $set: { emailVerifiedAt: new Date() } });
    res.json({ ok: true });
  });

  router.post('/resend-verification', requireAuth(), limiters.emailSend, async (req, res) => {
    if (!req.user.emailVerifiedAt) await sendVerification(req.user);
    res.json({ ok: true });
  });

  router.post('/forgot-password', limiters.emailSend, async (req, res) => {
    const { email } = parse(forgotPasswordSchema, req.body);
    const user = await User.findOne({ email, deletedAt: null });
    if (user) {
      const token = await issueAuthToken(user._id, 'reset_password', RESET_TTL_MS);
      await mailer.send({ to: user.email, ...templates.resetPassword(`${config.appOrigin}/reset-password?token=${token}`) });
    }
    // Same answer either way: never reveal whether an account exists.
    res.json({ ok: true, message: 'If that email has an account, a reset link is on its way.' });
  });

  router.post('/reset-password', limiters.resetPassword, async (req, res) => {
    const { token, password } = parse(resetPasswordSchema, req.body);
    const doc = await consumeAuthToken('reset_password', token);
    if (!doc) throw new HttpError(400, 'This reset link is invalid or has expired', { code: 'token_invalid' });
    await User.updateOne(
      { _id: doc.userId },
      { $set: { passwordHash: await hashPassword(password), failedLoginCount: 0, lockUntil: null } },
    );
    await revokeAllSessions(doc.userId);
    clearSessionCookie(config, res);
    res.json({ ok: true });
  });

  router.post('/change-password', requireAuth(), limiters.resetPassword, async (req, res) => {
    const { currentPassword, newPassword } = parse(changePasswordSchema, req.body);
    const user = await User.findOne({ _id: req.user._id }).select('+passwordHash');
    if (!(await verifyPassword(user.passwordHash, currentPassword))) {
      throw new HttpError(400, 'Current password is incorrect', { code: 'bad_password' });
    }
    user.passwordHash = await hashPassword(newPassword);
    await user.save();
    await revokeAllSessions(user._id, { except: req.authSession._id });
    res.json({ ok: true });
  });

  router.get('/sessions', requireAuth(), async (req, res) => {
    const sessions = await Session.find({ userId: req.user._id, expiresAt: { $gt: new Date() } }).sort({
      lastSeenAt: -1,
    });
    res.json({
      sessions: sessions.map((s) => ({
        id: String(s._id),
        current: String(s._id) === String(req.authSession._id),
        userAgent: s.userAgent,
        ip: s.ip,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
      })),
    });
  });

  router.delete('/sessions/:sessionId', requireAuth(), async (req, res) => {
    await Session.deleteOne({ _id: toObjectId(req.params.sessionId), userId: req.user._id });
    res.json({ ok: true });
  });

  router.post('/delete-account', requireAuth(), limiters.destructive, async (req, res) => {
    const input = parse(confirmDestructiveSchema, req.body);
    await deleteAccount({ user: req.user, input, hub, storage });
    clearSessionCookie(config, res);
    res.json({ ok: true });
  });

  return router;
}
