# Deploying Our Little World

## Will it work "anywhere"?

It works on any host that runs a **long-lived Node.js process with WebSockets**: Railway, Fly.io, Render,
Koyeb, DigitalOcean App Platform, or any VPS with Docker.

It does **not** fully work on static or serverless-only hosts (GitHub Pages, Netlify, Vercel
functions). Chat, typing indicators, presence, calls and scheduled surprises need a server that stays
running. Everything (API, realtime and website) ships as one service from one `Dockerfile`.

## What you need in production

| Need | Free/cheap option | Notes |
|---|---|---|
| A host with WebSockets | Railway / Fly.io / Render (paid starter) / VPS | One instance |
| MongoDB **replica set** | **MongoDB Atlas M0** (free, no card) | Invitations use transactions; Atlas is always a replica set |
| Private media storage | Host persistent volume **or** Cloudflare R2 / Backblaze B2 (S3-compatible) | Use S3 if your host's disk is wiped on deploy |
| HTTPS | Provided by all of the hosts above | Required for secure cookies, camera/mic access and calls |
| Email (optional) | Gmail app password / any SMTP | Without it, verification is off and reset links go to the server log |
| TURN (optional) | coturn on a VPS, or a hosted TURN free tier | Only if calls fail on some mobile networks |

## Step by step (Atlas + Fly.io, with a persistent volume)

1. **Database:** create a free Atlas M0 cluster, add a database user, allow access from anywhere
   (`0.0.0.0/0`) or from your host's IPs, and copy the `mongodb+srv://…` connection string.
2. **Secrets:** generate two secrets:
   ```sh
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```
3. **Fly:** install `flyctl`, then from the repo root:
   ```sh
   fly launch --no-deploy            # keeps the provided fly.toml
   fly volumes create olw_data --size 3
   fly secrets set MONGODB_URI="mongodb+srv://…" SESSION_SECRET="…" MEDIA_SIGNING_SECRET="…" \
                   APP_ORIGIN="https://<your-app>.fly.dev" REGISTRATION_MODE=invite_only
   fly deploy
   ```
4. Open `https://<your-app>.fly.dev`. Register **your** account first: in `invite_only` mode the first
   account is allowed, and after that only people holding an invite link can sign up.
5. Create a space, send the invite link to your partner, and enjoy 💗

### Railway
New project → Deploy from repo (it detects the `Dockerfile`) → add a Volume mounted at `/data` → set the
same variables as above (`APP_ORIGIN` = your Railway domain).

### Render
Use `render.yaml` (Blueprint). Persistent disks need a paid instance. On the free instance set
`STORAGE_DRIVER=s3` with R2 credentials, because the free disk is wiped on every deploy.

### Any VPS (Docker)
```sh
docker build -t our-little-world .
docker run -d --name olw -p 3000:3000 -v olw-data:/data --env-file .env --restart unless-stopped our-little-world
```
Put Caddy or nginx in front for HTTPS, and forward WebSocket upgrades (`/socket.io`).

## Cloudflare R2 instead of a disk
```
STORAGE_DRIVER=s3
S3_BUCKET=our-little-world
S3_REGION=auto
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=…
S3_SECRET_ACCESS_KEY=…
```
Keep the bucket private (no public access, no custom public domain). Add a CORS rule that allows `PUT`
and `GET` from your `APP_ORIGIN`, because browsers upload straight to the presigned URL.

## Migrating data from the old single-couple version
If you have a database from the earlier one-couple app (documents without `relationshipId`):
```sh
MONGODB_URI=… npm run migrate:legacy                 # dry run: shows counts, changes nothing
MONGODB_URI=… npm run migrate:legacy -- --apply      # moves everything into one space
# If more than two users exist, choose the couple explicitly:
MONGODB_URI=… npm run migrate:legacy -- --apply --users=<ownerUserId>,<partnerUserId>
```
The migration is idempotent and never deletes anything. **Back up the database first.**

## Operations checklist
- Back up Atlas (snapshots) and your media volume or bucket.
- Run a single instance (see SECURITY.md for scaling out with Redis).
- Watch `/healthz`.
- Rotate `SESSION_SECRET` only if you need to sign everyone out.
