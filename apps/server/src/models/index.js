import mongoose from 'mongoose';
import {
  Album,
  Attachment,
  CallRecord,
  Letter,
  LoveNote,
  Memory,
  Message,
  Milestone,
  Notification,
  Surprise,
} from './content.js';

export * from './user.js';
export * from './relationship.js';
export * from './content.js';

const migrationSchema = new mongoose.Schema(
  { version: { type: String, required: true, unique: true }, details: Object },
  { timestamps: true },
);
export const Migration = mongoose.models.Migration ?? mongoose.model('Migration', migrationSchema);

/** Every collection whose documents belong to exactly one relationship space. */
export const SCOPED_MODELS = [
  Message,
  Attachment,
  Album,
  Memory,
  LoveNote,
  Letter,
  Surprise,
  Milestone,
  CallRecord,
  Notification,
];
