# Environment variables

All configuration is validated at startup (`apps/server/src/config/env.js`). In **production** the server
refuses to start if `MONGODB_URI` is missing, if a secret is shorter than 32 characters or still the dev
default, or if `APP_ORIGIN` isn't `https://`.

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | `production` turns on secure cookies, HSTS, strict checks and the built frontend. |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Where the single server listens (API, Socket.IO and website together). |
| `APP_ORIGIN` | `http://localhost:3000` (on Render: `RENDER_EXTERNAL_URL`) | Public URL. Used for links in emails and invitations, and for the CSRF and WebSocket origin checks. |
| `MONGODB_URI` | *(none)* | MongoDB connection string. **Must be a replica set** (Atlas always is) because invitations use transactions. Unset in dev, a local DB starts automatically. |
| `MONGO_DATA_DIR` | `.data/mongo` | Dev-only folder for the local DB. |
| `MONGO_DEV_PORT` | `27027` | Dev-only port for the local DB. |
| `SESSION_SECRET` | dev value | HMAC key for session token hashes. Changing it signs everyone out. |
| `MEDIA_SIGNING_SECRET` | dev value | HMAC key for signed media URLs and call tokens. |
| `REGISTRATION_MODE` | `open` (dev) / `invite_only` (prod) | `invite_only`: only the very first account, and people holding a valid invite link, can sign up. |
| `SPACE_CREATION` | `admin_only` | `admin_only`: only the site owner (admin) can start new chats and send invites, and everyone else only sees the chat they were invited to. `everyone`: any user can create spaces. The first account becomes admin; `npm run create-admin` creates or promotes one. |
| `STORAGE_DRIVER` | `local` | `local` stores private files on disk (needs a **persistent** disk in production). `mongo` stores them inside MongoDB/GridFS (for hosts with no persistent disk, such as Render free; it counts against your DB size, and Atlas free is about 512 MB). `s3` uses an S3-compatible bucket. |
| `UPLOAD_DIR` | `.data/uploads` | Folder used by the local driver. Never publicly served. |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | | Used when `STORAGE_DRIVER=s3`. The bucket must be **private**. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | | Real email. When unset, emails (verification and reset links) are printed to the server console. |
| `EMAIL_FROM` | `Our Little World <no-reply@localhost>` | Sender address. |
| `EMAIL_VERIFICATION` | `auto` | `auto` = required only when SMTP is configured; `required`; `off`. Unverified users can't create or join spaces when it's required. |
| `STUN_URLS` | Google public STUN | Comma-separated STUN servers for calls. |
| `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` | | Optional TURN relay. Needed for calls on some mobile and corporate networks. |
| `TRUST_PROXY` | `1` (prod) / `loopback` | How many reverse proxies sit in front, so client IPs (rate limiting) and HTTPS detection are correct. |
| `INVITE_TTL_HOURS` | `72` | Default invitation lifetime. |
| `SERVE_WEB` | `true` | `false` runs the API and Socket.IO only (used by tests). |
| `RATE_LIMIT` | `true` | Disable only for local load testing. |
