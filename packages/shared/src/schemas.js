import { z } from 'zod';
import {
  ALLOWED_MIME,
  ATTACHMENT_PURPOSES,
  LIMITS,
  REACTIONS,
  SURPRISE_STATUS,
} from './constants.js';

export const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
const trimmed = (max) => z.string().trim().max(max);
const requiredText = (max) => z.string().trim().min(1).max(max);
const dateInput = z.coerce.date();
const idList = z.array(objectId).max(LIMITS.attachmentsPerItem).default([]);

// ── Auth ──────────────────────────────────────────────────────────────────
export const passwordSchema = z
  .string()
  .min(LIMITS.password.min, `Password must be at least ${LIMITS.password.min} characters`)
  .max(LIMITS.password.max);

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(LIMITS.username.min)
  .max(LIMITS.username.max)
  .regex(/^[a-z0-9_.]+$/, 'Use letters, numbers, dots and underscores only');

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const registerSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  displayName: requiredText(LIMITS.displayName),
  password: passwordSchema,
  inviteToken: z.string().max(200).optional(),
});

export const loginSchema = z.object({
  identifier: z.string().trim().toLowerCase().min(1).max(254),
  password: z.string().min(1).max(LIMITS.password.max),
});

export const tokenSchema = z.object({ token: z.string().min(10).max(200) });
export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({
  token: z.string().min(10).max(200),
  password: passwordSchema,
});
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(LIMITS.password.max),
  newPassword: passwordSchema,
});
export const updateProfileSchema = z.object({
  displayName: requiredText(LIMITS.displayName).optional(),
  onboarded: z.boolean().optional(),
});
export const confirmDestructiveSchema = z.object({
  password: z.string().min(1).max(LIMITS.password.max),
  confirm: z.string().trim(),
});

// ── Relationships ────────────────────────────────────────────────────────
export const createRelationshipSchema = z.object({
  title: trimmed(LIMITS.title).optional(),
  myDisplayName: trimmed(LIMITS.displayName).optional(),
});

export const updateRelationshipSchema = z.object({
  title: trimmed(LIMITS.title).optional(),
  anniversaryDate: dateInput.nullable().optional(),
  coverAttachmentId: objectId.nullable().optional(),
  preferences: z
    .object({
      accent: z.enum(['rose', 'wine', 'lavender', 'gold', 'ocean']).optional(),
      timezone: trimmed(64).optional(),
      showTyping: z.boolean().optional(),
      showReadReceipts: z.boolean().optional(),
    })
    .optional(),
});

export const updateMyParticipantSchema = z.object({
  displayName: trimmed(LIMITS.displayName).optional(),
  avatarAttachmentId: objectId.nullable().optional(),
  notificationPrefs: z
    .object({
      muted: z.boolean().optional(),
      messages: z.boolean().optional(),
      activity: z.boolean().optional(),
      calls: z.boolean().optional(),
    })
    .optional(),
});

export const createInvitationSchema = z.object({
  inviteeEmail: emailSchema.optional(),
  expiresInHours: z.number().int().min(1).max(24 * 14).optional(),
});

// ── Messages ─────────────────────────────────────────────────────────────
export const sendMessageSchema = z
  .object({
    clientId: z.string().trim().min(1).max(64),
    body: trimmed(LIMITS.messageBody).default(''),
    attachmentIds: idList,
    replyToId: objectId.nullable().optional(),
  })
  .refine((m) => m.body.length > 0 || m.attachmentIds.length > 0, {
    message: 'Message is empty',
  });

export const editMessageSchema = z.object({ body: requiredText(LIMITS.messageBody) });
export const reactSchema = z.object({ emoji: z.enum(REACTIONS) });
export const readSchema = z.object({ messageId: objectId });

export const paginationSchema = z.object({
  before: objectId.optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.maxPageSize).default(LIMITS.pageSize),
});

// ── Attachments ──────────────────────────────────────────────────────────
export const uploadIntentSchema = z.object({
  fileName: trimmed(200).default('file'),
  mime: z.enum(Object.keys(ALLOWED_MIME)),
  size: z.number().int().positive(),
  purpose: z.enum(ATTACHMENT_PURPOSES).default('message'),
  durationMs: z.number().int().nonnegative().max(6 * 60 * 60 * 1000).optional(),
});

// ── Albums / memories / notes / letters / surprises / milestones ─────────
export const albumSchema = z.object({
  title: requiredText(LIMITS.title),
  description: trimmed(LIMITS.body).default(''),
  coverAttachmentId: objectId.nullable().optional(),
});
export const albumItemsSchema = z.object({ attachmentIds: z.array(objectId).min(1).max(100) });

export const memorySchema = z.object({
  title: requiredText(LIMITS.title),
  body: trimmed(LIMITS.body).default(''),
  date: dateInput,
  location: trimmed(140).default(''),
  mediaIds: idList,
});

export const loveNoteSchema = z.object({
  body: requiredText(2000),
  color: z.enum(['blush', 'rose', 'cream', 'lavender', 'gold']).default('blush'),
  pinned: z.boolean().default(false),
});

export const letterSchema = z.object({
  title: requiredText(LIMITS.title),
  body: requiredText(LIMITS.body),
  unlockAt: dateInput.nullable().optional(),
});

export const surpriseSchema = z.object({
  title: requiredText(LIMITS.title),
  message: trimmed(LIMITS.body).default(''),
  mediaIds: idList,
  revealAt: dateInput.nullable().optional(),
  status: z.enum([SURPRISE_STATUS.DRAFT, SURPRISE_STATUS.SCHEDULED, SURPRISE_STATUS.REVEALED]).default(
    SURPRISE_STATUS.DRAFT,
  ),
});

export const milestoneSchema = z.object({
  title: requiredText(LIMITS.title),
  date: dateInput,
  recurring: z.boolean().default(true),
  emoji: trimmed(8).default('💗'),
  note: trimmed(1000).default(''),
});

export const startCallSchema = z.object({ kind: z.enum(['audio', 'video']).default('video') });

/** Returns a partial version of an object schema, for PATCH routes. */
export const partial = (schema) => schema.partial();
