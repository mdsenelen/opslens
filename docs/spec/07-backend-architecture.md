# 07 — Backend architecture

## Baseline: modules today

`apps/api/src/modules/{ping,services,metrics,alerts,deployments}` — each a
single `*.routes.ts` file that takes `(app: FastifyInstance, db: Database)`
and registers its routes directly against `db.query(...)`, with inline row
mappers (e.g. `services.routes.ts`'s `serviceRow` function) and hand-built
SQL strings including manual `WHERE`/pagination clause assembly repeated in
every route file. `apps/api/eslint.config.js` already enforces the module
boundary that matters here: a module may depend on `infra/`, never on
another module directly (`eslint.config.js:26`). Its comment also already
names a `realtime/` module as expected to exist (`eslint.config.js:7`) —
section 06 is where that module gets specified.

## What the audit found and what it implies

The audit's framing is precise: "no repository/service layer — handlers
query directly," and specifically flags duplication the boundary-preserving
fix should target: a shared pagination/row-mapping helper. Looking at the
actual four route files, the duplication is real and mechanical, not
structural:

- **Pagination**: every list route (`services.routes.ts:14-29`,
  `metrics.routes.ts:10-16`, `alerts.routes.ts`'s `/alerts` handler,
  `deployments.routes.ts`'s `/deployments` handler) repeats the same
  four-line shape — run a `COUNT(*)` with the same `WHERE` clause, push
  `limit`/`offset` onto the args array, run the paginated `SELECT`, wrap the
  result as `{ items, page, limit, total }`. The SQL predicates differ
  correctly per module (that's real domain logic); the pagination
  *mechanics* around them are identical and copy-pasted.
- **Row mapping**: every route hand-writes a `snake_case → camelCase` mapper
  with `new Date(r.foo).toISOString()` calls repeated per date column
  (`serviceRow` in `services.routes.ts:10`, `metric` in
  `metrics.routes.ts:7`, the inline arrow in `alerts.routes.ts:4`, and in
  `deployments.routes.ts:3`). Each is small, but each is a place a
  timestamp-formatting bug (or a forgotten field) can independently creep
  in.

## The minimum layering fix — no repository framework, no query builder

Add one file: `apps/api/src/infra/db/pagination.ts`, exporting two small,
generic helpers:

```ts
// runs a COUNT and a paginated SELECT against the same WHERE/args,
// returns { items, page, limit, total } — the shape every list route
// already returns by hand.
export async function paginate<Row, T>(
  db: Database,
  opts: {
    countSql: string; selectSql: string; args: unknown[];
    page: number; limit: number; map: (row: Row) => T;
  },
): Promise<{ items: T[]; page: number; limit: number; total: number }>
```

This is a plain function, not a class hierarchy or a repository interface —
it takes raw SQL strings the route already builds and returns the same
paginated envelope the route already constructs by hand, just without
repeating the four-line dance. It lives in `infra/`, which every module is
already allowed to depend on per the existing boundary rule — no new
boundary element type needed, no exception to the "module → infra only"
rule.

Row mapping is *not* worth centralizing into one generic helper — the four
mappers shape genuinely different rows (a `Service` row is not shaped like
an `Alert` row), and a generic "snake→camel + ISO-format known date
columns" mapper would need per-call configuration that's barely shorter
than just writing the small mapper function. Keep row mappers as they are
today: one small named function per module, colocated with its route file.
This is a deliberate "don't add ceremony this project doesn't need" call —
the audit named pagination duplication specifically because it's identical
logic across modules; row mapping is *similar-looking but distinct* logic,
which is exactly the case where a shared abstraction costs more than it
saves.

## Where a thin service/domain layer belongs — and where it doesn't

The task brief asks where a service/domain layer should be introduced
"without over-engineering it." The honest answer for this codebase's actual
size: **not as a new file-per-module layer for MVP.** None of the four
modules have business logic complex enough to be worth separating from
their route handler — the `WHERE`-clause assembly *is* the domain logic
(“an alert list filters by these four things”), and splitting it into a
`services/alerts.service.ts` that the route calls into would, at current
route complexity, just relocate the same code one file over with an added
indirection and no new testability (the route handlers are already
integration-tested via `app.inject(...)`, per
`apps/api/src/api-validation.test.ts`).

The one place a real seam already exists and should be named explicitly:
**`alert-evaluator.ts` is already the domain layer for alerts** — a pure
function (`evaluateRule`), unit-tested independent of the database
(`alert-evaluator.test.ts`), called by `alert-evaluation-job.ts` which
handles the I/O (reading points, writing alert state). This
pure-function/impure-shell split is the pattern to repeat *if and only if*
another module grows logic complex enough to need it — not to impose on
`services.routes.ts` or `deployments.routes.ts` today, which have no
comparable non-trivial logic to extract.

## Two required fixes inside existing files (from the audit)

Both are implementation-level, named here because they're backend-owned and
gate frontend work in [02-user-journeys.md](./02-user-journeys.md) and
[06-realtime-architecture.md](./06-realtime-architecture.md):

- **`GET /metrics/:id/points` 404-vs-empty bug**: `metrics.routes.ts:18-19`
  looks up the metric *through* a join to `metric_points`, so a metric with
  zero points in the requested environment produces no row and 404s. Fix:
  look up the metric and environment independently (metric by id, then
  confirm the environment exists — it doesn't need to already have points
  for that environment to be a valid, empty response), and return `200`
  with `points: []` when the metric is real but pointless for that
  environment. This is what makes the Empty-state row in
  [02-user-journeys.md](./02-user-journeys.md) reachable at all.
- **Alert-evaluator recency tolerance**: `alert-evaluator.ts:17` requires
  `window.at(-1)!.ts.getTime() >= evaluatedAt.getTime()` — the latest
  point must be at-or-after the exact evaluation instant. Against the
  seed's realistic 1-minute production cadence and a 60-second evaluation
  tick, the newest available point is almost always a few seconds to a
  minute *behind* `evaluatedAt`, so this condition practically never holds.
  Fix: accept a bounded recency tolerance (e.g. the latest point must be
  within one ingestion-cadence-interval of `evaluatedAt`, not exactly at or
  past it) — this is a one-line change to the comparison in
  `evaluateRule`, covered by new test cases in
  [09-testing.md](./09-testing.md), not a redesign of the evaluator's
  window logic.

## Infra gaps to close (audit-named, mechanical)

- **`pool.on("error", ...)`**: `infra/db/pool.ts` creates a `Pool` with no
  error listener — an idle client error (e.g. the DB connection dropping)
  currently has nowhere to go but an unhandled `'error'` event, which
  crashes the Node process. Add a listener that logs and lets the pool
  recover (pg's own pool re-creates the connection; this is a log-and-move-
  on handler, not custom reconnection logic).
- **Graceful shutdown**: `server.ts` has an `onClose` hook that ends the
  pool (`server.ts:23`) but nothing calls `app.close()` on `SIGTERM`/
  `SIGINT` — add the two signal listeners that call it, so a container
  orchestrator's stop signal drains in-flight requests and closes the pool
  cleanly instead of the process being killed mid-query.

## Where `modules/realtime` fits

Specified fully in [06-realtime-architecture.md](./06-realtime-architecture.md);
noted here only to confirm it fits this same module shape — a
`realtime.routes.ts` registering one SSE endpoint, depending on `infra/`
(the DB, to know what changed) and nothing from another module directly,
consistent with the boundary rule already enforced today.
