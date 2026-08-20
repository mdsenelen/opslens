# 10 — Performance

Per the task brief, this defines what to measure and how — no invented
target numbers (no "p95 under 200ms" pulled from nowhere). Numbers should
come from actually running these measurements against the seeded data, not
from this document.

## Database: the services environment-filter query

`services.routes.ts`'s `GET /services` handler builds an `EXISTS` subquery
when `environment` is passed (`services.routes.ts:20`):

```sql
EXISTS (SELECT 1 FROM metrics m JOIN metric_points mp ON mp.metric_id=m.id
        JOIN environments e ON e.id=mp.environment_id
        WHERE m.service_id=s.id AND e.name=$n)
```

This is the one query in the current route set most likely to degrade as
`metric_points` grows, because it correlates against the full points table
per candidate service rather than against a smaller reference table. **What
to measure:** `EXPLAIN ANALYZE` this exact query against the seeded dataset,
then again after seeding a synthetic multiple (10x, 100x the current point
count, via a throwaway seed variant — not a change to the real seed script)
to see whether the planner is doing an index-only existence check (cheap,
scales fine) or falling back to a sequential scan per service (expensive,
scales badly). If it degrades, the fix is almost certainly to check
environment membership against a smaller table (e.g., a distinct
service×environment mapping, or simply checking `deployments` /a
lighter-weight signal) rather than adding an index to `metric_points`
specifically for this — but that's a decision for when the measurement
shows a real cost, not before.

## Alert evaluation cycle wall-clock time

`server.ts:18-20` runs `runAlertEvaluation` every 60 seconds. **What to
measure:** wrap the call with a timer and log duration
(`console.time`/`console.timeEnd` or a proper histogram if one gets added
later), then watch it as the rule count and environment count grow. The
job's nested-loop shape (`alert-evaluation-job.ts:6-16`: for each enabled
rule, for each distinct environment for that rule, one points query) is
`O(rules × environments)` database round-trips per tick — at the current
seed size (8 alert rules: 4 services × 2 metrics, 2 populated
environments) that's at most 16 round-trips per minute, trivial. The
measurement matters once this fleet size assumption is revisited; until
then, this is a "watch it, don't pre-optimize it" item.

## React render counts on the metric-points chart

Once section 05's chart component exists and section 06's SSE stream is
pushing new points into it, the thing to verify is that a new point arriving
does not re-render the entire chart component tree or re-mount the chart
instance — uPlot's own update API (`setData`) is designed to be called
imperatively without React re-rendering the canvas element itself; the React
wrapper around it should hold the uPlot instance in a ref and push data
into it via effect, not via prop-driven re-render. **What to measure:**
React DevTools' profiler (or a manual render counter) on the chart component
while an SSE stream is active, confirming render count stays flat regardless
of how many points arrive — a spike in render count per incoming point would
mean the imperative/React boundary was implemented wrong (data reaching the
component through props and triggering full re-renders instead of through a
ref-held imperative update).

## Bundle size per route

Next.js's own build output (`next build`) reports per-route JS size. **What
to measure:** after uPlot and any other chart/real-time dependencies land,
check that the metric-detail route's bundle doesn't pull uPlot (or anything
else) into routes that don't render a chart — this is a code-splitting
correctness check (dynamic `import()` for the chart component, per section
05) more than a raw-size target, since there's no stated size budget to hit,
only "don't ship the charting library to the alerts-list route that never
renders a chart."

## Table virtualization: not needed unless proven necessary

The task brief asks this to be judged by actual row counts, not assumed.
Every list endpoint (`serviceListQuerySchema`, `alertListQuerySchema`,
`deploymentListQuerySchema`, `metricListQuerySchema`) is already
server-paginated with a hard cap of 100 rows per page
(`paginationQuerySchema`'s `limit: max(100)` in
`packages/shared-types/src/api.ts:19-22`). A 100-row `<table>` renders fine
unvirtualized in any modern browser — virtualization (e.g.
`@tanstack/react-virtual`) solves a problem that shows up at thousands of
simultaneously-rendered rows, which this API's own pagination cap makes
structurally impossible to reach. No virtualization for MVP; this would
only become relevant if a future change removed or drastically raised the
100-row page cap, which nothing in this spec proposes.
