# Data retention, participant rights, export and deletion

This policy was written **before** the destructive features were implemented, and the code follows it.
Lifecycle logic lives in `apps/server/src/relationships/lifecycle.js` and `apps/server/src/auth/account.js`.

## Principles

1. A relationship space belongs to **both** participants. Neither one can silently destroy shared history.
2. Ending a relationship never deletes data. Deletion is always a separate, explicit, confirmed step.
3. Nobody can act on a space they are not an active participant in. Every action goes through
   `requireMember()`. A non-member gets `404`, so they never learn whether the space exists.
4. Private, unshared content (unpublished surprises, unsent drafts) belongs only to its author.

## Space states

| Status     | Who can read          | Who can write | How you get here                                  |
|------------|-----------------------|---------------|---------------------------------------------------|
| `pending`  | owner                 | owner (settings, invitations only) | owner creates a space            |
| `active`   | both participants     | both          | invitee accepts a valid invitation                |
| `archived` | both participants     | nobody (read-only) | either participant archives                  |
| `ended`    | remaining participants | nobody (read-only) | either participant ends it, or an account is deleted |

## Actions

### Leaving or withdrawing an invitation that has not been accepted
- The **owner** can revoke the current invitation (`DELETE /relationships/:id/invitations/current`).
  The token stops working at once.
- The **owner** can delete a `pending` space. It has never had a second participant, so it holds no shared
  data, and it is hard-deleted together with its invitations and the owner's uploads.
- The **invitee** can decline (`POST /invitations/decline`). This marks the invitation `declined`, and the
  space stays pending so the owner can invite again.

### Archiving
- Either participant can archive or unarchive. While a space is archived it is read-only for both people
  and is listed under "Archived" on the dashboard. Nothing is deleted.

### Ending
- Either participant can end an `active` or `archived` space.
- The space becomes read-only for both people forever. Live sockets are removed from its rooms, active
  calls stop, and no new messages, media, calls or invitations are possible.
- **All shared content is retained.** Both participants can still read and export it.
- The same pair can later create a new space through a fresh invitation. The old space stays separate.

### Revoking access
- A space always has exactly two people, so "removing your partner" is the same as **ending** the space.
  There is no way to add or swap in a third person.

### Export
- Any participant (active, archived or ended space) can export the space, up to 5 exports per hour.
- The export is a JSON file containing:
  - the full conversation, since both participants took part in it (deleted messages show as removed);
  - shared memories, love notes, milestones, albums, call history and space settings;
  - letters the user wrote, plus letters the user received that are already unlocked;
  - surprises the user created (any status), plus surprises the user received that are already revealed;
  - a media manifest with metadata and short-lived download links, for media the user may view.
- It **never** includes the partner's unpublished surprises, locked letter bodies, the partner's sessions,
  email address or any other account data.

### Deleting a relationship space
- Only possible once the space is `ended`.
- **Both** participants must request deletion. Each request needs the person's password and the typed
  phrase `DELETE`. A participant whose account was deleted counts as having agreed.
- When the last required request arrives, the space is purged: messages, attachments (database rows **and**
  stored files), albums, memories, notes, letters, surprises, milestones, call records, notifications and
  invitations. This cannot be undone.
- Until then, either person can withdraw their request.

### Deleting a personal account
- Needs the password and the typed phrase `DELETE`.
- Effects:
  1. Every `pending` space the user owns is hard-deleted (no shared data exists).
  2. Every `active`/`archived` space the user is in is **ended**, and the user's participant record is marked
     `left`. The partner keeps read and export access to the shared history, with the author shown as
     "Deleted user".
  3. The user's unpublished surprises (drafts and scheduled ones) and their private attachments are deleted.
  4. The user's profile is anonymised (email, username, display name, password hash replaced) and all
     sessions and auth tokens are deleted. The email address becomes free to register again.
  5. The user's deletion request is recorded on each ended space, so the partner can later purge it alone.
- Before deleting the account, users can delete their own individual messages, notes and memories if they
  do not want them kept in the partner's copy.

## Retention periods

| Data                          | Retained                                                            |
|-------------------------------|---------------------------------------------------------------------|
| Shared space content          | Until the space is deleted by both participants                     |
| Sessions                      | 30 days rolling (TTL index), or until logout / password change      |
| Email verification tokens     | 24 hours (TTL index)                                                |
| Password reset tokens         | 30 minutes, single use (TTL index)                                  |
| Invitations                   | Kept for audit. Only a SHA-256 hash of the token is ever stored. Expired after 72 h by default |
| Pending (un-uploaded) attachments | Purged after 24 hours                                           |
| Notifications                 | 90 days (TTL index)                                                 |

## Group spaces

- A group has no "pending" or "ended" stage. Anyone can **leave** (they lose access immediately and keep nothing of the group; their past messages stay for the others, labelled with the name they used).
- An **admin** can delete the whole group at any time (password-confirmed). That erases every message, photo and file for everyone, like the final step of a 1:1 deletion.
- The last person leaving a group deletes it.
- Deleting your account removes you from every group you are in (the group continues; a last admin hands the role to the longest-standing member).
