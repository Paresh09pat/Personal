import mongoose from 'mongoose';

const { Schema, Types } = mongoose;

const userSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    username: { type: String, required: true, lowercase: true, trim: true },
    displayName: { type: String, required: true, trim: true },
    /** The site owner. With SPACE_CREATION=admin_only, only admins can create spaces and invite. */
    role: { type: String, enum: ['admin', 'member'], default: 'member' },
    passwordHash: { type: String, required: true, select: false },
    emailVerifiedAt: { type: Date, default: null },
    failedLoginCount: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, default: null, select: false },
    onboardedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ username: 1 }, { unique: true });

const sessionSchema = new Schema(
  {
    tokenHash: { type: String, required: true },
    userId: { type: Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, required: true },
    lastSeenAt: { type: Date, default: Date.now },
    ip: String,
    userAgent: String,
  },
  { timestamps: true },
);
sessionSchema.index({ tokenHash: 1 }, { unique: true });
sessionSchema.index({ userId: 1 });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const authTokenSchema = new Schema(
  {
    type: { type: String, enum: ['verify_email', 'reset_password'], required: true },
    userId: { type: Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
authTokenSchema.index({ tokenHash: 1 }, { unique: true });
authTokenSchema.index({ userId: 1, type: 1 });
authTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const User = mongoose.models.User ?? mongoose.model('User', userSchema);
export const Session = mongoose.models.Session ?? mongoose.model('Session', sessionSchema);
export const AuthToken = mongoose.models.AuthToken ?? mongoose.model('AuthToken', authTokenSchema);
