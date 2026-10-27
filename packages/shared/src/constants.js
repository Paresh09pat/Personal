export const RELATIONSHIP_STATUS = Object.freeze({
  PENDING: 'pending',
  ACTIVE: 'active',
  ARCHIVED: 'archived',
  ENDED: 'ended',
});

export const PARTICIPANT_STATUS = Object.freeze({
  ACTIVE: 'active',
  LEFT: 'left',
  REMOVED: 'removed',
});

export const PARTICIPANT_ROLE = Object.freeze({
  OWNER: 'owner',
  PARTNER: 'partner',
  ADMIN: 'admin',
  MEMBER: 'member',
});

/** Roles that may manage a group (invite links, removing people, deleting it). */
export const ADMIN_ROLES = Object.freeze(['owner', 'admin']);

/** A 1:1 space is exactly two people; a group holds up to MAX_GROUP_PARTICIPANTS. */
export const SPACE_KIND = Object.freeze({ DIRECT: 'direct', GROUP: 'group' });

export const INVITATION_STATUS = Object.freeze({
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  REVOKED: 'revoked',
  EXPIRED: 'expired',
});

export const SURPRISE_STATUS = Object.freeze({
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  REVEALED: 'revealed',
});

export const MESSAGE_TYPES = Object.freeze(['text', 'image', 'video', 'voice', 'file', 'system']);

export const ATTACHMENT_KINDS = Object.freeze(['image', 'video', 'audio', 'file']);

export const ATTACHMENT_PURPOSES = Object.freeze(['message', 'gallery', 'memory', 'avatar', 'cover', 'surprise', 'wallpaper']);

/** Shared chat themes (both people see the same one). "custom" = an uploaded photo wallpaper. */
export const CHAT_THEMES = Object.freeze([
  'classic', 'love', 'blossom', 'rosegold', 'valentine', 'candy',
  'midnight', 'aurora', 'neon', 'lofi',
  'ocean', 'beach', 'mint', 'forest',
  'celebration', 'snow', 'custom',
]);

/** Disappearing messages: 0 = off, otherwise seconds (1 minute to 30 days). */
export const DISAPPEAR = Object.freeze({ minSec: 60, maxSec: 30 * 24 * 60 * 60 });

/** A 1:1 space holds exactly two people. Never more. */
export const MAX_ACTIVE_PARTICIPANTS = 2;
export const MAX_DIRECT_PARTICIPANTS = MAX_ACTIVE_PARTICIPANTS;
export const MAX_GROUP_PARTICIPANTS = 30;

export const LIMITS = Object.freeze({
  messageBody: 4000,
  title: 140,
  body: 10000,
  displayName: 60,
  username: { min: 3, max: 30 },
  password: { min: 10, max: 128 },
  attachmentsPerItem: 10,
  pageSize: 30,
  maxPageSize: 100,
  maxPendingSpacesPerUser: 5,
});

export const UPLOAD_LIMITS = Object.freeze({
  image: 15 * 1024 * 1024,
  video: 200 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
  file: 25 * 1024 * 1024,
});

/** Declared MIME type -> attachment kind. Anything not listed is rejected. */
export const ALLOWED_MIME = Object.freeze({
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'image/heic': 'image',
  'image/avif': 'image',
  'video/mp4': 'video',
  'video/webm': 'video',
  'video/quicktime': 'video',
  'audio/webm': 'audio',
  'audio/ogg': 'audio',
  'audio/mpeg': 'audio',
  'audio/mp4': 'audio',
  'audio/wav': 'audio',
  'application/pdf': 'file',
});

export const REACTIONS = Object.freeze(['❤️', '😍', '😂', '🥺', '😘', '👍', '🔥', '😢']);

/** Socket.IO event names shared by client and server. */
export const EVENTS = Object.freeze({
  RELATIONSHIP_JOIN: 'relationship:join',
  RELATIONSHIP_LEAVE: 'relationship:leave',
  RELATIONSHIP_UPDATED: 'relationship:updated',
  RELATIONSHIP_REMOVED: 'relationship:removed',
  MESSAGE_SEND: 'message:send',
  MESSAGE_NEW: 'message:new',
  MESSAGE_UPDATED: 'message:updated',
  MESSAGE_REACT: 'message:react',
  TYPING: 'typing',
  PRESENCE: 'presence',
  READ_UPDATE: 'read:update',
  READ_UPDATED: 'read:updated',
  NOTIFY: 'notify',
  CONTENT_CHANGED: 'content:changed',
  CALL_INCOMING: 'call:incoming',
  CALL_JOIN: 'call:join',
  CALL_PEER_JOINED: 'call:peer-joined',
  CALL_SIGNAL: 'call:signal',
  CALL_END: 'call:end',
  CALL_ENDED: 'call:ended',
  CALL_DECLINE: 'call:decline',
});

export const CSRF_HEADER = 'x-olw-csrf';
export const SESSION_COOKIE = 'olw_sid';
