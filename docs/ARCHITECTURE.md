# Architecture & relationship isolation

## One process, three surfaces

```
            ┌─────────────────────── apps/server (Node) ───────────────────────┐
 browser ──▶│  Express  /api/*   ──▶ authenticate ─▶ csrfGuard ─▶ rate limit    │
            │                         └▶ /api/relationships/:rid/* ─▶ requireMember()
            │  Socket.IO /socket.io ──▶ cookie auth ─▶ per-event requireMember()│
            │  Next.js   everything else (the React UI in apps/web)             │
            └──────────────┬───────────────────────────┬───────────────────────┘
                           │                           │
                     MongoDB (replica set)      Private storage (disk / S3)
```

- `packages/shared`: zod schemas, constants and socket event names, used by both sides.
- `apps/server`: the API, realtime layer, storage drivers and background jobs (surprise reveals,
  missed calls, abandoned uploads). It also mounts Next.js, so production is a single service on a single URL.
- `apps/web`: Next.js App Router UI (`.jsx`), TanStack Query and socket.io-client.

## Data model

- `User`, `Session` (only an HMAC of the token is stored; TTL index), `AuthToken` (verify/reset, hashed, single-use).
- `Relationship` holds `participants[]` (max 2 active, enforced by a schema validator and the service layer),
  `status` (`pending | active | archived | ended`), per-participant display name, avatar, read marker and
  notification prefs, plus shared preferences and the anniversary date.
  `pairKey` (sorted user ids) has a **unique partial index**, so two people can't have two live spaces.
- `Invitation` stores a SHA-256 of the token. A partial unique index allows **one pending invite per space**.
- Every scoped collection (`Message`, `Attachment`, `Album`, `Memory`, `LoveNote`, `Letter`, `Surprise`,
  `Milestone`, `CallRecord`, `Notification`) is built with `scopedSchema()`. That makes `relationshipId`
  required and immutable and adds the `{relationshipId, createdAt, _id}` pagination index. There are extra
  compound indexes such as `{relationshipId, status}`, `{relationshipId, date}` and the unique
  `{relationshipId, senderId, clientId}` for idempotent sends.

## The isolation model

**The client never decides which space it is in. The server checks membership on every operation.**

1. **One gate:** `requireMember(userId, relationshipId, {write})` in `apps/server/src/authz/relationship.js`.
   It finds the space *by id and by the caller being an active participant* in one query. Anything else
   (wrong space, garbage id, left participant, unknown id) gets the same **404**, so existence never leaks.
   With `write` set, it also requires `status === 'active'`.
2. **HTTP:** every space route lives under `/api/relationships/:relationshipId/…` behind `loadMembership()`.
   Handlers use `scoped(Model, ctx)`, which always pins `relationshipId` *after* any caller-supplied filter,
   so a body or query `relationshipId` can't override it. ESLint bans `findById` in route code.
3. **Cross-references:** any attachment id put into a message, memory, album, avatar, cover or surprise goes
   through `assertAttachments()`: it must be a ready attachment *of the same space* and not private to someone else.
4. **Content-level privacy inside a space:** unpublished surprises are visible only to their creator, and so
   is their media (`Attachment.restrictedTo`). Locked letters never send their body to the recipient.
5. **Socket.IO:** the handshake authenticates from the httpOnly cookie. Joining `rel:<id>` requires
   membership, and **every** scoped event re-runs `requireMember()`. The sender is always
   `socket.data.userId`, so payload `senderId` and `userId` are ignored. There is no global broadcast:
   `RealtimeHub` only has `toRelationship`, `toUser` (the user's own private channel) and `toCall`.
   When a space ends or is deleted, its sockets are evicted from its rooms.
6. **Media:** files have random UUID keys and are stored outside any public folder.
   `GET …/attachments/:id/content` re-authorizes on every request. Signed URLs (`/api/media/file/<token>`)
   last 5 minutes and are bound to {attachment, space, **user**}: the server also requires the session user
   to match and to still be a member. With S3, the server authorizes first, then redirects to a
   5-minute presigned URL.
7. **Calls:** `POST …/calls` and `…/calls/:id/token` are scoped routes. The call token (2 minutes) is bound to
   {call, space, user}, and `call:join` verifies all three plus membership before joining `call:<id>`.
   Signals are only relayed between sockets inside that call room.
8. **Frontend:** the space id comes from the URL. `SpaceShell` is keyed by it, so switching spaces remounts
   everything, leaves the old socket room, and `removeQueries(['rel', oldId])` drops the old space's cache.
   Socket events are applied only when `payload.relationshipId === rid`. All of this is defence in depth;
   the server is the authority.

## Invitations

`POST /relationships` creates a `pending` space, and `POST /:rid/invitations` mints a 32-byte random token
(returned once; only its hash is stored). `POST /invitations/accept` runs in a **transaction**:
it atomically claims the token (`pending → accepted`), rejects self-acceptance, a wrong invitee email,
full or non-pending spaces and duplicate pairs, then adds the second participant and activates the space.
Concurrent accepts can't both win.

## Tests

`apps/server/test` boots the real app against a real MongoDB replica set (mongodb-memory-server). Nothing in
authorization is mocked. `isolation.test.js` is the three-user (A, B, C) suite covering all 10 required checks,
plus a sweep that calls every read and write endpoint of the other space and expects 404.

## Group spaces

A space has a `kind`: `direct` (the original two-person space) or `group` (up to `MAX_GROUP_PARTICIPANTS` = 30 people).
Spaces written before groups existed have no `kind` and are treated as `direct`.

- **Same isolation rules.** Membership is still checked on every request, socket event and file download through `requireMember()`; content is still queried through `scoped()`. A group is just a space with more active participants.
- **`ctx.others` instead of `ctx.partner`.** `buildContext()` returns every *other active* person in `ctx.others`. `ctx.partner` exists only in 1:1 spaces and is `null` in groups, so code that wrongly assumes a single partner fails loudly. Notifications use `notifyOthers()`.
- **Roles.** The creator is `owner`; owners and `admin`s can make invite links, remove people and delete the group. Only the owner can remove or demote an admin. Anyone can leave; if the last admin leaves, the longest-standing member is promoted; the last person to leave deletes the group.
- **Invitations.** A group link is shareable (optionally limited to N people) and expires; making a new link revokes the old one. Removed people cannot rejoin with an old link, people who left can rejoin. The member cap is enforced by the schema validator and verified by a concurrent-join test.
- **Not in groups (yet):** calls, letters and surprises (they are person-to-person) — the API answers 409 and the tabs are hidden.
- **No `pairKey`.** Only 1:1 spaces carry a `pairKey`, so the one-space-per-pair rule does not affect groups.
