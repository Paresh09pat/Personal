import mongoose from 'mongoose';
import {
  ATTACHMENT_KINDS,
  ATTACHMENT_PURPOSES,
  MESSAGE_TYPES,
  SURPRISE_STATUS,
} from '@olw/shared';

const { Schema, Types } = mongoose;

/**
 * Every relationship-scoped collection is built through this helper so it always carries a
 * required, indexed `relationshipId` plus the `relationshipId + createdAt` pagination index.
 */
function scopedSchema(definition) {
  const schema = new Schema(
    {
      relationshipId: { type: Types.ObjectId, ref: 'Relationship', required: true, immutable: true },
      ...definition,
    },
    { timestamps: true },
  );
  schema.index({ relationshipId: 1, createdAt: -1, _id: -1 });
  return schema;
}

const model = (name, schema) => mongoose.models[name] ?? mongoose.model(name, schema);

// ── Messages ─────────────────────────────────────────────────────────────
const messageSchema = scopedSchema({
  senderId: { type: Types.ObjectId, ref: 'User', required: true, immutable: true },
  clientId: { type: String, required: true },
  type: { type: String, enum: MESSAGE_TYPES, default: 'text' },
  body: { type: String, default: '' },
  attachmentIds: { type: [Types.ObjectId], default: [] },
  replyToId: { type: Types.ObjectId, default: null },
  reactions: {
    type: [new Schema({ userId: Types.ObjectId, emoji: String }, { _id: false })],
    default: [],
  },
  editedAt: { type: Date, default: null },
  deletedAt: { type: Date, default: null },
});
messageSchema.index({ relationshipId: 1, _id: 1 });
messageSchema.index({ relationshipId: 1, senderId: 1, clientId: 1 }, { unique: true });

// ── Attachments (private media) ──────────────────────────────────────────
const attachmentSchema = scopedSchema({
  uploaderId: { type: Types.ObjectId, ref: 'User', required: true, immutable: true },
  storageKey: { type: String, required: true, immutable: true },
  fileName: { type: String, default: 'file' },
  mime: { type: String, required: true },
  size: { type: Number, required: true },
  kind: { type: String, enum: ATTACHMENT_KINDS, required: true },
  purpose: { type: String, enum: ATTACHMENT_PURPOSES, default: 'message' },
  status: { type: String, enum: ['pending', 'ready'], default: 'pending' },
  /** When set, only this user may view the file (e.g. media inside an unpublished surprise). */
  restrictedTo: { type: Types.ObjectId, default: null },
  durationMs: { type: Number, default: null },
  inGallery: { type: Boolean, default: false },
});
attachmentSchema.index({ storageKey: 1 }, { unique: true });
attachmentSchema.index({ relationshipId: 1, kind: 1, createdAt: -1 });
attachmentSchema.index({ relationshipId: 1, status: 1 });
attachmentSchema.index({ status: 1, createdAt: 1 });

const albumSchema = scopedSchema({
  createdBy: { type: Types.ObjectId, required: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  coverAttachmentId: { type: Types.ObjectId, default: null },
  attachmentIds: { type: [Types.ObjectId], default: [] },
});

const memorySchema = scopedSchema({
  authorId: { type: Types.ObjectId, required: true },
  title: { type: String, required: true },
  body: { type: String, default: '' },
  date: { type: Date, required: true },
  location: { type: String, default: '' },
  mediaIds: { type: [Types.ObjectId], default: [] },
});
memorySchema.index({ relationshipId: 1, date: -1 });

const loveNoteSchema = scopedSchema({
  authorId: { type: Types.ObjectId, required: true },
  body: { type: String, required: true },
  color: { type: String, default: 'blush' },
  pinned: { type: Boolean, default: false },
});

const letterSchema = scopedSchema({
  authorId: { type: Types.ObjectId, required: true },
  recipientId: { type: Types.ObjectId, required: true },
  title: { type: String, required: true },
  body: { type: String, required: true },
  unlockAt: { type: Date, default: null },
  openedAt: { type: Date, default: null },
});
letterSchema.index({ relationshipId: 1, recipientId: 1, createdAt: -1 });

const surpriseSchema = scopedSchema({
  creatorId: { type: Types.ObjectId, required: true },
  recipientId: { type: Types.ObjectId, required: true },
  title: { type: String, required: true },
  message: { type: String, default: '' },
  mediaIds: { type: [Types.ObjectId], default: [] },
  status: { type: String, enum: Object.values(SURPRISE_STATUS), default: SURPRISE_STATUS.DRAFT },
  revealAt: { type: Date, default: null },
  revealedAt: { type: Date, default: null },
  seenAt: { type: Date, default: null },
});
surpriseSchema.index({ relationshipId: 1, status: 1 });
surpriseSchema.index({ status: 1, revealAt: 1 });

const milestoneSchema = scopedSchema({
  createdBy: { type: Types.ObjectId, required: true },
  title: { type: String, required: true },
  date: { type: Date, required: true },
  recurring: { type: Boolean, default: true },
  emoji: { type: String, default: '💗' },
  note: { type: String, default: '' },
});
milestoneSchema.index({ relationshipId: 1, date: 1 });

const callRecordSchema = scopedSchema({
  callerId: { type: Types.ObjectId, required: true },
  kind: { type: String, enum: ['audio', 'video'], default: 'video' },
  status: {
    type: String,
    enum: ['ringing', 'active', 'ended', 'missed', 'declined'],
    default: 'ringing',
  },
  startedAt: { type: Date, default: null },
  endedAt: { type: Date, default: null },
  endedBy: { type: Types.ObjectId, default: null },
});
callRecordSchema.index({ relationshipId: 1, status: 1 });

const notificationSchema = scopedSchema({
  userId: { type: Types.ObjectId, required: true },
  actorId: { type: Types.ObjectId, default: null },
  type: { type: String, required: true },
  refId: { type: Types.ObjectId, default: null },
  text: { type: String, default: '' },
  readAt: { type: Date, default: null },
});
notificationSchema.index({ userId: 1, relationshipId: 1, readAt: 1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export const Message = model('Message', messageSchema);
export const Attachment = model('Attachment', attachmentSchema);
export const Album = model('Album', albumSchema);
export const Memory = model('Memory', memorySchema);
export const LoveNote = model('LoveNote', loveNoteSchema);
export const Letter = model('Letter', letterSchema);
export const Surprise = model('Surprise', surpriseSchema);
export const Milestone = model('Milestone', milestoneSchema);
export const CallRecord = model('CallRecord', callRecordSchema);
export const Notification = model('Notification', notificationSchema);
