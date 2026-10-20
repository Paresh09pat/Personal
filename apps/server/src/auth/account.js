import { PARTICIPANT_STATUS, SURPRISE_STATUS } from '@olw/shared';
import { Attachment, AuthToken, Relationship, Session, Surprise, User } from '../models/index.js';
import { buildContext } from '../authz/relationship.js';
import { leaveForAccountDeletion } from '../relationships/lifecycle.js';
import { HttpError } from '../lib/errors.js';
import { randomToken } from '../lib/crypto.js';
import { hashPassword, verifyPassword } from './password.js';

export async function verifyDestructiveConfirmation(userId, { password, confirm }, phrase = 'DELETE') {
  if (confirm !== phrase) {
    throw new HttpError(422, `Type ${phrase} to confirm`, { code: 'confirm_required' });
  }
  const user = await User.findOne({ _id: userId }).select('+passwordHash');
  if (!user || !(await verifyPassword(user.passwordHash, password))) {
    throw new HttpError(400, 'Password is incorrect', { code: 'bad_password' });
  }
}

/** Implements "Deleting a personal account" from docs/DATA-RETENTION.md. */
export async function deleteAccount({ user, input, hub, storage }) {
  await verifyDestructiveConfirmation(user._id, input);
  const deps = { hub, storage };

  // 1. Private, unshared content: unpublished surprises and their private media.
  const unpublished = await Surprise.find({ creatorId: user._id, status: { $ne: SURPRISE_STATUS.REVEALED } });
  await Surprise.deleteMany({ _id: { $in: unpublished.map((s) => s._id) } });
  const privateFiles = await Attachment.find({ restrictedTo: user._id });
  for (const f of privateFiles) await storage.delete(f.storageKey).catch(() => {});
  await Attachment.deleteMany({ _id: { $in: privateFiles.map((f) => f._id) } });

  // 2. Spaces: pending → deleted; active/archived → ended; user marked as left + agreed to deletion.
  const rels = await Relationship.find({
    participants: { $elemMatch: { userId: user._id, status: PARTICIPANT_STATUS.ACTIVE } },
  });
  for (const rel of rels) {
    await leaveForAccountDeletion(buildContext(rel, user._id), deps);
    await hub.evictFromRelationship(rel._id, { userIds: [user._id] });
  }

  // 3. Anonymise the profile and kill every session/token.
  const anon = `deleted_${user._id}`;
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        email: `${anon}@deleted.invalid`,
        username: anon,
        displayName: 'Deleted user',
        passwordHash: await hashPassword(randomToken(32)),
        emailVerifiedAt: null,
        deletedAt: new Date(),
      },
    },
  );
  await Session.deleteMany({ userId: user._id });
  await AuthToken.deleteMany({ userId: user._id });
}
