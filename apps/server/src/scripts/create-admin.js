/**
 * Creates the site owner (admin) account, or promotes an existing account to admin.
 *
 *   npm run create-admin -- --email=you@example.com --username=you --name="Your Name" --password="a long passphrase"
 *   npm run create-admin -- --email=you@example.com            # promote an existing account
 *
 * If --password is omitted for a NEW account, a strong one is generated and printed once.
 * (On a fresh install you can also just register: the first account automatically becomes admin.)
 */
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { LIMITS, emailSchema, usernameSchema } from '@olw/shared';
import { User } from '../models/index.js';
import { hashPassword } from '../auth/password.js';

export async function createAdmin({ email, username, displayName, password }) {
  const normalizedEmail = emailSchema.parse(email);
  const existing = await User.findOne({ email: normalizedEmail, deletedAt: null });
  if (existing) {
    existing.role = 'admin';
    if (password) existing.passwordHash = await hashPassword(password);
    await existing.save();
    return { user: existing, created: false, generatedPassword: null };
  }
  if (!username || !displayName) throw new Error('A new admin needs --username and --name');
  const generatedPassword = password ? null : crypto.randomBytes(12).toString('base64url');
  const finalPassword = password ?? generatedPassword;
  if (finalPassword.length < LIMITS.password.min) {
    throw new Error(`Password must be at least ${LIMITS.password.min} characters`);
  }
  const user = await User.create({
    email: normalizedEmail,
    username: usernameSchema.parse(username),
    displayName: displayName.trim(),
    role: 'admin',
    emailVerifiedAt: new Date(),
    onboardedAt: null,
    passwordHash: await hashPassword(finalPassword),
  });
  return { user, created: true, generatedPassword };
}

async function cli() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, ...v] = a.replace(/^--/, '').split('=');
      return [k, v.join('=')];
    }),
  );
  if (!args.email) throw new Error('Usage: npm run create-admin -- --email=… [--username=… --name=… --password=…]');
  const { loadConfig } = await import('../config/env.js');
  const { connectDb, disconnectDb } = await import('../db/connect.js');
  await connectDb(loadConfig());
  try {
    const { user, created, generatedPassword } = await createAdmin({
      email: args.email,
      username: args.username,
      displayName: args.name,
      password: args.password || undefined,
    });
    console.log(`\n✔ ${created ? 'Created' : 'Promoted'} admin: ${user.displayName} <${user.email}> (username: ${user.username})`);
    if (generatedPassword) console.log(`  Password: ${generatedPassword}   ← save it now, it is not stored anywhere in plain text\n`);
  } finally {
    await disconnectDb();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  cli().catch((err) => {
    console.error('create-admin failed:', err.message);
    process.exit(1);
  });
}
