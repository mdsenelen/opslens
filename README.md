# OpsLens

Real-time technical analytics for a small service fleet — a portfolio project. Full architecture rationale (why Fastify over NestJS, why SSE not WebSockets, why uPlot, schema, domain model, roadmap) lives in the design blueprint; this README covers what's actually implemented so far and how to run it.

## Status: Phase 1 — domain foundation

What exists right now:

- pnpm workspace: `apps/web` (Next.js 16, App Router), `apps/api` (Fastify), `packages/shared-types` (Zod schemas shared by both).
- A single stub contract (`GET /api/ping`) round-tripping through the shared Zod schema — Phase 0's proof that the toolchain works end to end.
- ESLint `boundaries` rules enforcing the layering described below.
- The full domain schema: `Service`, `Environment`, `Metric`, `MetricPoint`, `AlertRule`, `Alert`, `Deployment` — as Zod schemas in `packages/shared-types/src/*` and as `node-pg-migrate` migrations in `apps/api/src/infra/db/migrations/`.
- A deterministic seed script (`apps/api/src/infra/db/seed.ts`) that upserts reference data (services/environments/metrics) and regenerates the time-series tables (metric_points/alert_rules/alerts/deployments) fresh each run. It injects one regression — payments-api's p95 latency and error rate both spike ~6h ago, a few minutes after a `v2.14.0` deploy — so the "investigate a regression" journey has a real answer to find, every time. Verified idempotent (two runs, identical row counts) and the up/down migrations were verified against a real local Postgres before this landed.

Phase 2 (core backend — services/metrics/alerts/deployments routes, the alert-rule evaluation job, repository integration tests) is next.

## Running it

```bash
pnpm install
pnpm db:up                          # starts Postgres in docker
pnpm --filter @opslens/api migrate:up
pnpm --filter @opslens/api seed
pnpm dev:api                        # terminal 1 — Fastify on :4000
pnpm dev:web                        # terminal 2 — Next.js on :3000
```

Open `http://localhost:3000` — it should show "api: connected" with a live timestamp from the Fastify server. If the API isn't running yet, the page still renders (with an inline error state), which is itself the point: no screen should hard-crash because a fetch failed.

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

Fastify, not NestJS — the domain graph here is flat enough that hand-written `routes → service → repository` layering gives the same modularity without DI ceremony. (GeoPulse, the companion geospatial project, makes the opposite call for a denser module graph — see that project's README.) Request/response validation runs on the same Zod schemas the frontend imports from `@opslens/shared-types`, so there is exactly one definition of what a `PingResponse` (and later, a `Service` or `Alert`) looks like.
