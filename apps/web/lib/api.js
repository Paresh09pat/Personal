import { CSRF_HEADER } from '@olw/shared';

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || `Request failed (${status})`);
    this.status = status;
    this.code = body?.error?.code;
    this.details = body?.error?.details;
  }
}

async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: {
      [CSRF_HEADER]: '1',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body = {}) => request('POST', url, body),
  patch: (url, body = {}) => request('PATCH', url, body),
  delete: (url, body) => request('DELETE', url, body),
};

/** `/api/relationships/:rid…` — every space-scoped call goes through this so the id is always in the path. */
export const relUrl = (rid, rest = '') => `/api/relationships/${rid}${rest}`;
