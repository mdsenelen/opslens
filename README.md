# OpsLens

Real-time technical analytics for a small service fleet — a portfolio project. Full architecture rationale (why Fastify over NestJS, why SSE not WebSockets, why uPlot, schema, domain model, roadmap) lives in the design blueprint; this README covers what's actually implemented so far and how to run it.

## Status: Phase 0 — architecture / setup

What exists right now:

- pnpm workspace: `apps/web` (Next.js 16, App Router), `apps/api` (Fastify), `packages/shared-types` (Zod schemas shared by both).
- A single stub contract (`GET /api/ping`) round-tripping through the shared Zod schema, proving the toolchain before any domain code is written.
- Local Postgres via `docker-compose.yml` and `node-pg-migrate` wired (no migrations yet — that's Phase 1).
- ESLint `boundaries` rules enforcing the layering described below.

Phase 1 (domain foundation — Service/Environment/Metric/MetricPoint/AlertRule/Alert/Deployment schemas + migrations + seed script) is the next slice of work.

## Running it

```bash
pnpm install
pnpm db:up            # starts Postgres in docker
pnpm dev:api           # terminal 1 — Fastify on :4000
pnpm dev:web            # terminal 2 — Next.js on :3000
```

Open `http://localhost:3000` — it should show "api: connected" with a live timestamp from the Fastify server. If the API isn't running yet, the page still renders (with an inline error state), which is itself the point: no screen should hard-crash because a fetch failed.

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
