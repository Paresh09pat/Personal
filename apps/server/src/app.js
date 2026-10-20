import express from 'express';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import { authenticate } from './auth/sessions.js';
import { authRoutes } from './auth/routes.js';
import { invitationRoutes } from './invitations/routes.js';
import { relationshipRoutes } from './relationships/routes.js';
import { mediaRoutes } from './features/attachments.js';
import { csrfGuard, noStore, securityHeaders } from './middleware/security.js';
import { createLimiters } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';

/**
 * Builds the Express app. Tests use this directly (real routes, real authz, real DB) with
 * `webHandler` omitted; production/dev pass Next.js's request handler to serve the frontend.
 */
export function createApp({ config, mailer, storage, hub, webHandler }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);

  const limiters = createLimiters(config);
  const deps = { config, mailer, storage, hub, limiters };

  app.use(securityHeaders(config));

  app.get('/healthz', (_req, res) => {
    const dbUp = mongoose.connection.readyState === 1;
    res.status(dbUp ? 200 : 503).json({ ok: dbUp });
  });

  const api = express.Router();
  api.use(noStore());
  api.use(cookieParser());
  api.use(express.json({ limit: '256kb' }));
  api.use(authenticate(config));
  api.use(csrfGuard(config));
  api.use(limiters.api);
  api.use('/auth', authRoutes(deps));
  api.use('/invitations', invitationRoutes(deps));
  api.use('/relationships', relationshipRoutes(deps));
  api.use('/media', mediaRoutes(deps));
  api.use(notFoundHandler());
  app.use('/api', api);

  if (webHandler) app.all('/{*splat}', (req, res) => webHandler(req, res));
  else app.use(notFoundHandler());

  app.use(errorHandler(config));
  return app;
}
