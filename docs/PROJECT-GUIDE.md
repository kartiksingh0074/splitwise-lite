# Understanding Splitwise Lite

A guided tour for someone who has just cloned this repo and needs to understand it properly —
what to know before reading the code, what order to read it in, and how to deploy it.

If you want the diagrams (ER, DFD, architecture), they're in the [README](../README.md). This
document is the *human* path through the project: what to learn, in what order, and why.

---

## Table of contents

1. [The one-paragraph mental model](#1-the-one-paragraph-mental-model)
2. [Tech stack you need to know](#2-tech-stack-you-need-to-know)
3. [The four ideas that explain the whole codebase](#3-the-four-ideas-that-explain-the-whole-codebase)
4. [A guided reading path through the source](#4-a-guided-reading-path-through-the-source)
5. [Tracing one request end to end](#5-tracing-one-request-end-to-end)
6. [Running it locally and experimenting](#6-running-it-locally-and-experimenting)
7. [Gotchas that will bite you](#7-gotchas-that-will-bite-you)
8. [Glossary](#8-glossary)
9. [How to deploy it](#9-how-to-deploy-it)

---

## 1. The one-paragraph mental model

Splitwise Lite tracks shared expenses in groups. When someone pays for something, the app records
**who paid** and **who owes** — separately, because they aren't the same people. Those two sides are
converted into signed entries in an **append-only ledger**. A person's balance is never stored; it
is always recomputed by summing their ledger rows. When the group wants to settle up, a
**simplification algorithm** collapses the resulting web of debts into the fewest practical cash
transfers. Every amount, everywhere, is an integer number of paise/cents — never a float.

If you understand that paragraph, the rest is mechanics.

---

## 2. Tech stack you need to know

You don't need to be expert in all of this. Here's the honest minimum, tiered.

### Tier 1 — you genuinely need these

| Technology | Why it's here | What you actually need to know |
|---|---|---|
| **TypeScript** | Everything, both sides | Interfaces/types, generics at a basic level, `strict` null handling. You do **not** need advanced type gymnastics. |
| **Node.js 20+** | Server runtime | ESM imports (note the `.js` extensions in TS imports — that's required for Node ESM), `async`/`await`, promises. |
| **SQL / relational modelling** | The whole design rests on it | Joins, indexes, `GROUP BY` + aggregates, transactions, what `ACID` means in practice. This is the highest-leverage thing to know here. |
| **React 18** | The entire frontend | Function components, hooks (`useState`, `useEffect`, `useMemo`), props, lists and keys. No class components anywhere. |
| **HTTP / REST** | The API contract | Verbs, status codes (especially `409`, `422`, `404` vs `403`), headers, what `Authorization: Bearer` means. |

### Tier 2 — read the docs for an hour, you'll be fine

| Technology | Why it's here | What to focus on |
|---|---|---|
| **Express 5** | HTTP framework | Middleware chaining, `Router`, error-handling middleware (4-arg signature). Express 5 auto-forwards async errors — Express 4 didn't. |
| **Prisma** | ORM + migrations | `schema.prisma` syntax, `prisma migrate`, `prisma generate`, `$transaction`, and that it returns `BigInt` for `BIGINT` columns. |
| **Zod** | Validation, both sides | `z.object`, `.parse` vs `.safeParse`, `.transform`. Used for request bodies **and** for validating environment variables at boot. |
| **JWT** | Auth | Access vs refresh tokens, why refresh tokens are hashed at rest and rotated on use. |
| **Zustand** | Frontend state | `create()`, selectors, and critically: a selector must return a **stable reference** or React re-renders forever. |
| **Vitest + Supertest** | Tests | `describe`/`it`/`expect`, and Supertest's `request(app).post(...)` style. Near-identical to Jest. |
| **Tailwind CSS** | All styling | Utility classes. No custom CSS files to learn. |

### Tier 3 — you can look these up when you hit them

- **React Router v6** — route definitions, `useParams`, `useNavigate`, nested routes.
- **Data fetching** — there is **no** server-state library here. [`project.md`](../project.md)
  planned TanStack Query, but it was never installed; pages fetch with `useEffect` + `useState`
  over the typed helpers in `features/*/api.ts`. Worth knowing so you don't go looking for a
  query cache that doesn't exist.
- **react-hook-form** — `useForm`, `register`, and the Zod resolver bridging it to Tier 2's Zod.
- **Vite** — dev server + build. Note `VITE_`-prefixed env vars are **baked in at build time**, not read at runtime.
- **Docker / Compose** — `up`, `build`, multi-stage Dockerfiles, named volumes.
- **WebSockets (`ws`)** — used for one narrow thing: pushing "this group changed" to open clients.
- **Pino** — structured JSON logging.
- **Argon2** — password hashing. You need to know *that* it's used and that it's the right choice, not how it works internally.

### What you explicitly do NOT need

No Redux, no GraphQL, no Kubernetes, no microservices, no message queue, no Next.js. This is a
deliberately boring, single-service monolith with a SPA in front of it — the complexity is in the
**money correctness**, not the infrastructure.

---

## 3. The four ideas that explain the whole codebase

### Idea 1 — money is an integer, always

A float can't represent `0.10` exactly. Add it up enough times and your books don't balance. So:

- Every amount is a `BIGINT` in **minor units** — paise, cents. `₹20.00` is `2000n`.
- The API exchanges **decimal strings** (`"20.00"`), never JSON numbers.
- Conversion between the two happens in exactly one place: `domain/money.ts`.
- Currencies differ in decimal places — JPY has **0**, not 2 — so the conversion is
  currency-aware, never a hardcoded `× 100`.

**Rule to internalise:** if you see arithmetic on a money value outside `domain/`, that's a bug.

### Idea 2 — the ledger is append-only

There is no `balance` column anywhere. Instead, `LedgerEntry` holds signed amounts, and:

- Adding an expense **inserts** entries that sum to zero.
- Editing an expense does **not** update those rows. It inserts `EXPENSE_REVERSAL` entries that
  cancel the originals, then inserts fresh `EXPENSE` entries.
- Deleting soft-deletes the expense and inserts reversal entries.

So history is fully reconstructible, and every balance traces to real rows. The cost is more rows;
the benefit is that you can never silently corrupt a balance with a bad `UPDATE`.

**The invariant that holds everything together:** for any `sourceId`, the ledger entries sum to
**exactly zero**. If a group's balances don't sum to zero, something violated this — and there are
tests specifically for it.

### Idea 3 — splitting is a remainder-distribution problem

Split `₹100.00` equally among 3 people. `10000 / 3 = 3333.33...` — but you can't pay a third of a
paisa. Someone has to absorb the extra unit.

`domain/split.ts` handles all four split types by computing floors and then distributing the
remainder deterministically:

- **EQUAL** — floor, then hand out the leftover minor units one each, to participants sorted by
  `userId` but **rotated by a hash of the expense id**, so the same unlucky person doesn't eat the
  extra paisa on every single expense.
- **EXACT** — caller supplies minor units; rejected with `422 SPLIT_MISMATCH` unless they sum exactly.
- **PERCENT** — must sum to 100 (±0.01); leftover distributed by **largest-remainder method**.
- **SHARES** — integer weights; same largest-remainder treatment.

The same function computes **payer** allocations, because multiple people can pay for one expense.
Output always sums to exactly the input — that's property-tested against random inputs.

### Idea 4 — simplification is a heuristic, and we're honest about it

After all the netting, you have a set of balances summing to zero. Finding the **true** minimum
number of transfers is NP-hard (it reduces to set partition). So the app ships two approximations —
greedy max-creditor/max-debtor matching (`O(n² log n)`, at most `n−1` transfers), and a subset
partition refinement for small groups (`O(3ⁿ)`, never worse than greedy).

Full explanation with complexity analysis is in the [README](../README.md#the-debt-simplification-algorithm).
The point for a reader: **this is the interesting part of the project**, and the code says clearly
that it's a heuristic rather than pretending to be optimal.

---

## 4. A guided reading path through the source

Read in this order. Each step builds on the last. Budget roughly a focused afternoon.

### Step 1 — the contract (15 min)

- [`docs/api.md`](api.md) — skim the endpoint list to learn the vocabulary.
- [`docs/decisions.md`](decisions.md) — the ADRs. Short, and explains *why* rather than *what*.
- [`server/prisma/schema.prisma`](../server/prisma/schema.prisma) — all 12 models in one file.
  Read this slowly; it is the spine of the project.

### Step 2 — the pure core (60 min, the most important step)

Read these with their tests open side by side. They have **no dependencies** — no database, no
Express — so you can understand them in isolation:

| Read | Then its test |
|---|---|
| [`server/src/domain/money.ts`](../server/src/domain/money.ts) | `server/tests/money.test.ts` |
| [`server/src/domain/split.ts`](../server/src/domain/split.ts) | `server/tests/split.test.ts` |
| [`server/src/domain/simplify.ts`](../server/src/domain/simplify.ts) | `server/tests/simplify.test.ts` |
| [`server/src/domain/fx.ts`](../server/src/domain/fx.ts) | `server/tests/fx.test.ts` |

These four files are 100% branch-covered. If you understand them, you understand the product.

### Step 3 — the plumbing (30 min)

- [`server/src/app.ts`](../server/src/app.ts) — the middleware chain and every mounted route, in
  ~60 lines. The best single-file overview of the backend.
- [`server/src/config/env.ts`](../server/src/config/env.ts) — env vars validated with Zod at boot,
  so a misconfigured deploy fails immediately instead of at 3am.
- [`server/src/middleware/requireGroupRole.ts`](../server/src/middleware/requireGroupRole.ts) — the
  entire permissions matrix funnels through here.
- [`server/src/middleware/errorHandler.ts`](../server/src/middleware/errorHandler.ts) — how thrown
  errors become the uniform `{ error: { code, message, details } }` shape.

### Step 4 — the write path (45 min)

- [`server/src/modules/expenses/service.ts`](../server/src/modules/expenses/service.ts) — the
  heart of the backend. Look specifically at `createExpense` (the transaction), `updateExpense`
  (reversal + optimistic locking via `If-Match`), and `deleteExpense`.
- [`server/src/modules/balances/service.ts`](../server/src/modules/balances/service.ts) — how the
  ledger becomes balances, a pairwise view, and a settle plan.
- [`server/src/modules/settlements/service.ts`](../server/src/modules/settlements/service.ts) — the
  two-step confirm flow, idempotency keys, and row-level locking.

### Step 5 — the frontend (45 min)

- [`web/src/lib/api.ts`](../web/src/lib/api.ts) — the fetch wrapper. Note the `401 → silent
  refresh → retry` flow; this is why sessions survive a page reload.
- [`web/src/stores/`](../web/src/stores/) — five small Zustand stores. Start with `authStore.ts`,
  then `balancesStore.ts` (see how selectors avoid refetching when toggling views).
- [`web/src/routes/GroupDetailPage.tsx`](../web/src/routes/GroupDetailPage.tsx) — the busiest
  screen, ties everything together.
- [`web/src/routes/ExpenseFormPage.tsx`](../web/src/routes/ExpenseFormPage.tsx) — the split builder
  with its live "remaining to allocate" indicator.

### Step 6 — the proof (20 min)

- [`server/tests/lifecycle.test.ts`](../server/tests/lifecycle.test.ts) — reads like a
  specification: create a group → add expenses → check balances → get a settle plan → settle
  everything → assert all balances are exactly zero.

---

## 5. Tracing one request end to end

Pick "add a ₹1,200 dinner split equally among 4" and follow it:

1. **`ExpenseFormPage.tsx`** — react-hook-form collects input; Zod validates client-side; the
   `expenseFormStore` tracks "remaining to allocate" live.
2. **`features/expenses/api.ts`** → **`lib/api.ts`** — POST with the access token attached. Amount
   goes over the wire as the string `"1200.00"`.
3. **`app.ts` middleware chain** — request id → log → helmet → CORS → rate limit → JSON body cap.
4. **`requireAuth`** — verifies the JWT, sets `req.user`.
5. **`requireGroupRole('MEMBER')`** — one membership query, attached to `req.membership`.
   Non-member? `404`, not `403`.
6. **`validate(createExpenseSchema)`** — Zod re-validates server-side. Never trust the client.
7. **`expenses/service.ts → createExpense`**:
   - `assertActiveMembers` — every payer and participant actually belongs to the group.
   - `domain/fx.ts` — snapshot the rate, convert to base currency.
   - `domain/split.ts` — `computeSplit()` returns `{A: 30000n, B: 30000n, C: 30000n, D: 30000n}`.
   - **One transaction:** insert `Expense`, `ExpensePayer[]`, `ExpenseSplit[]`, `LedgerEntry[]`,
     and the `Activity` row.
   - The deferred DB trigger revalidates the sums at COMMIT.
8. **After commit** — `broadcastGroupChanged(groupId)` pushes over WebSocket to other open clients.
9. **Back in the browser** — the page re-runs its loader, balances refetch, a toast fires.

Now do the same trace for `GET /groups/:id/settle-plan` and you've seen both directions.

---

## 6. Running it locally and experimenting

Setup instructions are in the [README](../README.md#quick-start). Once it's running, these
experiments teach more than reading does:

1. **Seed, then open Adminer** at `http://localhost:8080` and look at `LedgerEntry`. Sum
   `amountBaseMinor` per group — it's zero. Every time.
2. **Add an expense, then edit it.** Watch the ledger: the old rows are still there, plus reversal
   rows, plus new ones. Nothing was updated in place.
3. **Try to break a split.** Send an EXACT split that doesn't sum to the total. You get
   `422 SPLIT_MISMATCH` from the service — and even if you bypassed it, the DB trigger would refuse.
4. **Compare strategies.** Hit `settle-plan?strategy=greedy` and `?strategy=subset` on a seeded
   group and compare `transferCount` against `naiveCount`.
5. **Open the explain view** (`SimplifyExplainPage`) to watch the greedy algorithm step through.
6. **Open two browser windows** on the same group, add an expense in one, watch the other update
   over WebSocket.

### Running the tests safely

```bash
# from server/
TEST_DATABASE_URL="postgresql://splitwise:splitwise@localhost:5432/splitwise_test?schema=public" \
  npx vitest run --coverage
```

The suite truncates every table before each test. **Always** point `TEST_DATABASE_URL` at a
separate database, or you'll wipe your seed data.

---

## 7. Gotchas that will bite you

| Gotcha | What happens | Why |
|---|---|---|
| `BigInt` isn't JSON-serialisable | `TypeError` on `res.json()` | `BIGINT` columns come back as `bigint`. Format to a decimal string at the edge. |
| `.js` extensions on TS imports | Module-not-found at runtime | Node ESM requires them, even though the source is `.ts`. |
| Zustand selectors returning `[]` | Infinite re-render loop | A fresh array each call is a new reference; React sees a changed snapshot forever. Return a shared constant. |
| `VITE_` vars are build-time | Prod build points at localhost | Vite inlines them at build. Rebuild the image to change the API URL. |
| Tests wipe the database | Seed data gone | `tests/setup.ts` truncates in `beforeEach`. Use `TEST_DATABASE_URL`. |
| Non-member gets `404` not `403` | Looks like a bug; isn't | Deliberate — `403` would confirm the group exists. |
| Editing needs `If-Match: <version>` | `409` on a stale edit | Optimistic locking. Fetch the expense first and send its `version`. |
| `PENDING` settlements don't move the ledger | Balance "didn't change" after settling | By design. The receiver must confirm. |

---

## 8. Glossary

- **Minor units** — the smallest indivisible amount of a currency. Paise for INR, cents for USD.
  `₹20.00` = `2000` minor units. JPY has none (0 decimal places).
- **Base currency** — the group's reference currency. All balances and simplification run in it.
- **`fxRateToBase`** — the exchange rate **snapshotted at expense creation** and never refreshed, so
  historical balances don't drift when rates move.
- **Ledger entry** — one signed row. Positive = owed **to** this person; negative = this person owes.
- **Reversal** — a ledger entry that cancels an earlier one, written on edit/delete instead of
  mutating history.
- **Pairwise view** — raw "who owes whom" before simplification. Derived on read, never stored.
- **Settle plan** — the simplified transfer list that zeroes the group.
- **Naive count** — how many transfers the unsimplified pairwise view would need. The number the
  settle plan is compared against for the "12 → 4" headline.
- **Idempotency key** — a client-supplied unique header on settlement creation, so a retried request
  returns the original settlement instead of recording a second payment.
- **Optimistic locking** — the `version` column plus `If-Match`; a stale edit gets `409` instead of
  silently clobbering someone else's change.
- **Soft delete** — `deletedAt` is set; the row survives so history stays reconstructible.

---

## 9. How to deploy it

> **This project has not been deployed.** Everything below is the intended path, written so it can
> be followed later without rediscovering the details. It has been verified only as far as the local
> Docker build — treat the hosted-platform steps as a plan, not a tested runbook.

### 9.1 What you're deploying

Three things, and they can live in three different places:

| Piece | Artifact | Suitable hosts |
|---|---|---|
| **Database** | Managed PostgreSQL 16 | Neon, Supabase, Railway, RDS |
| **API** | Docker image from [`server/Dockerfile`](../server/Dockerfile) | Railway, Render, Fly.io, ECS |
| **Web** | Static bundle from [`web/Dockerfile`](../web/Dockerfile) | Vercel, Netlify, Cloudflare Pages, or the same container host |

Both Dockerfiles are multi-stage and take the **repo root** as build context — that's required,
because npm workspaces needs every workspace's `package.json` to match the root lockfile.

### 9.2 Before you deploy anything — the production checklist

These are not optional. The dev defaults are deliberately insecure.

- [ ] **Generate a real `JWT_ACCESS_SECRET`.** The committed value is a placeholder. Use
      `openssl rand -base64 48`. Anyone with this secret can mint tokens for any user.
- [ ] **Set `NODE_ENV=production`.**
- [ ] **Set a strong database password** and require TLS (`?sslmode=require` on the connection string).
- [ ] **Set `CORS_ALLOWED_ORIGINS`** to your real web origin. Never `*`.
- [ ] **Set `AUTO_CONFIRM_SETTLEMENTS=false`** — `true` is a demo-only shortcut that skips the
      receiver's confirmation.
- [ ] **Move receipt storage off local disk.** `LocalDiskStorageAdapter` writes to a container
      filesystem that vanishes on redeploy. Implement the `StorageAdapter` interface against S3 or
      equivalent — the interface exists precisely for this swap.
- [ ] **Terminate TLS** at the platform/load balancer.
- [ ] **Confirm rate limits** suit real traffic (`globalRateLimit`, plus the tighter auth-route limit).
- [ ] **Ship logs somewhere.** Pino emits structured JSON to stdout; point it at your log sink.
- [ ] **Do not run the seed script** against production.

### 9.3 Environment variables

**Server** (all validated by Zod at boot — a missing or malformed one crashes immediately, on
purpose):

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string; add `?sslmode=require` in prod |
| `JWT_ACCESS_SECRET` | yes | **Min 32 chars.** Generate fresh, never reuse the dev value |
| `PORT` | no | Defaults to `4000`; most platforms inject their own |
| `NODE_ENV` | no | Set to `production` |
| `LOG_LEVEL` | no | `info` is a sensible prod default |
| `WEB_ORIGIN` | no | Your deployed frontend URL |
| `CORS_ALLOWED_ORIGINS` | no | Comma-separated allowlist; falls back to `WEB_ORIGIN` |
| `UPLOAD_DIR` | no | Only meaningful with the local-disk storage adapter |
| `AUTO_CONFIRM_SETTLEMENTS` | no | Keep `false` in production |

**Web** — note that Vite inlines `VITE_`-prefixed variables **at build time**:

| Variable | Notes |
|---|---|
| `VITE_API_BASE_URL` | e.g. `https://api.yourdomain.com/api/v1`. Passed as a Docker **build arg**, not a runtime env var — changing it means rebuilding the image. |

### 9.4 Migrations

The server image runs migrations automatically on start:

```dockerfile
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
```

`migrate deploy` applies pending migrations without prompting and never resets data — it's the
correct production command (`migrate dev` is not; it can drop and recreate). If you'd rather gate
migrations behind an explicit release step, strip it from `CMD` and run it as a pre-deploy job.

### 9.5 A concrete path (managed Postgres + container host)

```bash
# 1. Provision a managed Postgres 16, copy its connection string.

# 2. Build and push the API image (context is the repo ROOT).
docker build -f server/Dockerfile -t <registry>/splitwise-api:latest .
docker push <registry>/splitwise-api:latest

# 3. Deploy it with the env vars from 9.3. It runs `migrate deploy` on boot.

# 4. Build the web image with the API URL baked in.
docker build -f web/Dockerfile \
  --build-arg VITE_API_BASE_URL=https://api.yourdomain.com/api/v1 \
  -t <registry>/splitwise-web:latest .
docker push <registry>/splitwise-web:latest

# 5. Deploy it, then point CORS_ALLOWED_ORIGINS on the API at the web origin and redeploy the API.
```

For a static host (Vercel/Netlify/Pages) instead of the web container: build command
`npm run --workspace=web build`, output directory `web/dist`, set `VITE_API_BASE_URL` in the
platform's build environment, and enable SPA fallback so client-side routes resolve — the container
path handles this via `serve -s` plus [`web/serve.json`](../web/serve.json).

### 9.6 Verifying a deploy

```bash
curl https://api.yourdomain.com/api/v1/health     # expect {"status":"ok"}
```

Then register a user, create a group, add an expense, and check the balances screen. If health
passes but registration fails, it's almost always `DATABASE_URL` or a migration that didn't run.

### 9.7 Known limitations of this deployment story

Worth stating plainly rather than discovering in production:

- **Receipts don't survive redeploys** until the S3 storage adapter is implemented.
- **The recurring-expense scheduler is an in-process interval timer.** Run more than one API
  replica and each one will fire it — you'll get duplicate expenses. It needs a distributed lock or
  an external scheduler before horizontal scaling.
- **WebSocket state is in-process.** Multiple replicas won't broadcast to each other's clients
  without a shared pub/sub layer (e.g. Redis).
- **The payment gateway is simulated,** not a real UPI/Razorpay integration.
- **Access tokens can't be revoked** before their 15-minute expiry; only refresh tokens are
  revocable.
- **No CI pipeline is configured.** `npm run check` runs lint, both typechecks, and the backend
  suite — wire that into CI before allowing automatic deploys.
