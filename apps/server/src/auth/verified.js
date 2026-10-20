import { HttpError } from '../lib/errors.js';

/** When an email provider is configured, creating or joining a space requires a verified email. */
export function requireVerifiedEmail(config) {
  return (req, _res, next) => {
    if (config.email.requireVerification && !req.user?.emailVerifiedAt) {
      throw new HttpError(403, 'Please confirm your email address first', { code: 'email_unverified' });
    }
    next();
  };
}
