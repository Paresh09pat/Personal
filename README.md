# Our Little World 💞

A private home for relationships. Every relationship gets its **own completely isolated space**: chat
(text, photos, videos, voice notes), a shared gallery and albums, a memories timeline, love notes,
"open when…" letters, secret surprises, anniversaries and milestones, and audio/video calls.

One person can be in several spaces (for example "Me & A" and "Me & B"). They never share anything:
messages, media, surprises, calls, notifications and settings stay inside their own space. This is
enforced on the server for every request, socket event, file download and call token.

## Quick start (no accounts, no installs besides Node)

```sh
npm install
npm run dev          # http://localhost:3000
```

The first run downloads a local MongoDB once. Data lives in `.data/`. Emails (verification and password
reset links) are printed in the terminal.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API + Socket.IO + Next.js dev server on one port, auto-restarting the server on changes |
| `npm run build` | Production build of the website |
| `npm run start:prod` | Run the production build locally (needs `MONGODB_URI` + secrets, see `.env.example`) |
| `npm test` | All server and web tests |
| `npm run test:isolation` | The three-user relationship-isolation suite (users A, B, C; spaces AB and AC) |
| `npm run lint` | ESLint, including isolation guard-rails (no `findById` in routes, no global `io.emit`) |
| `npm run create-admin -- --email=… --username=… --name=… --password=…` | Create the site owner (admin), or promote an existing account. On a fresh install the first account to sign up is admin automatically |
| `npm run migrate:legacy` | Migrate data from the old single-couple version (dry run by default) |

## Project layout

```
apps/server     Express 5 + Socket.IO + Mongoose (plain JavaScript, ESM)
apps/web        Next.js 16 App Router UI (.jsx), Tailwind CSS 4, TanStack Query
packages/shared zod schemas, constants and socket event names shared by both
docs/           ARCHITECTURE, SECURITY, DATA-RETENTION, ENV, DEPLOYMENT
```

## Docs
- [Architecture & isolation model](docs/ARCHITECTURE.md)
- [Security](docs/SECURITY.md)
- [Data retention, export & deletion](docs/DATA-RETENTION.md)
- [Environment variables](docs/ENV.md)
- [Deployment](docs/DEPLOYMENT.md): runs on any Node host with WebSockets (Fly.io, Railway, Render, a VPS)
