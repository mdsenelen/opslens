# Performance report — Phase 6

Measured against the questions [docs/spec/10-performance.md](spec/10-performance.md)
posed at the planning stage. That document deliberately named *what* to
measure and *how*, with no invented target numbers; this is the follow-up
with real numbers from actually running the measurements. Device: a local
Apple Silicon Mac, Postgres 16 (Homebrew, not Docker — the CI/dev image is
the same `postgres:16-alpine`), Node 26, Next.js 16 with Turbopack.

## 1. Services environment-filter query — confirmed, not urgent yet

**Method:** `EXPLAIN ANALYZE` on the exact query `GET /services?environment=`
builds (`apps/api/src/modules/services/services.routes.ts:21-25`), against
the real seed, then against the same data synthetically duplicated 10x and
100x (`INSERT INTO metric_points SELECT ... FROM metric_points,
generate_series(...)` in a throwaway database — the real seed script is
untouched).

| `metric_points` rows | Plan shape | Execution time |
|---|---|---|
| 13,840 (real seed) | `Seq Scan on metric_points` (13,840 rows), simple nested loop | **6.0 ms** |
| 138,400 (10x) | `Seq Scan on metric_points` (138,400 rows), nested loop, 115,280 iterations of `metrics_pkey` | **64.7 ms** |
| 1,384,000 (100x) | Postgres switches to 2 parallel workers + a `Memoize` node caching the `metrics_pkey` lookups on its own | **223.5 ms** |

**Reading it:** the plan is exactly what the spec predicted — the `EXISTS`
subquery correlates against the *entire* `metric_points` table rather than
a smaller reference, and does a full sequential scan of it on every
request regardless of how few services actually match. Postgres's own
query planner absorbs a good chunk of the naive cost as the table grows
(parallel workers and automatic memoization kick in at 100x, which is why
223ms is a ~3.4x jump for a 10x row increase, not 10x) — but the trend is
real and would keep climbing.

**Conclusion:** at the real seed's actual scale (13,840 rows, 4 services),
6ms is trivial — no change made. Per the spec's own instruction, this is a
decision for when the measurement shows a real cost, not before; adding an
index or a `service_id × environment` mapping table now would be solving a
problem that doesn't exist yet at this project's real scale. If the seeded
fleet size is ever deliberately grown well past this, re-run this same
`EXPLAIN ANALYZE` first — the fix directions the spec already named (check
membership against a smaller table, not an index on `metric_points`
itself) are exactly what this measurement would justify reaching for.

## 2. Alert evaluation cycle wall-clock time

**Method:** timed one `runAlertEvaluation` call directly (`performance.now()`
around the call) against the same 100x-scaled database from above — 8 alert
rules × up to 2 populated environments each.

**Result:** **608.7ms**, one alert transition. Against a 60-second
evaluation interval (`apps/api/src/server.ts`'s `setInterval(..., 60_000)`),
that's ~1% of the cycle budget even at 100x the real data volume — not
urgent. This scales with the same `metric_points` access pattern as
measurement 1 (each rule's query is bounded by its `durationSeconds`
window via the composite index, but still costs more as the table grows
overall). Per the spec: watch it, don't pre-optimize it. Worth re-baselining
if the real seed's data volume assumptions change.

### 2a. Re-measured with a repeatable benchmark (2026-10-22)

The 608.7 ms above is a single timed call, and the SQL that built its 100x
dataset was not recorded (only `SELECT ... generate_series(...)`), so it
cannot be reproduced. It is left as written. This is the repeatable
replacement.

**Method:** `pnpm --filter @opslens/api bench:alert-evaluator`
([`apps/api/src/bench/bench-alert-evaluator.ts`](../apps/api/src/bench/bench-alert-evaluator.ts)).
It creates a throwaway database, runs the normal `migrate:up` and `seed`,
then copies every metric point 99 more times with this exact statement:

```sql
INSERT INTO metric_points (metric_id, environment_id, ts, value)
SELECT mp.metric_id, mp.environment_id, mp.ts - g * span.width, mp.value
FROM metric_points mp,
     generate_series(1, 99) AS g,
     (SELECT max(ts) - min(ts) + interval '1 minute' AS width FROM metric_points) AS span;
```

Each copy is moved back by the seed's whole time span, so the evaluator's
trailing windows contain exactly the seeded points and the extra rows are
older history. Then `VACUUM ANALYZE`, 3 untimed warm-up calls, and 30 timed
calls of the real `runAlertEvaluation`, all at the same `evaluatedAt` (the
newest seeded point). The alerts table is restored to its seeded state
before every call, outside the timed region. The scratch database is dropped
at the end.

**Machine:** Apple M1 Pro, 10 cores, 16 GB, macOS (Darwin 25.5.0), Node
v26.7.0, PostgreSQL 16.15 (Homebrew), on the same machine as the client.

**Dataset:** 1,384,000 `metric_points` (seed x 100), 8 enabled rules. Every
timed call made 0 alert transitions (the 608.7 ms run made 1).

| Run | Copies | min | median | p95 | max | median vs 60 s |
|---|---|---|---|---|---|---|
| 1 | shifted into history | 156.5 ms | **165.4 ms** | 183.7 ms | 204.7 ms | 0.28% |
| 2 | shifted into history | 157.6 ms | **173.2 ms** | 201.7 ms | 211.4 ms | 0.29% |
| 3 | same timestamps (`BENCH_COPIES=same-ts`) | 70.2 ms | 87.6 ms | 109.5 ms | 110.6 ms | 0.15% |

Runs 1 and 2 are the measurement. Run 3 only brackets the unknown method:
if the original copies kept their timestamps, the evaluator gets faster, not
slower, so neither method reproduces 608.7 ms on this machine today. The
earlier figure was likely a cold, first call; that was not verified.

**Where the time goes:** mostly in the per-rule
`SELECT DISTINCT environment_id FROM metric_points WHERE metric_id = $1`.
`EXPLAIN ANALYZE` on the 100x data shows a parallel index-only scan over
that metric's whole history (about 173,000 index entries, 49.1 ms for one
rule), not just the evaluation window. With same-timestamp copies the
index holds 100 identical keys per point, which B-tree deduplication
compacts, and the same scan takes 21.4 ms. That is why run 3 is faster.
So the evaluator's cost grows with total stored history, not with the
window size.

**Conclusion:** at 100x the seeded data, one evaluation takes about 165 to
173 ms median, under 0.3% of its 60 s budget. No change made. If history
retention ever grows far beyond this, the first fix is to take the
environment list from somewhere smaller than `metric_points` (the same
direction as measurement 1), not a new index.

## 3. React render behavior on the metric-points chart — now a regression test, not a one-off profile

The spec asked to verify (via React DevTools profiling) that a new point
arriving doesn't re-render or remount the uPlot-backed chart. Rather than a
manual profiling session with no lasting record, this is now an automated
test: [`apps/web/src/features/metric-chart/metric-points-chart.test.tsx`](../apps/web/src/features/metric-chart/metric-points-chart.test.tsx),
mocking `uplot` itself (jsdom has no real canvas 2D context for the genuine
library to draw into) and asserting:

- the `uPlot` constructor runs exactly once across repeated `points` prop
  updates (a remount would show up as a second construction);
- each `points` update reaches the existing instance via `setData()`;
- deployment/threshold updates go through `redraw()`, not a data update;
- `destroy()` is called exactly once, on unmount.

All three pass against the current implementation — confirming
`metric-points-chart.tsx`'s ref-held, effect-driven update pattern is
correct, and now protected against a future change accidentally
reintroducing a prop-driven remount.

## 4. Bundle size per route — confirmed via a real production build

**Method:** `pnpm --filter @opslens/web build` (Turbopack), then a real
Chromium session (Playwright) navigating to all six routes against
`next start`, recording every JS resource each one actually requests.

**Result:** the uPlot chunk (`0gofsow81awve.js`, 55.6KB) loaded on exactly
one route — `/services/[serviceId]/metrics/[metricId]` — and none of the
other five (`/`, `/alerts`, `/alerts/[alertId]`, `/deployments`,
`/services/[serviceId]`). Next.js's App Router route-level code splitting
is doing this automatically (no dynamic `import()` was needed): uPlot is
only ever imported by `metric-points-chart.tsx`, which only that one route
tree reaches.

## 5. Table virtualization — confirmed still unnecessary

Spot-checked that every list query schema (`serviceListQuerySchema`,
`alertListQuerySchema`, `deploymentListQuerySchema`, `metricListQuerySchema`
in `packages/shared-types/src/api.ts`) still extends `paginationQuerySchema`,
whose `limit` is hard-capped at 100
(`z.coerce.number().int().min(1).max(100)`). A 100-row `<table>` is not a
case virtualization exists to solve, and the API's own contract makes a
larger single render structurally impossible without a schema change
nothing in this project proposes. No action.

## 6. Phase 9 re-check: bundle split and the chart's point limit

**Bundle split, re-measured.** The redesign changed the chart component and
added shared layout components used on every route, so measurement 4 was
repeated: `pnpm --filter @opslens/web build`, `next start`, then a Playwright
Chromium session visiting all six routes and recording every JS response
body (uncompressed bytes).

| Route | JS files | JS total (uncompressed) | uPlot chunk |
|---|---|---|---|
| `/` | 8 | 745.1 KB | none |
| `/services/[serviceId]` | 8 | 740.8 KB | none |
| `/services/[serviceId]/metrics/[metricId]` | 9 | 800.1 KB | 58.5 KB |
| `/alerts` | 8 | 747.9 KB | none |
| `/alerts/[alertId]` | 8 | 745.4 KB | none |
| `/deployments` | 8 | 745.0 KB | none |

The split still holds: uPlot loads on the metric chart route only. The
chunk measured 58.5 KB here against 55.6 KB in measurement 4. The chart
component's own code (theme token reading and marker labels) is the most
likely source of the difference, but that attribution was not verified.
Totals are uncompressed response bodies, not transfer sizes, so do not read
them as network cost.

**A correctness finding, not a speed one.** The chart never passed `limit`
to `GET /metrics/:metricId/points`, so the API's default of 500 points
applied. At production's seeded cadence of one point per minute, that is
about 8 hours, so the "24h" and "7d" presets both showed roughly the last 8
hours. The chart now requests the maximum of 1,000 points (about 16 hours at
that cadence) and says in text when a response is at the cap. Showing a
full 24h or 7d window would need server-side downsampling. That was not
built, so no performance claim about it is made here.
