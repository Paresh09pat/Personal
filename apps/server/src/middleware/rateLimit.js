import { rateLimit } from 'express-rate-limit';

const MIN = 60 * 1000;

const passthrough = (_req, _res, next) => next();

/**
 * Named limiters. In-memory store (fine for a single instance; see docs/DEPLOYMENT.md for scaling).
 * `config.rateLimit.enabled=false` turns them off (most tests); overrides allow tight limits in tests.
 */
export function createLimiters(config) {
  const make = (name, windowMs, limit, extra = {}) => {
    if (!config.rateLimit.enabled) return passthrough;
    return rateLimit({
      windowMs,
      limit: config.rateLimit[name] ?? limit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_req, res) =>
        res.status(429).json({
          error: { code: 'rate_limited', message: 'Too many requests. Please slow down and try again shortly.' },
        }),
      ...extra,
    });
  };

  const identifierKey = (field) => (req) =>
    `${field}:${String(req.body?.[field] ?? '').trim().toLowerCase().slice(0, 254)}`;

  return {
    api: make('api', 15 * MIN, 1500),
    loginIp: make('loginIp', 15 * MIN, 30),
    loginIdentifier: make('loginIdentifier', 15 * MIN, 10, { keyGenerator: identifierKey('identifier') }),
    register: make('register', 60 * MIN, 10),
    emailSend: make('emailSend', 60 * MIN, 5),
    resetPassword: make('resetPassword', 15 * MIN, 10),
    invitation: make('invitation', 15 * MIN, 30),
    upload: make('upload', 15 * MIN, 200),
    export: make('export', 60 * MIN, 5),
    destructive: make('destructive', 60 * MIN, 10),
  };
}
