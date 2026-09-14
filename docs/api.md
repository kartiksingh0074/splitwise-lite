# API

All routes are prefixed `/api/v1`. Auth via `Authorization: Bearer <accessToken>`.

## Hardening (Phase 8)

- **CORS**: only origins listed in `CORS_ALLOWED_ORIGINS` (comma-separated; defaults to just
  `WEB_ORIGIN`) get an `Access-Control-Allow-Origin` echoed back — never a wildcard.
- **Global rate limit**: 300 requests/minute/IP across the whole API (`429` when exceeded), on
  top of the stricter 10/min/IP limit on the `/auth/*` routes specifically. Both are skipped
  under `NODE_ENV=test`.
- **Body size cap**: request bodies over 1MB are rejected with `413 PAYLOAD_TOO_LARGE` (the
  receipt upload has its own, larger 5MB limit — see `POST /settlements/:id/receipt`).
- **Helmet** security headers are applied to every response, with `Cross-Origin-Resource-Policy`
  relaxed to `cross-origin` so the frontend can fetch `GET /settlements/:id/receipt` across ports
  in dev.

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
extra is stored for it. `byCurrency` is the same kind of derive-on-read view, alongside the
base-currency `net` — one row per (user, currency) with a nonzero contribution, summing
non-deleted `Expense`/`ExpensePayer`/`ExpenseSplit` original-currency amounts plus confirmed
`Settlement` amounts in that currency (no FX needed, same-currency sums don't need converting).

**Response `200`** `{ net: [{userId, name, amount}], pairwise: [{from, fromName, to, toName, amount}], byCurrency: [{userId, name, currency, amount}] }`

### `GET /groups/:id/settle-plan`

Requires membership (any role). Runs project.md §4.3's greedy max-creditor/max-debtor matching
over the group's net balances (≤ n−1 transfers, a heuristic — true minimum-transfer is NP-hard),
or the `subset` refinement for small groups (partitions into independent zero-sum subsets first;
never produces more transfers than `greedy`). `naiveCount` is the pairwise view's transfer count,
for the "N transactions → M" comparison.

**Query** `?strategy=greedy|subset` (default `greedy`)

**Response `200`** `{ strategy, transfers: [{from, fromName, to, toName, amount}], transferCount, naiveCount }`

### `GET /groups/:id/settlements`

Requires membership (any role). Not in project.md §6's literal route list, but needed for the
frontend's pending-confirmation view — the same judgment call Phase 2 made for the analogous gap
in the invite flow.

**Response `200`** `{ settlements: [Settlement] }`

### `POST /groups/:id/settlements`

Requires membership (any role). `fromUserId` is always the caller — you can only record *yourself*
as having paid, never on someone else's behalf. `currency` defaults to the group's `baseCurrency`
if omitted. `PENDING` on creation; does not touch the ledger until confirmed. Retrying the exact
same `Idempotency-Key` returns the original settlement rather than creating a second one.

**Header** `Idempotency-Key: <client-generated key>` — required.

**Body** `{ toUserId, amount, currency?, note?, settledAt? }`

**Response `201`** a `Settlement` — `{ id, groupId, fromUserId, fromUserName, toUserId, toUserName, currency, amount, baseCurrency, amountBase, fxRateToBase, note, hasReceipt, status, settledAt, createdById, createdAt }`

Errors: `400 IDEMPOTENCY_KEY_REQUIRED`, `422 INVALID_PARTICIPANT` (recipient not an active member),
`422 UNSUPPORTED_CURRENCY`, `422 VALIDATION_ERROR`.

### `POST /settlements/:id/confirm`

Requires being the settlement's `toUserId` (the receiver). Row-locks the settlement
(`SELECT ... FOR UPDATE`) before transitioning, so two concurrent confirms on the same settlement
can't both succeed — the second sees the already-`CONFIRMED` status and `409`s. Writes two
`LedgerEntry` rows (payer `+`, receiver `-`, `counterpartyId` set to the other party).

**Response `200`** the updated `Settlement`.

Errors: `403 FORBIDDEN` (not the receiver), `404 NOT_FOUND`, `409 SETTLEMENT_NOT_PENDING`.

### `POST /settlements/:id/reject`

Requires being the settlement's `toUserId`. Same row-locking as confirm; no ledger entries are
ever written for a rejected settlement.

**Response `200`** the updated `Settlement`.

Errors: `403 FORBIDDEN`, `404 NOT_FOUND`, `409 SETTLEMENT_NOT_PENDING`.

### `POST /settlements/:id/receipt`

Requires being the settlement's `fromUserId` (the payer). Multipart upload, field name `receipt`,
≤5 MB, JPEG/PNG/WEBP only — validated by magic bytes, not the client-supplied mime type. Stored
via a `StorageAdapter` (local disk in dev; S3-shaped later).

**Body** `multipart/form-data` with a `receipt` file field.

**Response `200`** the updated `Settlement` (`hasReceipt: true`).

Errors: `403 FORBIDDEN`, `404 NOT_FOUND`, `422 INVALID_RECEIPT` (wrong type or over the size limit).

### `GET /settlements/:id/receipt`

Requires membership in the settlement's group — "signed, auth-checked route, never a raw public
path" per project.md §5, satisfied here by requiring the normal `Authorization` header and a
membership check on every read; there is no static-file path serving uploads directly.

**Response `200`** the raw image bytes, with the correct `Content-Type`.

Errors: `404 NOT_FOUND`, `404 RECEIPT_NOT_FOUND` (no receipt uploaded, or the file is missing).

### `GET /groups/:id/activity`

Requires membership (any role). Cursor-paginated, newest first. Every activity type
(`GROUP_CREATED`, `MEMBER_JOINED`, `MEMBER_REMOVED`, `EXPENSE_ADDED`, `EXPENSE_EDITED`,
`EXPENSE_DELETED`, `SETTLEMENT_RECORDED`, `SETTLEMENT_CONFIRMED`, `SETTLEMENT_REJECTED`) renders
purely from its stored `payload` — never re-joined against the live `Expense`/`Settlement`/etc.
row, so a row stays fully readable after the entity it refers to is deleted.
`EXPENSE_EDITED`'s payload is `{ changes: { [field]: { before, after } } }`, listing only the
`Expense` scalar fields (`description`/`category`/`currency`/`amount`/`splitType`/`paidAt`) that
actually changed.

**Query** `?cursor&limit`

**Response `200`** `{ activities: [{ id, type, entityType, entityId, actorId, actorName, payload, createdAt }], nextCursor: string | null }`

### `GET /groups/:id/export.csv`

Requires membership (any role). Returns the group's full, unpaginated ledger as a CSV file — an
"Expenses" section (one row per non-deleted `Expense`, chronological by `paidAt`, with payers and
splits flattened into `Name: amount` sub-fields joined by `; `) followed by a "Settlements"
section (one row per `Settlement`, chronological by `settledAt`, including all statuses). Free-text
fields (`description`, `category`, `note`) are RFC 4180-escaped by a small hand-rolled writer
(`src/lib/csv.ts`) — no new dependency, per project.md rule #5. PDF export is intentionally *not*
generated server-side; the frontend's `/groups/:id/export-print` page renders a print-styled view
instead, saved to PDF via the browser's native Print dialog.

**Response `200`** `text/csv`, `Content-Disposition: attachment; filename="<group-slug>-ledger-<date>.csv"`

Errors: `404 NOT_FOUND` (non-members).

### `GET /groups/:id/recurring-expenses`

Requires membership (any role). Lists the group's recurring-expense templates (not the expenses
they've already materialized — those show up as normal `Expense` rows once created).

**Response `200`** `{ recurringExpenses: [{ id, groupId, description, category, currency, amount, splitType, splits, payers, interval, nextRunAt, active, createdById, createdAt, updatedAt }] }`

### `POST /groups/:id/recurring-expenses`

Requires membership (any role). Same `splits`/`payers` shape as
`POST /groups/:id/expenses` (project.md §4.1's split engine), minus `paidAt` — replaced by
`interval` (`WEEKLY`/`MONTHLY`/`YEARLY`) and `startAt` (the first occurrence's date, which
becomes the initial `nextRunAt`). An hourly background job (`server/src/modules/recurringExpenses/scheduler.ts`)
finds due templates and calls the same `createExpense` service function a normal `POST` would —
full split/payer computation, FX conversion, ledger entries, and activity recording, identical to
a manually-created expense. If the server was stopped past several occurrences, one tick
catches up every missed occurrence (capped at 12 per template) rather than skipping to just the
latest. A template whose stored participant has since left the group is skipped (logged, retried
next tick) rather than failing the whole batch.

**Body** `{ description, category?, currency, amount, splitType, splits: [{userId, input?}], payers: [{userId, amount?}], interval, startAt }`

**Response `201`** the created template (same shape as the list above).

Errors: `422 INVALID_PARTICIPANT`, `422 VALIDATION_ERROR`.

### `PATCH /recurring-expenses/:id`

Requires the template's creator or the group's `OWNER` (mirrors expense edit/delete
permissions). `{ active: false }` pauses it (the scheduler skips inactive templates); `{ active: true }`
resumes it from its current `nextRunAt`.

**Body** `{ active }`

**Response `200`** the updated template.

Errors: `403 FORBIDDEN`, `404 NOT_FOUND`.

### `DELETE /recurring-expenses/:id`

Requires the template's creator or the group's `OWNER`. Deletes the template only — expenses it
already materialized are real, independent `Expense` rows and are unaffected.

**Response `204`** (no body)

Errors: `403 FORBIDDEN`, `404 NOT_FOUND`.

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
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | `POST /groups/:id/settlements` without an `Idempotency-Key` header |
| `SETTLEMENT_NOT_PENDING` | 409 | confirm/reject on a settlement that's already `CONFIRMED`/`REJECTED` |
| `INVALID_RECEIPT` | 422 | receipt upload isn't a JPEG/PNG/WEBP, or exceeds 5MB |
| `RECEIPT_NOT_FOUND` | 404 | no receipt uploaded for this settlement, or the stored file is missing |
| `PAYLOAD_TOO_LARGE` | 413 | request body exceeds the 1MB cap (see Hardening, above) |
| `INTERNAL_ERROR` | 500 | unhandled error |
