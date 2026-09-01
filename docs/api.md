# API

All routes are prefixed `/api/v1`. Auth via `Authorization: Bearer <accessToken>`.

## Error shape

Every error response has this shape:

```json
{ "error": { "code": "SPLIT_MISMATCH", "message": "...", "details": {} } }
```

## Endpoints

### `GET /health`

Liveness check, no auth required.

**Response `200`**
```json
{ "status": "ok" }
```

### `POST /auth/register`

Rate limited (10/min/IP).

**Body** `{ email, name, password }`

**Response `201`** `{ user, accessToken, refreshToken }`

Errors: `409 EMAIL_TAKEN`, `422 VALIDATION_ERROR`.

### `POST /auth/login`

Rate limited (10/min/IP).

**Body** `{ email, password }`

**Response `200`** `{ user, accessToken, refreshToken }`

Errors: `401 INVALID_CREDENTIALS`, `422 VALIDATION_ERROR`.

### `POST /auth/refresh`

Rate limited (10/min/IP). Rotates the refresh token — the token passed in is revoked and a new
access + refresh pair is issued. Reusing an already-rotated (or expired/revoked) refresh token
is rejected.

**Body** `{ refreshToken }`

**Response `200`** `{ accessToken, refreshToken }`

Errors: `401 REFRESH_TOKEN_INVALID`, `422 VALIDATION_ERROR`.

### `POST /auth/logout`

Rate limited (10/min/IP). Revokes the given refresh token. Idempotent — always `204` even if the
token was already revoked or unknown.

**Body** `{ refreshToken }`

**Response `204`** (no body)

### `GET /users/me`

Requires auth.

**Response `200`** `{ id, email, name, avatarUrl, createdAt }`

Errors: `401 UNAUTHORIZED`.

### `PATCH /users/me`

Requires auth.

**Body** `{ name?, avatarUrl? }`

**Response `200`** `{ id, email, name, avatarUrl, createdAt }`

Errors: `401 UNAUTHORIZED`, `422 VALIDATION_ERROR`.

### `GET /groups`

Requires auth. Lists groups the caller is an active member of.

**Response `200`** `{ groups: [{ id, name, baseCurrency, createdById, createdAt, archivedAt, role }] }`

### `POST /groups`

Requires auth. The caller becomes `OWNER`. `memberEmails` entries matching an existing user
become `MEMBER`s immediately; entries with no matching user each get a `GroupInvite` (7-day
expiry) instead — the invite's `email` only ever appears in this response, it isn't persisted.
Share the returned `code` with that person out of band; they redeem it via
`POST /invites/:code/accept`.

**Body** `{ name, baseCurrency, memberEmails: string[] }`

**Response `201`** `{ group, pendingInvites: [{ email, code, expiresAt }] }`

Errors: `422 VALIDATION_ERROR`.

### `GET /groups/:id`

Requires membership (any role). Includes the member list.

**Response `200`** `{ id, name, baseCurrency, createdById, createdAt, archivedAt, members: [{ userId, name, email, role, joinedAt }] }`

Errors: `404 NOT_FOUND` (non-members get 404, not 403 — group existence isn't leaked).

### `PATCH /groups/:id`

Requires `OWNER`. `archived: true/false` maps to setting/clearing `archivedAt`.

**Body** `{ name?, archived? }`

**Response `200`** same shape as `GET /groups/:id` (without `members`).

Errors: `404 NOT_FOUND` (non-members), `403 FORBIDDEN` (members below `OWNER`), `422 VALIDATION_ERROR`.

### `POST /groups/:id/invites`

Requires `OWNER`. Creates a generic, unaddressed invite code (7-day expiry).

**Response `201`** `{ code, expiresAt }`

Errors: `404 NOT_FOUND`, `403 FORBIDDEN`.

### `POST /invites/:code/accept`

Requires auth (not nested under `/groups` — the code alone identifies the group). Adds the
caller as a `MEMBER`; re-accepting an already-used, expired, or unknown code fails.

**Response `200`** the group (same shape as `PATCH /groups/:id`).

Errors: `404 INVITE_INVALID`.

### `DELETE /groups/:id/members/:userId`

Requires `OWNER`. Blocked if the target is the group's sole remaining `OWNER`, or (from Phase 4
onward) has a non-zero balance in the group — that check is stubbed to always pass until Phase 4
wires up the real ledger.

**Response `204`** (no body)

Errors: `404 NOT_FOUND`, `403 FORBIDDEN`, `409 LAST_OWNER`, `409 MEMBER_HAS_BALANCE` (not
reachable yet).

## Error codes reference

| Code | Status | Where |
|---|---|---|
| `NOT_FOUND` | 404 | any unmatched route, or a group you're not a member of |
| `BAD_REQUEST` | 400 | malformed path parameter |
| `VALIDATION_ERROR` | 422 | request body fails Zod validation |
| `EMAIL_TAKEN` | 409 | register with an existing email |
| `INVALID_CREDENTIALS` | 401 | login with wrong email/password |
| `REFRESH_TOKEN_INVALID` | 401 | refresh with an unknown/expired/already-rotated token |
| `UNAUTHORIZED` | 401 | missing/invalid/expired access token |
| `FORBIDDEN` | 403 | a group member's role is too low for the action |
| `INVITE_INVALID` | 404 | invite code is unknown, expired, or already used |
| `LAST_OWNER` | 409 | tried to remove a group's only remaining owner |
| `MEMBER_HAS_BALANCE` | 409 | tried to remove a member with a non-zero balance (stubbed until Phase 4) |
| `INTERNAL_ERROR` | 500 | unhandled error |
