# OpsLens

Real-time technical analytics for a small service fleet. Full architecture rationale (why Fastify over NestJS, why SSE not WebSockets, why uPlot, schema, domain model, roadmap) lives in [`docs/spec/`](docs/spec/00-overview.md), the design blueprint; this README covers what's actually implemented so far and how to run it.

## Status: Phase 6 — performance

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

## Testing

Four layers, per [docs/spec/09-testing.md](docs/spec/09-testing.md):

- **`apps/api` unit/contract/validation** (`pnpm --filter @opslens/api test`) — pure `evaluateRule` logic, shared Zod schema/contract tests, and HTTP-level validation against a fake DB that throws if queried. No database needed.
- **`apps/api` integration** (`pnpm --filter @opslens/api test:integration`) — the same routes' actual SQL against a real, migrated Postgres: pagination math, filter predicates, the alert-dedup unique constraint's idempotency, and the evaluator's recency-tolerance behavior against realistically-spaced points. Requires `pnpm db:up && pnpm --filter @opslens/api migrate:up` first.
- **`apps/web` component tests** (`pnpm --filter @opslens/web test`, Vitest + React Testing Library) — the loading/error/empty/ready state machine every fetch-backed screen shares, filter-to-URL-state wiring, and the alert-status live region's `aria-live="polite"` announcement.
- **`apps/web` E2E** (`pnpm --filter @opslens/web test:e2e`, Playwright) — scoped to exactly two flows: the primary regression-investigation journey (dashboard → service → metric chart → deployment correlation → alert detail) and the real-time reconnection behavior (the SSE connection drops, the UI shows a paused status, then recovers once it's back). Requires a migrated, *seeded* Postgres (`pnpm --filter @opslens/api seed`); `playwright.config.ts`'s `webServer` starts the API and web app itself.

CI (`.github/workflows/ci.yml`) runs the fast `apps/api`/`apps/web` suites, lint, typecheck, and build on every push; the Postgres-backed integration and E2E suites run in their own jobs against a `services:` Postgres matching `docker-compose.yml`'s image and credentials.

The E2E reconnection flow caught a real bug during this pass: `GET /api/realtime/stream` calls `reply.hijack()` to write directly to the raw socket for its long-lived stream, which skips `@fastify/cors`'s `onSend` hook entirely — so every browser connection from a different origin (the documented local setup: web on `:3000`, api on `:4000`) failed with a CORS error and stayed stuck reconnecting, forever. Fixed by setting `Access-Control-Allow-Origin` directly on the hijacked response (`apps/api/src/infra/web-origin.ts`, shared with the `@fastify/cors` registration so the two can't drift), with a regression test at `apps/api/src/modules/realtime/realtime.routes.test.ts`.

## Performance

Measured, not assumed — see [docs/performance-report.md](docs/performance-report.md) for the full write-up (method, before/after numbers, device) against every question [docs/spec/10-performance.md](docs/spec/10-performance.md) posed. Summary: the services environment-filter query does a full `metric_points` scan whose cost was confirmed to grow with table size (6ms at the real seed's 13,840 rows, up to 223ms at a synthetic 100x) but is trivial at actual project scale, so no schema change was made; the metric chart's uPlot instance is now provably never remounted by a real-time update (a regression test, not a one-off profiling session); a real production build confirmed the 55.6KB uPlot chunk loads on exactly the metric-chart route and no other; and table virtualization remains unnecessary given every list endpoint's hard 100-row pagination cap.
