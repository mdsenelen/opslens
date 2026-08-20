# OpsLens design blueprint — overview

This is the document the codebase already refers to. `README.md` says "full
architecture rationale... lives in the design blueprint"; `apps/web/README.md`
and `apps/api/eslint.config.js` cite "the repo blueprint" for the four-layer
frontend split, the module-boundary rule, and the Fastify-over-NestJS call.
None of that existed as a written artifact before this pass — this is it.

Everything in `docs/spec/` is grounded in the repo as it stands at commit
`158d318` (Phase 1: domain foundation): the Zod schemas in
`packages/shared-types/src/*`, the migrations in
`apps/api/src/infra/db/migrations/`, the seed scenario in
`apps/api/src/infra/db/seed.ts`, the read-only routes in
`apps/api/src/modules/*/*.routes.ts`, and the four-layer frontend convention
already enforced (on an otherwise-empty `apps/web/src`) by
`apps/web/eslint.config.mjs`. This is a planning pass only — no code changes
ship with it.

## Document map

| File | Covers |
|---|---|
| [01-product-definition.md](./01-product-definition.md) | Target user, MVP scope, the seeded regression as the demo spine |
| [02-user-journeys.md](./02-user-journeys.md) | The investigate-a-regression journey, plus loading/empty/error/reconnect states |
| [03-domain-model.md](./03-domain-model.md) | Service/Environment/Metric/.../Deployment against the actual schemas; Incident and Dashboard verdicts |
| [04-frontend-architecture.md](./04-frontend-architecture.md) | Route structure, the four-layer split, state ownership, typed client layer |
| [05-visualization.md](./05-visualization.md) | Charting, tables, pagination/virtualization, uPlot justification |
| [06-realtime-architecture.md](./06-realtime-architecture.md) | SSE justification, connection lifecycle, reconnection, ordering |
| [07-backend-architecture.md](./07-backend-architecture.md) | Where a thin service/repository seam goes, without a DI framework |
| [08-database.md](./08-database.md) | Schema evolution, the dedup constraint fix, why not TimescaleDB |
| [09-testing.md](./09-testing.md) | Integration tests first, evaluator edge cases, component tests, E2E last |
| [10-performance.md](./10-performance.md) | What to measure and how, no invented target numbers |
| [11-accessibility.md](./11-accessibility.md) | Fleet table, alert list, filters — concrete, not aspirational |
| [12-repo-structure.md](./12-repo-structure.md) | The actual tree, one line per new directory |

## The three decisions that shape everything else

**Chart library: uPlot.** The domain only ever needs time-series line/area
charts over `metricPointsResponseSchema.points` — capped at 1,000 points per
request by `metricPointsQuerySchema` (`packages/shared-types/src/api.ts:47`)
and further capped to a 7-day span by `timeRangeQuerySchema`. That's a narrow,
well-understood chart type at a bounded data volume, not a case for a
general-purpose grammar-of-graphics library. uPlot renders to canvas, ships at
~45KB gzipped with zero dependencies, and is built specifically for dense,
frequently-updating time series — which matters once section 06's SSE stream
is pushing new points into an open chart every evaluation cycle. SVG-based
React chart libraries (Recharts, Visx, Nivo) re-render a DOM node per data
point on every update; at even a few points per second across several open
metric charts that's a real cost this project doesn't need to pay. Full
justification and the rejected alternatives are in
[05-visualization.md](./05-visualization.md).

**Real-time transport: Server-Sent Events, not WebSockets.** The data flow is
one-directional — the server pushes new metric points and alert status
changes to an open dashboard; the client never needs to push anything back
over the same channel (filters, acknowledgements, etc. are ordinary POST/PATCH
requests). `apps/api/src/server.ts` already runs a single-instance,
in-process `setInterval` evaluator with no distributed coordination
(`server.ts:16-21`) — there is no multi-instance fan-out problem to solve, and
none of the three: connection scaling, bidirectional messaging, or binary
frames, apply here. SSE gets native browser reconnection (`EventSource`'s
built-in retry), works over plain HTTP/1.1 through the same Fastify server and
the same CORS setup already in `app.ts`, and needs no new protocol, ping/pong
keepalive logic, or room/broadcast management that a WS server would require.
Full design in [06-realtime-architecture.md](./06-realtime-architecture.md).

**TimescaleDB: not warranted.** The migration that creates `metric_points`
(`apps/api/src/infra/db/migrations/1700000000004_create-metric-points.ts`)
already made this call explicitly — a BRIN index on `ts` because the table is
append-mostly and physically time-ordered, plus a btree on
`(metric_id, environment_id, ts DESC)` for the actual query shape. At this
project's real scale (a handful of services, two populated environments, 1-5
minute cadences, a 7-day query cap enforced by the shared Zod contract) that
combination comfortably serves the access patterns the routes actually use.
TimescaleDB's value proposition — hypertable chunking, continuous
aggregates, compression policies — solves problems that show up at
many-service, multi-month-retention, high-cardinality scale. Introducing it
here would mean a new extension dependency and operational surface
(chunk sizing, compression policy tuning) in exchange for nothing this
dataset needs. Detailed in [08-database.md](./08-database.md).

## What this plan preserves, deliberately

Per the task brief, these are treated as settled and not reopened anywhere in
this spec:

- The shared Zod contract in `packages/shared-types` as the single source of
  truth, validated symmetrically on request and response (already true via
  `fastify-type-provider-zod` in `apps/api/src/app.ts`).
- Raw parameterized `pg` — no ORM. The audit's fix (a shared
  pagination/row-mapping helper) is a plain function, not a query builder.
- Fastify without a DI framework — `apps/api/src/app.ts`'s comment already
  states the "domain graph is flat enough" rationale; nothing in this plan's
  new service-layer proposal (section 07) needs a container.
- The in-process `setInterval` alert evaluator, unchanged in mechanism —
  section 06 layers SSE push on top of it, it does not replace it with a
  queue or scheduler.
- `eslint-plugin-boundaries` on both apps, extended (new element types added
  as new directories land) but never loosened.
- No GraphQL, no microservices, no Redis/message queue, no Kubernetes, no
  second database. None of the sections below introduce any of these — where
  a section considers and rejects one (real-time transport considers and
  rejects a WS+Redis pub/sub combo, for instance), the rejection is explicit
  and justified in that section, not silently dropped.

## Where this spec extends the audit rather than just applying it

The audit is treated as accurate and undisputed throughout — no section
reverses or contradicts it. Three places extend it with a concrete mechanism
because the audit named the problem but not the fix shape:

- **Alert dedup constraint** (audit: "application-only, no DB unique
  constraint"): section 08 specifies the exact partial unique index
  (`ON alerts (alert_rule_id, environment_id) WHERE status IN ('firing',
  'acknowledged')`) and notes the evaluation job's existing `SELECT ... FOR
  UPDATE`-free read-then-insert (`alert-evaluation-job.ts:12-13`) becomes
  safe under concurrent evaluation only once that constraint exists.
- **Recency-tolerance evaluator fix**: section 06 flags that this fix is a
  soft dependency for real-time architecture — the SSE alert-status stream is
  only demonstrably useful once the evaluator reliably fires against the
  seeded regression's realistic 1-minute ingestion cadence, since right now
  the exact-instant condition in `alert-evaluator.ts:17`
  (`window.at(-1)!.ts.getTime() >= evaluatedAt.getTime()`) means it
  practically never fires against real point spacing.
- **The 404-vs-empty-array bug** in `GET /api/metrics/:id/points`: section 02
  specifies this as the frontend's canonical *empty* state (not error state)
  for a metric with no points yet in an environment, which only works once
  the backend fix (section 07) ships — flagged there as a blocking dependency
  for that one UI state, not a reason to route around it in the frontend.
