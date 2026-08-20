# 08 — Database

## Baseline: what's already migrated

Seven tables (`services`, `environments`, `metrics`, `metric_points`,
`alert_rules`, `alerts`, `deployments`), each with its own migration in
`apps/api/src/infra/db/migrations/`, one Postgres enum type per constrained
string column (`environment_name`, `metric_kind`, `alert_comparator`,
`alert_severity`, `alert_status`, `deployment_status`), and three existing
indexes:

- `metric_points (metric_id, environment_id, ts DESC)` — btree, for the
  "this metric's points in this environment, most recent first" query
  (`create-metric-points.ts:28-32`), exactly what
  `metrics.routes.ts`'s `/metrics/:metricId/points` handler runs.
- `metric_points_ts_brin_idx` — BRIN on `ts` alone
  (`create-metric-points.ts:41-43`), chosen because the table is
  append-mostly and physically time-ordered.
- `deployments (service_id, environment_id, deployed_at DESC)` — btree
  (`create-deployments.ts:35-39`), for both the deployments list and "find
  the deploy just before this spike" on a metric chart.
- `alerts (status, service_id)` — btree (`create-alerts.ts:42`), for "firing
  alerts for this service."

This is a well-considered baseline. The changes below are additive fixes for
gaps the audit already identified, not a redesign.

## Required schema change: the alert-dedup unique constraint

**Audit finding:** "Alert dedup ('one open alert per rule/environment') is
application-only, no DB unique constraint." Confirmed in
`alert-evaluation-job.ts:12-13` — the job does a plain `SELECT` for an
existing open alert, then an `INSERT` if none is found, with no transaction
isolation or locking between the two. Under the current single-instance,
single-`setInterval` execution model this race is unreachable in practice
(one evaluator loop, one connection, no concurrent invocations), but it's
exactly the kind of invariant that should be enforced at the data layer
rather than relying on "the calling code happens to be single-threaded
today."

**Fix:** a partial unique index —

```sql
CREATE UNIQUE INDEX alerts_open_per_rule_environment_idx
  ON alerts (alert_rule_id, environment_id)
  WHERE status IN ('firing', 'acknowledged');
```

Partial (not a full unique constraint on `(alert_rule_id, environment_id)`)
because `resolved` alerts must be allowed to accumulate — a rule can fire,
resolve, and fire again, and each is a distinct historical row. Only the
"currently open" state must be unique per rule/environment, which is exactly
what `alert-evaluation-job.ts`'s own `SELECT ... WHERE status IN ('firing',
'acknowledged')` (line 12) already treats as the open-set — this index makes
that invariant enforced, not just assumed.

**Consequence for the evaluation job:** once this index exists, the job's
`INSERT` becomes the enforcement point — a concurrent duplicate insert
(e.g., if the evaluator is ever run with any concurrency, or a manual
re-trigger overlaps a scheduled tick) will fail on constraint violation
instead of silently creating a second open alert. That failure should be
caught and treated as "another evaluation already handled this
rule/environment," not surfaced as an evaluation error — a one-line
try/catch around the insert, not a redesign of the job.

## Required schema change: evaluation-job lookup index

The job's per-rule, per-environment query
(`alert-evaluation-job.ts:10`: `SELECT ts,value FROM metric_points WHERE
metric_id=$1 AND environment_id=$2 AND ts >= $3 AND ts <= $4 ORDER BY ts
ASC,id ASC`) is already covered by the existing
`(metric_id, environment_id, ts DESC)` index — Postgres can use a
descending index for an ascending range scan equally well. No new index is
needed for that query specifically.

What *is* missing: the job's outer loop
(`alert-evaluation-job.ts:8`: `SELECT DISTINCT environment_id FROM
metric_points WHERE metric_id=$1`) has no supporting index for the
`DISTINCT` — it will use the existing composite index's leading columns
(`metric_id`) but still has to scan all matching rows to compute the
distinct set. At current data volume (two populated environments per
metric) this is immaterial. Flagged here for completeness, not proposed as
an MVP change — see [10-performance.md](./10-performance.md) for the
EXPLAIN ANALYZE process that would confirm whether it's ever worth adding a
dedicated `(metric_id, environment_id)` covering index for this specific
query.

## Not required: TimescaleDB

The task brief asks this to be stated explicitly, so: **no, TimescaleDB is
not warranted**, and the existing migration already made the right call
without it.

The case *for* TimescaleDB is hypertable auto-chunking, compression
policies, and continuous aggregates — value that shows up when a
`metric_points`-shaped table is accumulating rows across many services, long
retention windows, and high point cardinality, to the point where a single
unpartitioned table's index maintenance and vacuum cost becomes a real
operational problem. None of that is this project's shape:

- Four services, two metrics each, two populated environments
  (`seed.ts:123-130`), 1-5 minute cadence. `24h × 60 / 1min = 1,440` points
  per metric/environment/day for production, `24h × 60 / 5min = 288` for
  staging. Total steady-state ingestion is on the order of a few thousand
  rows/day across the whole fleet.
- The API's own contract caps every query to a 7-day window
  (`timeRangeQuerySchema`) and 1,000 points (`metricPointsQuerySchema`'s
  `limit`), so there is no code path that ever needs to scan or return more
  than that regardless of how large the table grows.
- The BRIN index on `ts` (`create-metric-points.ts:41-43`) already gives
  near-hypertable-chunking benefits for time-range pruning at a fraction of
  a B-tree's storage cost, precisely because the migration's own comment
  identifies the append-mostly, time-ordered access pattern that BRIN is
  built for — which is the same pattern TimescaleDB's chunking optimizes
  for, just via a heavier mechanism.

Introducing TimescaleDB would add an extension dependency, hypertable
migration tooling, and chunk/retention policy configuration — real
operational surface — in exchange for solving a scale problem this dataset
is nowhere near. Plain Postgres with the existing BRIN + btree strategy
remains correct through MVP and well past it; the trigger to revisit this
would be a genuine change in project shape (many more services, long
multi-month retention, or a decision to keep raw 1-second-resolution
points indefinitely rather than the current bounded windows), not a
number-of-users or "it feels more scalable" consideration.

## Migration hygiene for the two constraint changes above

Both changes are additive (`CREATE UNIQUE INDEX ... WHERE ...`) and should
land as their own `node-pg-migrate` migration
(`pnpm --filter @opslens/api migrate:create`), separate from any
application-code change to the evaluation job, so the constraint can be
verified against the real seeded data (the job should still produce exactly
the two alerts `seed.ts` expects) independently of the recency-tolerance
evaluator fix the audit also called out.
