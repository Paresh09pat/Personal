import mongoose from 'mongoose';
import {
  INVITATION_STATUS,
  MAX_DIRECT_PARTICIPANTS,
  MAX_GROUP_PARTICIPANTS,
  PARTICIPANT_ROLE,
  PARTICIPANT_STATUS,
  RELATIONSHIP_STATUS,
  SPACE_KIND,
} from '@olw/shared';

const { Schema, Types } = mongoose;

const participantSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: Object.values(PARTICIPANT_ROLE), required: true },
    status: {
      type: String,
      enum: Object.values(PARTICIPANT_STATUS),
      default: PARTICIPANT_STATUS.ACTIVE,
    },
    joinedAt: { type: Date, default: Date.now },
    leftAt: { type: Date, default: null },
    displayName: { type: String, trim: true, default: '' },
    avatarAttachmentId: { type: Types.ObjectId, default: null },
    lastReadAt: { type: Date, default: null },
    lastReadMessageId: { type: Types.ObjectId, default: null },
    notificationPrefs: {
      muted: { type: Boolean, default: false },
      messages: { type: Boolean, default: true },
      activity: { type: Boolean, default: true },
      calls: { type: Boolean, default: true },
    },
  },
  { _id: false },
);

const relationshipSchema = new Schema(
  {
    status: {
      type: String,
      enum: Object.values(RELATIONSHIP_STATUS),
      default: RELATIONSHIP_STATUS.PENDING,
    },
    /** 'direct' = the original two-person space. Documents written before groups existed have no kind. */
    kind: { type: String, enum: Object.values(SPACE_KIND), default: SPACE_KIND.DIRECT },
    participants: {
      type: [participantSchema],
      validate: {
        // Not an arrow function: `this` is the space, so the cap depends on its kind.
        validator(list) {
          const active = list.filter((p) => p.status === PARTICIPANT_STATUS.ACTIVE).length;
          if (this.kind === SPACE_KIND.GROUP) return active <= MAX_GROUP_PARTICIPANTS;
          return active <= MAX_DIRECT_PARTICIPANTS && list.length <= MAX_DIRECT_PARTICIPANTS;
        },
        message: 'This space is full',
      },
    },
    createdBy: { type: Types.ObjectId, ref: 'User', required: true },
    title: { type: String, trim: true, default: '' },
    coverAttachmentId: { type: Types.ObjectId, default: null },
    anniversaryDate: { type: Date, default: null },
    preferences: {
      accent: { type: String, default: 'rose' },
      timezone: { type: String, default: '' },
      showTyping: { type: Boolean, default: true },
      showReadReceipts: { type: Boolean, default: true },
      /** Chat look, shared by both people. */
      theme: { type: String, default: 'classic' },
      themeAnimated: { type: Boolean, default: true },
      wallpaperAttachmentId: { type: Types.ObjectId, default: null },
      wallpaperDim: { type: Number, default: 25 },
      /** New messages vanish this many seconds after being sent. 0 = off. */
      disappearAfterSec: { type: Number, default: 0 },
    },
    /** Sorted "userA:userB" while active/archived; unset when ended so the pair can start over. */
    pairKey: { type: String, default: undefined },
    lastActivityAt: { type: Date, default: Date.now },
    archivedAt: { type: Date, default: null },
    archivedBy: { type: Types.ObjectId, default: null },
    endedAt: { type: Date, default: null },
    endedBy: { type: Types.ObjectId, default: null },
    endReason: { type: String, default: null },
    deletionRequestedBy: { type: [Types.ObjectId], default: [] },
  },
  { timestamps: true, optimisticConcurrency: true },
);
relationshipSchema.index({ 'participants.userId': 1, 'participants.status': 1 });
relationshipSchema.index({ status: 1, lastActivityAt: -1 });
relationshipSchema.index(
  { pairKey: 1 },
  { unique: true, partialFilterExpression: { pairKey: { $type: 'string' } } },
);

const invitationSchema = new Schema(
  {
    relationshipId: { type: Types.ObjectId, ref: 'Relationship', required: true },
    inviterId: { type: Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true },
    inviteeEmail: { type: String, lowercase: true, trim: true, default: null },
    /** Direct invitations are single-use; group links can be used by several people until they expire. */
    kind: { type: String, enum: Object.values(SPACE_KIND), default: SPACE_KIND.DIRECT },
    maxUses: { type: Number, default: 0 },
    usesCount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: Object.values(INVITATION_STATUS),
      default: INVITATION_STATUS.PENDING,
    },
    expiresAt: { type: Date, required: true },
    acceptedBy: { type: Types.ObjectId, default: null },
    acceptedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
invitationSchema.index({ tokenHash: 1 }, { unique: true });
invitationSchema.index({ relationshipId: 1, createdAt: -1 });
// At most one live invitation per space: duplicate invites cannot spawn duplicate joins.
invitationSchema.index(
  { relationshipId: 1 },
  { unique: true, partialFilterExpression: { status: INVITATION_STATUS.PENDING } },
);

export const pairKeyFor = (a, b) => [String(a), String(b)].sort().join(':');

export const Relationship =
  mongoose.models.Relationship ?? mongoose.model('Relationship', relationshipSchema);
export const Invitation = mongoose.models.Invitation ?? mongoose.model('Invitation', invitationSchema);
