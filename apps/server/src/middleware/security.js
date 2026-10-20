import helmet from 'helmet';
import { CSRF_HEADER } from '@olw/shared';
import { forbidden } from '../lib/errors.js';

export function securityHeaders(config) {
  const s3Origin = config.storage.s3.endpoint ? new URL(config.storage.s3.endpoint).origin : null;
  const mediaSrc = ["'self'", 'blob:', 'data:', ...(s3Origin ? [s3Origin] : []), 'https:'];
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        // Next.js injects inline bootstrap scripts; dev mode additionally needs eval for HMR.
        scriptSrc: ["'self'", "'unsafe-inline'", ...(config.isProd ? [] : ["'unsafe-eval'"])],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: mediaSrc,
        mediaSrc,
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'ws:', 'wss:', ...(s3Origin ? [s3Origin] : []), 'https:'],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.isProd ? undefined : false,
  });
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence in depth on top of SameSite=Lax cookies: every mutating API call must carry the
 * custom header (which cross-site forms can't send) and, when the browser sends Origin, it must
 * be our own origin.
 */
export function csrfGuard(config) {
  return (req, _res, next) => {
    if (SAFE.has(req.method)) return next();
    if (req.get(CSRF_HEADER) !== '1') throw forbidden('Missing CSRF header', { code: 'csrf' });
    const origin = req.get('origin');
    if (origin && origin !== config.appOrigin) throw forbidden('Bad origin', { code: 'csrf' });
    next();
  };
}

export function noStore() {
  return (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  };
}
