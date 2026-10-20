import mongoose from 'mongoose';
import { HttpError } from '../lib/errors.js';

export function notFoundHandler() {
  return (_req, res) => res.status(404).json({ error: { code: 'not_found', message: 'Not found' } });
}

export function errorHandler(config) {
  // Express recognises error handlers by their 4-argument signature.
  return (err, req, res, _next) => {
    let status = 500;
    let body = { code: 'server_error', message: 'Something went wrong' };

    if (err instanceof HttpError) {
      status = err.status;
      body = { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) };
    } else if (err instanceof mongoose.Error.CastError) {
      status = 404;
      body = { code: 'not_found', message: 'Not found' };
    } else if (err instanceof mongoose.Error.ValidationError) {
      status = 422;
      body = { code: 'invalid', message: Object.values(err.errors)[0]?.message ?? 'Invalid data' };
    } else if (err?.code === 11000) {
      status = 409;
      body = { code: 'conflict', message: 'That already exists' };
    } else if (err?.type === 'entity.parse.failed') {
      status = 400;
      body = { code: 'bad_json', message: 'Malformed JSON' };
    } else if (err?.type === 'entity.too.large') {
      status = 413;
      body = { code: 'too_large', message: 'Request too large' };
    }

    if (status >= 500 && !config.isTest) console.error('[error]', req.method, req.originalUrl, err);
    if (res.headersSent) return res.end();
    res.status(status).json({ error: body });
  };
}
