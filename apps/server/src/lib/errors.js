export class HttpError extends Error {
  constructor(status, message, { code, details } = {}) {
    super(message);
    this.status = status;
    this.code = code ?? defaultCode(status);
    this.details = details;
  }
}

function defaultCode(status) {
  return (
    {
      400: 'bad_request',
      401: 'unauthenticated',
      403: 'forbidden',
      404: 'not_found',
      409: 'conflict',
      413: 'too_large',
      422: 'invalid',
      429: 'rate_limited',
    }[status] ?? 'error'
  );
}

export const badRequest = (msg = 'Bad request', opts) => new HttpError(400, msg, opts);
export const unauthenticated = (msg = 'Please sign in') => new HttpError(401, msg);
export const forbidden = (msg = 'Not allowed', opts) => new HttpError(403, msg, opts);
/** Non-members always get this exact response, so a space's existence is never revealed. */
export const notFound = (msg = 'Not found') => new HttpError(404, msg);
export const conflict = (msg = 'Conflict', opts) => new HttpError(409, msg, opts);
