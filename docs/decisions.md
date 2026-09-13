# Architecture decisions

Short ADRs for money rounding, FX handling, and debt-simplification tradeoffs.

## Rounding & money (Phase 3)

All amounts are `BIGINT` minor units end-to-end; the API boundary (`domain/money.ts`) is the only
place decimal strings are parsed/formatted, and it never touches a JS `number`. Split allocation
uses the largest-remainder method for `PERCENT`/`SHARES` and a deterministic seeded rotation for
`EQUAL`'s leftover unit (§4.1) — see `domain/split.ts`'s own comments for the exact algorithm.

## FX handling (Phase 3 / Phase 7)

Rates are snapshotted per expense/settlement at creation time and never re-fetched, so historical
balances can't drift when rates change later. `domain/fx.ts`'s `CachedRateProvider` (Phase 7)
keeps `getRate()` synchronous behind the same `RateProvider` interface `StaticRateProvider`
always had — a background refresh updates an in-memory cache, falling back to the last
successfully fetched table (or its seed table) if a refresh fails. No real external FX API is
named anywhere in project.md, so the default `RateFetcher` wraps the same static table, reframed
as "the fetched source" — the caching/fallback machinery itself is real and tested
(`server/tests/fx.test.ts`), not a fabricated integration with an unspecified paid API.

## Debt simplification (Phase 4)

Greedy max-creditor/max-debtor matching (`domain/simplify.ts`) zeroes at least one participant
per iteration, so it always produces at most `n-1` transfers — the true minimum-transfer problem
is NP-hard (reduces to set partition), so this is a heuristic, not an optimum. The `subset`
refinement (bitmask DP, `O(3^n)`, practical up to `n≈12`) partitions the balances into the
maximum number of independent zero-sum subsets first, then runs greedy inside each — provably
never worse than running greedy on the whole set, since no transfer is ever needed *between* two
independent zero-sum groups.

## Phase 8: index review

project.md's Phase 8 scope calls for reviewing `(groupId, createdAt)` on `Expense`/`Activity` and
`(groupId, userId)` on `LedgerEntry`. All three already existed — added proactively when those
models were created in Phase 3/6, not new work here. This section is the actual verification.

**Finding**: against the seeded dev database (`npm run seed`; ~40 expenses, 102 `LedgerEntry` rows
in the larger of the two seeded groups), `EXPLAIN ANALYZE` on the balances query —

```sql
SELECT "userId", SUM("amountBaseMinor")
FROM "LedgerEntry"
WHERE "groupId" = $1
GROUP BY "userId";
```

— produces a **Seq Scan**, not an Index Scan, at this data volume:

```
GroupAggregate  (cost=5.37..5.40 rows=1 width=48) (actual time=0.048..0.056 rows=4 loops=1)
  ->  Sort  (cost=5.37..5.38 rows=1 width=24) (actual time=0.041..0.044 rows=102 loops=1)
        ->  Seq Scan on "LedgerEntry"  (cost=0.00..5.36 rows=1 width=24) (actual time=0.003..0.015 rows=102 loops=1)
              Filter: ("groupId" = $1::uuid)
              Rows Removed by Filter: 81
```

This is Postgres's cost-based planner working correctly, not a missing/unused index: with only
~183 total rows in the table, a sequential scan is genuinely cheaper than paying the per-row
index-lookup-plus-heap-fetch overhead. Forcing the alternative plan (`SET enable_seqscan = off`)
confirms the index is valid and would be chosen once the table is large enough for it to pay off:

```
GroupAggregate  (cost=0.14..5.93 rows=1 width=48) (actual time=0.029..0.043 rows=4 loops=1)
  ->  Index Scan using "LedgerEntry_groupId_userId_idx" on "LedgerEntry"  (cost=0.14..5.91 ...)
        Index Cond: ("groupId" = $1::uuid)
```

Cost `5.40` (seq scan) vs `5.93` (index scan) at this scale — the natural plan is the right one.
**Conclusion**: the index is correctly defined and ready for production data volumes; no schema
change needed. (`pg_indexes` confirms `LedgerEntry_groupId_userId_idx` on `("groupId", "userId")`
alongside the primary key and `LedgerEntry_sourceId_idx`.)

## Phase 8: N+1 audit

Read through `getGroup`/`listMembers` (`server/src/modules/groups/service.ts`) and `listActivity`
(`server/src/modules/activity/service.ts`) — the two endpoints project.md calls out (group detail,
activity feed).

**Finding**: neither has an N+1 pattern. `getGroup` does exactly two queries total: one
`findUniqueOrThrow` for the group row, and `listMembers`'s single `findMany({ include: { user:
true } })`, which Prisma compiles to one query with a JOIN — not a loop issuing one query per
member. `listActivity` is a single `findMany({ include: { actor: { select: { name: true } } } })`,
same reasoning — one query with a JOIN for every activity row's actor name, regardless of page
size. **Conclusion**: no fix needed; both were already written with `include`-based eager loading
from when they were first built (Phase 2 and Phase 6 respectively).
