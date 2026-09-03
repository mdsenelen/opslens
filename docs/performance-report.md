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
