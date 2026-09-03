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

Requires `OWNER`. Blocked if the target is the group's sole remaining `OWNER`, or has a non-zero
net balance in the group (checked against real `LedgerEntry` data as of Phase 4).

**Response `204`** (no body)

Errors: `404 NOT_FOUND`, `403 FORBIDDEN`, `409 LAST_OWNER`, `409 MEMBER_HAS_BALANCE`.

### `GET /groups/:id/expenses`

Requires membership (any role). Cursor-paginated, newest `paidAt` first.

**Query** `?cursor&limit&paidBy&from&to`

**Response `200`** `{ expenses: [Expense], nextCursor: string | null }`

### `POST /groups/:id/expenses`

Requires membership (any role). All currency amounts are decimal strings (e.g. `"20.00"`),
never JSON numbers — money is never a float, per project.md rule #1.

`splits` and `payers` both reuse the same split engine (project.md §4.1): `splits[].input` is a
minor-unit integer string for `EXACT`, a percentage for `PERCENT`, an integer weight for `SHARES`
(omitted for `EQUAL`). For `payers`, either every entry omits `amount` (split the total equally
among them) or every entry provides one (a decimal string, validated to sum exactly to `amount`)
— mixing the two is a validation error.

**Body** `{ description, category?, currency, amount, splitType, splits: [{userId, input?}], payers: [{userId, amount?}], paidAt }`

**Response `201`** an `Expense` — `{ id, groupId, description, category, currency, amount, baseCurrency, amountBase, fxRateToBase, splitType, paidAt, createdById, version, createdAt, updatedAt, payers: [{userId, name, amount, amountBase}], splits: [{userId, name, amount, amountBase, input}] }`

Errors: `422 SPLIT_MISMATCH` (splits/payers don't sum to `amount`), `422 UNSUPPORTED_CURRENCY` (no
static FX rate for this currency), `422 INVALID_PARTICIPANT` (a listed userId isn't an active
group member), `422 VALIDATION_ERROR`.

### `GET /expenses/:id`

Requires membership in the expense's group.

**Response `200`** an `Expense` (see above).

Errors: `404 NOT_FOUND` (non-members, or the expense is soft-deleted).

### `PATCH /expenses/:id`

Requires the expense's creator or the group's `OWNER`. Full replace (same body as `POST`), not a
partial patch — old `ExpensePayer`/`ExpenseSplit` rows are replaced and old `LedgerEntry` rows are
reversed (never mutated) before fresh ones are written; `version` increments by 1.

**Header** `If-Match: <current version>` — required.

**Body** same as `POST /groups/:id/expenses`.

**Response `200`** the updated `Expense`.

Errors: `400 IF_MATCH_REQUIRED` (header missing/non-integer), `409 STALE_VERSION` (header doesn't
match the current version), `403 FORBIDDEN`, `404 NOT_FOUND`, `422 SPLIT_MISMATCH`,
`422 UNSUPPORTED_CURRENCY`, `422 INVALID_PARTICIPANT`, `422 VALIDATION_ERROR`.

### `DELETE /expenses/:id`

Requires the expense's creator or the group's `OWNER`. Soft delete (`deletedAt`) + `LedgerEntry`
reversal only — no fresh entries.

**Response `204`** (no body)

Errors: `403 FORBIDDEN`, `404 NOT_FOUND`.

### `GET /groups/:id/balances`

Requires membership (any role). `net` covers every active group member (defaulting to `"0.00"`
for anyone with no ledger activity yet), computed from `LedgerEntry` — the source of truth.
`pairwise` is a *derived, informational* "who owes whom directly" view, computed on read from
current non-deleted expenses (a participant's share is distributed across that expense's payers
proportional to their contribution, then netted per pair) — not ledger-authoritative, and nothing
extra is stored for it.

**Response `200`** `{ net: [{userId, name, amount}], pairwise: [{from, fromName, to, toName, amount}] }`

### `GET /groups/:id/settle-plan`

Requires membership (any role). Runs project.md §4.3's greedy max-creditor/max-debtor matching
over the group's net balances (≤ n−1 transfers, a heuristic — true minimum-transfer is NP-hard),
or the `subset` refinement for small groups (partitions into independent zero-sum subsets first;
never produces more transfers than `greedy`). `naiveCount` is the pairwise view's transfer count,
for the "N transactions → M" comparison.

**Query** `?strategy=greedy|subset` (default `greedy`)

**Response `200`** `{ strategy, transfers: [{from, fromName, to, toName, amount}], transferCount, naiveCount }`

## Error codes reference

| Code | Status | Where |
|---|---|---|
| `NOT_FOUND` | 404 | any unmatched route, a group you're not a member of, or an expense you can't see |
| `BAD_REQUEST` | 400 | malformed path parameter |
| `VALIDATION_ERROR` | 422 | request body fails Zod validation |
| `EMAIL_TAKEN` | 409 | register with an existing email |
| `INVALID_CREDENTIALS` | 401 | login with wrong email/password |
| `REFRESH_TOKEN_INVALID` | 401 | refresh with an unknown/expired/already-rotated token |
| `UNAUTHORIZED` | 401 | missing/invalid/expired access token |
| `FORBIDDEN` | 403 | a group member's role is too low for the action |
| `INVITE_INVALID` | 404 | invite code is unknown, expired, or already used |
| `LAST_OWNER` | 409 | tried to remove a group's only remaining owner |
| `MEMBER_HAS_BALANCE` | 409 | tried to remove a member with a non-zero balance |
| `SPLIT_MISMATCH` | 422 | expense splits/payers don't sum exactly to the total |
| `UNSUPPORTED_CURRENCY` | 422 | no static FX rate available for the expense/group currency pair |
| `INVALID_PARTICIPANT` | 422 | a split/payer userId isn't an active member of the group |
| `IF_MATCH_REQUIRED` | 400 | `PATCH /expenses/:id` without a valid `If-Match` header |
| `STALE_VERSION` | 409 | `If-Match` doesn't match the expense's current version |
| `INTERNAL_ERROR` | 500 | unhandled error |
