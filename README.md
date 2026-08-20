# OpsLens

Real-time technical analytics for a small service fleet. Full architecture rationale (why Fastify over NestJS, why SSE not WebSockets, why uPlot, schema, domain model, roadmap) lives in [`docs/spec/`](docs/spec/00-overview.md), the design blueprint; this README covers what's actually implemented so far and how to run it.

## Status: Phase 3 — frontend MVP + real-time

What exists right now:

- pnpm workspace: `apps/web` (Next.js 16, App Router), `apps/api` (Fastify), `packages/shared-types` (Zod schemas shared by both).
- ESLint `boundaries` rules enforcing the layering described below.
- The full domain schema: `Service`, `Environment`, `Metric`, `MetricPoint`, `AlertRule`, `Alert`, `Deployment` — as Zod schemas in `packages/shared-types/src/*` and as `node-pg-migrate` migrations in `apps/api/src/infra/db/migrations/`.
- A deterministic seed script (`apps/api/src/infra/db/seed.ts`) that upserts reference data (services/environments/metrics) and regenerates the time-series tables (metric_points/alert_rules/alerts/deployments) fresh each run. It injects one regression — payments-api's p95 latency and error rate both spike ~6h ago, a few minutes after a `v2.14.0` deploy — so the "investigate a regression" journey has a real answer to find, every time.
- A read-only, Zod-validated REST API (below), an in-process SSE realtime layer, and a six-screen Next.js frontend that walks the seeded regression end to end: fleet overview → service detail → metric chart (with the deployment marker and alert threshold overlaid) → alert detail, plus an alerts list and a deployments list.

## Backend API

`GET /api/services`, `/services/:serviceId`, `/metrics`, `/metrics/:metricId/points`,
`/alerts`, `/alerts/:alertId`, `/deployments`, `/deployments/:deploymentId`, and
`/realtime/stream` (SSE). Lists are paginated (maximum 100); metric points
are explicitly time-bounded to seven days and capped at 1,000. A metric with zero
points in a given environment returns `200` with an empty `points` array, not a 404 —
a valid metric with no data yet is a real, empty answer.

Alert evaluation runs once per minute in the API process. It evaluates each enabled
rule against its trailing `durationSeconds` window: every observed point must satisfy
the comparator, points must span the entire window, and the newest point must be
within a recency tolerance of the evaluation instant (ordinary ingestion lag, not
stale data). Missing coverage does not fire. A partial unique index
(`alerts_open_per_rule_environment_idx`) enforces at most one open alert per
rule/environment at the database level; repeated evaluations are idempotent. A firing
alert resolves when its rule no longer violates; acknowledged alerts are retained for
explicit operational handling. Every fire/resolve transition is published over
`GET /api/realtime/stream` (optionally scoped with `?serviceId=`) so an open dashboard
sees status changes without polling.

## Running it

```bash
pnpm install
pnpm db:up                          # starts Postgres in docker
pnpm --filter @opslens/api migrate:up
pnpm --filter @opslens/api seed
pnpm dev:api                        # terminal 1 — Fastify on :4000
pnpm dev:web                        # terminal 2 — Next.js on :3000
```

Open `http://localhost:3000` for the fleet overview. If the API isn't running yet (or the database is unseeded), every screen still renders — with an inline error or empty state rather than a crash, which is itself the point: no screen should hard-crash because a fetch failed. To walk the seeded regression: Fleet overview → `payments-api` (flagged with an active alert) → `error_rate_pct` in `production` → the spike, with the `v2.14.0` deployment marker and the alert's threshold overlaid → the firing alert's detail.

The seed script defaults to the docker-compose credentials (`postgres://opslens:opslens@localhost:5432/opslens`); set `DATABASE_URL` to point it elsewhere.

## Frontend layering

`apps/web/src` is split into four layers, enforced by `eslint-plugin-boundaries` (`apps/web/eslint.config.mjs`), not just convention:

| Layer | Folder | Owns | Never owns |
|---|---|---|---|
| UI | `components/` | Presentational primitives | Fetching, domain concepts |
| Feature | `features/*` | One workflow's UI + data composition | Raw fetch/URL parsing |
| Infrastructure | `lib/` | API client, query setup, URL-state helpers | Business rules |
| App | `app/` | Routes/layouts | Business logic |

`apps/api/src` mirrors this with `modules/*` (one folder per domain: services, metrics, alerts, deployments, realtime) and `infra/`, with the same boundary enforced by `apps/api/eslint.config.js`: a module may use `infra/`, never another module directly.

## Backend

Fastify, not NestJS — the domain graph here is flat enough that hand-written `routes → service → repository` layering gives the same modularity without DI ceremony. (GeoPulse, the companion geospatial project, makes the opposite call for a denser module graph — see that project's README.) Request/response validation runs on the same Zod schemas the frontend imports from `@opslens/shared-types`, so there is exactly one definition of what a `Service`, `Alert`, or `Deployment` looks like on the wire.
