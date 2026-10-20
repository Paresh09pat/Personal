# Security notes

| Area | Measure |
|---|---|
| Passwords | argon2id (OWASP parameters), 10–128 chars, constant-time dummy verify for unknown accounts |
| Sessions | 32-byte random token in an `httpOnly`, `SameSite=Lax`, `Secure` (prod) cookie; only an HMAC is stored; 30-day rolling; revoked on logout, password change or reset |
| CSRF | SameSite cookies + mandatory `x-olw-csrf` header on mutations + Origin check |
| Brute force | Per-IP and per-identifier login limits, escalating account lockout, limits on registration, email sending, invitation preview/accept, uploads, export and destructive actions |
| Enumeration | Generic login errors; forgot-password always gives the same answer; non-members get 404 |
| Tokens | Invitation, verification and reset tokens are random, hashed at rest, single-use and expiring |
| Injection | Every input is zod-parsed; ids go through `toObjectId()`; `strictQuery` is on |
| Uploads | MIME allow-list, size limits, declared size enforced while streaming, magic-byte check before an upload counts as ready, random storage keys, `nosniff`, `Content-Disposition` |
| Media access | Re-authorized on every request; signed URLs are short-lived and bound to a user |
| Headers | helmet (CSP, HSTS in prod, frame-ancestors none, referrer policy, …) |
| Realtime | Cookie-authenticated handshake, origin check, per-event membership re-check, no global broadcast, 256 KB message cap, 64 KB signal cap |
| Privacy | `robots: noindex`; the export never includes partner drafts or account data |

## Known limits / operator responsibilities
- Rate limits and Socket.IO rooms are in-memory, so the app runs as **one instance**. To scale out, add the
  Redis store for `express-rate-limit` and `@socket.io/redis-adapter`.
- Calls are peer-to-peer (DTLS-SRTP encrypted). Without a TURN server, some restrictive networks can't connect.
- With `STORAGE_DRIVER=s3`, a presigned URL works for anyone holding it until it expires (5 minutes). The
  local driver additionally binds URLs to the logged-in user.
- Keep `SESSION_SECRET` and `MEDIA_SIGNING_SECRET` private, and back up your MongoDB and media storage.
