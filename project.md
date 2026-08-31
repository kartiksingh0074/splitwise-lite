# Splitwise Lite — Multi-User Expense Sharing App

A group expense tracker with a correctness-first money ledger, multi-currency support, and a debt-simplification engine that reduces settlements to the minimum practical number of cash transfers.

This document is the build plan. It is written to be executed **phase by phase**. Each phase has a scope, deliverables, and a definition of done. Do not start a phase before the previous one passes its checks.

---

## 0. Rules for the implementer (read first)

1. **Money is never a float.** All amounts are stored and computed as `BIGINT` minor units (paise/cents). Formatting to decimals happens only at the UI edge.
2. **Every expense must balance.** `sum(payer amounts) == sum(split amounts) == expense total`. This is enforced in code *and* by a DB check/trigger. A request that violates it is a 422.
3. **The ledger is append-only.** Editing an expense does not mutate old ledger rows; it reverses them and writes new ones. History must be reconstructible.
4. **One phase = one working, committed, tested slice.** Don't scaffold future phases early.
5. **No new dependencies beyond the listed stack** without a one-line justification in the commit message.
6. Write tests as described in each phase. Money math without tests is not done.
7. Keep the API contract in `docs/api.md` updated as you go.

---

## 1. Tech stack

**Backend**
- Node.js 20+, TypeScript, Express 5
- Prisma ORM + PostgreSQL 16
- Zod for request validation
- JWT auth (access + refresh), Argon2 password hashing
- Multer + local disk storage in dev (S3-compatible adapter interface for later)
- Vitest + Supertest for tests
- Pino for structured logs

**Frontend**
- React 18 + Vite + TypeScript
- Zustand for client state (balances, split builder, optimistic UI)
- TanStack Query for server state
- React Router v6
- Tailwind CSS
- react-hook-form + Zod (shared schema definitions where practical)

**Infra (dev)**
- Docker Compose: `postgres`, `adminer`
- `.env` per app, validated at boot with Zod

---

## 2. Repository layout

```
splitwise-lite/
├─ docker-compose.yml
├─ docs/
│  ├─ api.md
│  └─ decisions.md          # short ADRs: rounding, fx, simplification
├─ server/
│  ├─ prisma/
│  │  ├─ schema.prisma
│  │  └─ seed.ts
│  ├─ src/
│  │  ├─ index.ts
│  │  ├─ app.ts
│  │  ├─ config/env.ts
│  │  ├─ db/client.ts
│  │  ├─ middleware/        # auth, error handler, rate limit, requestId
│  │  ├─ modules/
│  │  │  ├─ auth/
│  │  │  ├─ users/
│  │  │  ├─ groups/
│  │  │  ├─ expenses/
│  │  │  ├─ balances/
│  │  │  ├─ settlements/
│  │  │  └─ activity/
│  │  ├─ domain/
│  │  │  ├─ money.ts        # minor-unit helpers, formatting
│  │  │  ├─ split.ts        # split engine
│  │  │  ├─ simplify.ts     # debt simplification
│  │  │  └─ fx.ts
│  │  └─ types/
│  └─ tests/
└─ web/
   ├─ src/
   │  ├─ main.tsx
   │  ├─ routes/
   │  ├─ components/
   │  ├─ features/          # mirrors server modules
   │  ├─ stores/            # zustand
   │  ├─ lib/api.ts
   │  └─ lib/money.ts
   └─ index.html
```

---

## 3. Data model

Written as Prisma-flavoured pseudo-schema. `id` fields are UUIDv7 where possible.

```
User
  id, email (citext, unique), name, passwordHash, avatarUrl?, createdAt

RefreshToken
  id, userId → User, tokenHash, expiresAt, revokedAt?

Group
  id, name, baseCurrency (char3), createdById → User, createdAt, archivedAt?

GroupMember
  groupId → Group, userId → User, role ("OWNER" | "MEMBER"),
  joinedAt, leftAt?
  @@id([groupId, userId])

GroupInvite
  id, groupId, code (unique), createdById, expiresAt, usedById?

Expense
  id, groupId → Group, description, category?,
  currency (char3), amountMinor (BigInt),
  fxRateToBase (Decimal 18,8), amountBaseMinor (BigInt),
  splitType ("EQUAL" | "EXACT" | "PERCENT" | "SHARES"),
  paidAt, createdById, version (Int, default 1),
  deletedAt?, createdAt, updatedAt

ExpensePayer                       # supports multiple payers on one expense
  expenseId → Expense, userId → User,
  amountMinor, amountBaseMinor
  @@id([expenseId, userId])

ExpenseSplit
  expenseId → Expense, userId → User,
  shareInput (Decimal?)            # raw % or share weight, for re-editing
  amountMinor, amountBaseMinor
  @@id([expenseId, userId])

Settlement
  id, groupId, fromUserId → User, toUserId → User,   # self-referential pair
  currency, amountMinor, fxRateToBase, amountBaseMinor,
  note?, receiptUrl?, status ("PENDING" | "CONFIRMED" | "REJECTED"),
  settledAt, createdById, idempotencyKey (unique), createdAt

LedgerEntry                        # append-only source of truth for balances
  id, groupId, userId → User,
  counterpartyId → User?,          # set for settlements, null for expenses
  amountBaseMinor (BigInt, signed), # + = owed to them, - = they owe
  sourceType ("EXPENSE" | "EXPENSE_REVERSAL" | "SETTLEMENT" | "SETTLEMENT_REVERSAL"),
  sourceId, createdAt
  @@index([groupId, userId])

Activity
  id, groupId, actorId → User, type, entityType, entityId,
  payload (Jsonb), createdAt
  @@index([groupId, createdAt])
```

**Invariants**
- For any `sourceId`, `SUM(LedgerEntry.amountBaseMinor) = 0`.
- `SUM(ExpenseSplit.amountMinor) = Expense.amountMinor` and same for `ExpensePayer`.
- A user's group balance = `SUM(LedgerEntry.amountBaseMinor)` filtered by group + user.

**Why a ledger table and not computed-on-the-fly sums:** edits and deletions stay auditable, settlements and expenses use one uniform balance path, and the activity feed can point at real rows.

---

## 4. Core algorithms

### 4.1 Split engine (`domain/split.ts`)

Input: `totalMinor: bigint`, `participants: userId[]`, `splitType`, `inputs`.
Output: `Map<userId, bigint>` summing **exactly** to `totalMinor`.

- **EQUAL** — `base = total / n` (floor), `remainder = total - base*n`. Distribute the remaining `r` minor units, one each, to participants sorted deterministically (`userId` ascending, rotated by `hash(expenseId) % n` so the same person doesn't always eat the extra paisa).
- **EXACT** — inputs are minor units. Reject unless they sum exactly to total.
- **PERCENT** — inputs are percentages, must sum to 100 (tolerance 0.01). Compute `floor(total * pct / 100)`, then apply **largest-remainder method** for leftover units.
- **SHARES** — integer weights. `floor(total * w_i / Σw)`, then largest-remainder.

Same function computes payer allocations when there are multiple payers.

### 4.2 FX handling (`domain/fx.ts`)

- Every group has a `baseCurrency`. Every expense stores its original currency **and** a snapshotted `fxRateToBase`.
- Rates are snapshotted at expense creation and never re-fetched — historical balances must not drift.
- Phase 3 uses a static rate table in config. Phase 8 swaps in a rates provider behind the same interface with a daily cache.
- Balances and simplification always run in base currency.

### 4.3 Debt simplification (`domain/simplify.ts`)

Input: net balances per user (signed, base minor units, summing to 0).
Output: list of `{ from, to, amountMinor }`.

Greedy max-creditor / max-debtor:

```
function simplify(balances):
  creditors = max-heap of (user, amount) where amount > 0
  debtors   = max-heap of (user, amount) where amount < 0, keyed by |amount|
  transfers = []

  while creditors and debtors not empty:
    c = creditors.pop()
    d = debtors.pop()
    amount = min(c.amount, d.amount)
    transfers.push({ from: d.user, to: c.user, amount })
    if c.amount - amount > 0: creditors.push(c.amount - amount)
    if d.amount - amount > 0: debtors.push(d.amount - amount)

  return transfers
```

Properties to state in `docs/decisions.md` and in code comments:
- Each iteration zeroes at least one participant → **at most `n-1` transfers**.
- The true minimum is NP-hard (reduces to set partition), so this greedy is a heuristic, not an optimum.
- **Optional refinement for small groups (`n ≤ 12`):** first find zero-sum subsets via bitmask DP and run the greedy independently inside each subset. This produces strictly fewer or equal transfers and is a good thing to demo. Ship it behind a flag in Phase 4.

Also expose the **unsimplified** pairwise view (who owes whom directly, derived from expense participation), because users often want to see both. Store nothing extra for it — derive on read.

---

## 5. Permissions matrix

| Action | Non-member | Member | Expense creator | Group owner |
|---|---|---|---|---|
| View group, expenses, balances | ✗ | ✓ | ✓ | ✓ |
| Add expense | ✗ | ✓ | ✓ | ✓ |
| Edit / delete expense | ✗ | ✗ | ✓ | ✓ |
| Record settlement (as payer) | ✗ | ✓ | ✓ | ✓ |
| Confirm settlement | ✗ | receiver only | receiver only | receiver only |
| Invite / remove member | ✗ | ✗ | ✗ | ✓ |
| Rename / archive group | ✗ | ✗ | ✗ | ✓ |

Enforce with a `requireGroupRole(role)` middleware that loads membership once and attaches it to `req.membership`. A member with a non-zero balance **cannot** be removed from a group.

---

## 6. API surface

All routes prefixed `/api/v1`. Auth via `Authorization: Bearer <access>`.

```
POST   /auth/register            { email, name, password }
POST   /auth/login               { email, password }
POST   /auth/refresh             { refreshToken }
POST   /auth/logout
GET    /users/me
PATCH  /users/me

GET    /groups
POST   /groups                   { name, baseCurrency, memberEmails[] }
GET    /groups/:id
PATCH  /groups/:id
POST   /groups/:id/invites
POST   /invites/:code/accept
DELETE /groups/:id/members/:userId

GET    /groups/:id/expenses      ?cursor&limit&paidBy&from&to
POST   /groups/:id/expenses
GET    /expenses/:id
PATCH  /expenses/:id             (requires If-Match: <version>)
DELETE /expenses/:id

GET    /groups/:id/balances      -> per-member net + pairwise view
GET    /groups/:id/settle-plan   ?strategy=greedy|subset

POST   /groups/:id/settlements   (Idempotency-Key header required)
POST   /settlements/:id/confirm
POST   /settlements/:id/reject
POST   /settlements/:id/receipt  (multipart)

GET    /groups/:id/activity      ?cursor&limit
```

Error shape everywhere:
```json
{ "error": { "code": "SPLIT_MISMATCH", "message": "...", "details": {} } }
```

---

## Phase 0 — Foundation

**Scope**
- Monorepo with `server/` and `web/`, npm workspaces.
- Docker Compose for Postgres. `.env.example` for both apps, Zod-validated env loader.
- Express app skeleton: request-id middleware, Pino logger, centralised error handler, `GET /health`.
- Vite React app with Tailwind, router, and a placeholder shell.
- Prisma initialised and connected; empty migration runs clean.
- ESLint + Prettier + `npm run check` at the root.

**Done when:** `docker compose up`, `npm run dev` in both apps, `GET /api/v1/health` returns 200, frontend renders and can call it.

---

## Phase 1 — Auth & users

**Scope**
- `User` and `RefreshToken` models + migration.
- Register / login / refresh / logout. Argon2 hashing. Access token 15 min, refresh token 30 days, rotated on use, hash-at-rest.
- `requireAuth` middleware → `req.user`.
- Rate limit auth routes (10/min/IP).
- Frontend: login and register pages, auth Zustand store, axios/fetch wrapper with 401 → silent refresh → retry, protected route wrapper.

**Tests:** register duplicate email → 409; login wrong password → 401; expired access token refresh flow; revoked refresh token rejected.

**Done when:** a user can register, refresh across a page reload, and log out; token rotation is verified by a test.

---

## Phase 2 — Groups & membership

**Scope**
- `Group`, `GroupMember`, `GroupInvite` models.
- Create group with base currency and initial members by email (existing users only for now; unregistered emails create a pending invite).
- Invite code generation + accept flow.
- `requireGroupRole` middleware and the full permissions matrix from §5.
- Remove member — blocked if their balance ≠ 0 (stub the balance check now, wire it in Phase 4).
- Frontend: groups list, create-group form, group detail shell with tabs (Expenses / Balances / Activity), member list with roles.

**Tests:** non-member gets 404 (not 403 — don't leak existence); member cannot rename group; owner can.

---

## Phase 3 — Expenses & the split engine

This is the heart of the app. Build `domain/split.ts` and `domain/money.ts` **first, with tests, before any route**.

**Scope**
- `Expense`, `ExpensePayer`, `ExpenseSplit`, `LedgerEntry` models.
- `domain/money.ts`: parse/format minor units, currency metadata (decimal places — note JPY has 0), safe add/sub.
- `domain/split.ts` implementing all four split types per §4.1.
- `domain/fx.ts` with a static rate table and a `RateProvider` interface.
- `POST /groups/:id/expenses` in a single DB transaction: validate → compute splits → create expense rows → write ledger entries → write activity.
- `PATCH /expenses/:id` with optimistic locking via `If-Match: <version>`; writes reversal ledger entries then fresh ones; bumps version.
- `DELETE /expenses/:id` → soft delete + reversal entries.
- Cursor-paginated expense list with filters.
- Frontend: expense list, add/edit expense modal with a split builder (tabs for equal / exact / % / shares), live "remaining to allocate" indicator computed in Zustand, multi-payer picker.

**Tests (non-negotiable):**
- 100.00 split equally among 3 → `[33.34, 33.33, 33.33]`, sums exactly.
- Percent split 33.33/33.33/33.34 rounding.
- Exact split not summing to total → 422 `SPLIT_MISMATCH`.
- Multi-payer expense: payers sum must equal total.
- Property test: for random totals and 2–10 participants, split output always sums to input, for all four types.
- Edit expense → ledger entries for that expense sum to 0.
- Stale `If-Match` version → 409.

---

## Phase 4 — Balances & debt simplification

**Scope**
- `GET /groups/:id/balances` — per-member net from `LedgerEntry`, plus a derived pairwise "who owes whom" view.
- `domain/simplify.ts` — greedy heap algorithm from §4.3, plus the subset-partition refinement behind `?strategy=subset` for `n ≤ 12`.
- `GET /groups/:id/settle-plan` returning the transfer list, transfer count, and the naive count for comparison ("12 transactions → 4").
- Wire the real balance check into member removal from Phase 2.
- Frontend: Balances tab with per-member cards (green owed / red owes), a settle-plan panel showing simplified transfers, and a toggle between simplified and direct views. Keep the arithmetic in a Zustand selector so toggling is instant with no refetch.

**Tests:**
- Balances always sum to zero across a group.
- Circular debt A→B→C→A of equal size collapses to **zero** transfers.
- Chain A owes B 50, B owes C 50 → one transfer A→C 50.
- Transfer count ≤ n−1 for random balance sets (property test, 500 cases).
- Every simplification output, when applied, zeroes all balances.
- Subset strategy never produces more transfers than greedy.

---

## Phase 5 — Settle-up workflow

**Scope**
- `Settlement` model with two-step flow: payer records → receiver confirms. `PENDING` settlements do **not** move the ledger; `CONFIRMED` writes ledger entries; `REJECTED` closes it out. Add a config flag for auto-confirm in single-user demo mode.
- `Idempotency-Key` header required on create; unique constraint prevents double-recording a payment on a retry.
- Row-level locking (`SELECT ... FOR UPDATE` on group ledger) inside the confirm transaction so two concurrent confirms can't over-settle.
- Receipt upload: multipart, ≤5 MB, `image/jpeg|png|webp` only, validated by magic bytes not just mime; stored via a `StorageAdapter` interface (local disk now, S3 later); served through a signed, auth-checked route — never a raw public path.
- Frontend: "Settle up" flow pre-filled from the settle-plan, amount override, receipt picker with preview, pending-confirmation badges.

**Tests:** duplicate idempotency key returns the original settlement, not a second one; concurrent confirms — one wins, one 409; non-receiver cannot confirm; oversized/wrong-type upload rejected.

---

## Phase 6 — Activity history

**Scope**
- Emit `Activity` rows from every mutating handler via a small `recordActivity(tx, ...)` helper called **inside** the same transaction.
- Types: `EXPENSE_ADDED`, `EXPENSE_EDITED`, `EXPENSE_DELETED`, `SETTLEMENT_RECORDED`, `SETTLEMENT_CONFIRMED`, `SETTLEMENT_REJECTED`, `MEMBER_JOINED`, `MEMBER_REMOVED`, `GROUP_CREATED`.
- Payload stores a human-readable snapshot (description, amount, currency, actor name) so the feed renders without N+1 joins and stays readable after the entity is deleted.
- For edits, store a before/after diff of changed fields.
- Cursor-paginated feed endpoint.
- Frontend: chronological activity tab, grouped by day, with infinite scroll and per-entry links.

**Test:** an expense edit produces exactly one activity row with a correct diff, and it survives deletion of the expense.

---

## Phase 7 — Multi-currency polish & UX

**Scope**
- Real rate provider behind `RateProvider` with a daily-cached table and a fallback to the last-known rate; still snapshotted per expense.
- Show both original and base amounts in the UI (`₹4,150 (€45.00)`).
- Per-currency breakdown on the balances screen alongside the base-currency net.
- Empty states, loading skeletons, optimistic add-expense with rollback, toast errors mapped from the API error codes.
- Mobile-responsive pass on all screens.

---

## Phase 8 — Hardening & delivery

**Scope**
- Seed script: 5 users, 2 groups, ~40 expenses across 3 currencies, a few settlements — enough for the simplification demo to look impressive.
- Integration test covering the full lifecycle: create group → 10 expenses → check balances → settle plan → settle all → all balances zero.
- Indexes reviewed: `(groupId, createdAt)` on expenses and activity, `(groupId, userId)` on ledger entries. Add `EXPLAIN ANALYZE` output for the balances query to `docs/decisions.md`.
- N+1 audit on group detail and activity feed.
- Helmet, CORS allowlist, global rate limit, request size caps.
- `docs/api.md` complete; README with setup, architecture diagram, and a short write-up of the simplification algorithm and its complexity.
- Dockerfiles for both apps; one-command startup.

**Done when:** a fresh clone reaches a seeded, working app with one command, and the full test suite passes.

---

## 7. Stretch goals (only after Phase 8)

- Recurring expenses (monthly rent) via a scheduled job.
- OCR receipt parsing to prefill amount and merchant.
- Simplification "explain" view animating the greedy heap steps — strong demo material.
- Export group ledger to CSV/PDF.
- Realtime balance updates over WebSockets when a group member adds an expense.
- Payment-gateway settle-up (UPI/Razorpay link) instead of cash-only marking.

---

## 8. Definition of done for the whole project

- Balances always sum to zero in every group, under every sequence of adds, edits, deletes, and settlements.
- No floating-point arithmetic anywhere in the money path.
- Settle-plan output, when executed, always zeroes the group.
- Permissions enforced server-side on every route, not just hidden in the UI.
- Test coverage on `domain/` at 100% of branches; overall backend coverage ≥ 80%.
