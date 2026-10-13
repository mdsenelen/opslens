# OpsLens

[![CI](https://github.com/mdsenelen/opslens/actions/workflows/ci.yml/badge.svg)](https://github.com/mdsenelen/opslens/actions/workflows/ci.yml)

Did a recent deploy line up with a real regression in this service, in this
environment? OpsLens answers that one question for a small fleet. It puts a
service's metric, its alert threshold and its deployments on one chart, and
links from the alert straight back to it.

The data is simulated, but it is live: when hosted, the API writes new
metric points every minute, and every 3 hours a release goes out on one of
the services, its error rate spikes, the alert evaluator fires real alerts,
and a rollback recovers it. See [Live data](#live-data).

![Metric chart: Payments API error rate in production, with the v2.14.0 deployment marker and the alert threshold overlaid](docs/screenshots/metric-chart.png)

**Read next:** the [case study](docs/case-study.md) (decisions, evidence,
limits, about five minutes) · the [planning blueprint](docs/spec/00-overview.md)
· the [performance](docs/performance-report.md) and
[accessibility](docs/accessibility-report.md) reports.

## Status: complete (roadmap phases 0 to 9)

| Phase | What it delivered |
| --- | --- |
| 0 to 1 | pnpm monorepo, shared zod contracts, migrations, deterministic seed |
| 2 to 3 | Read-only REST API, in-process alert evaluator, SSE stream, six-screen frontend |
| 4 | uPlot chart with deployment markers and threshold overlay |
| 5, 8 | Unit, contract, integration and E2E tests; GitHub Actions CI |
| 6 | Measured performance work ([report](docs/performance-report.md)) |
| 7 | Accessibility pass with automated keyboard and axe checks ([report](docs/accessibility-report.md)) |
| 9 | Visual design system, demo-path fixes, [case study](docs/case-study.md) |
| After 9 | Live simulated data, live chart ranges, hosting config ([deployment guide](docs/deployment.md)) |

## Stack

| Path | What it is |
| --- | --- |
| `apps/web` | Next.js 16 (App Router), React 19, CSS Modules with design tokens, uPlot |
| `apps/api` | Fastify 5, zod via `fastify-type-provider-zod`, raw `pg`, `node-pg-migrate` |
| `packages/shared-types` | zod schemas for every entity and wire contract, used by both apps |

The reasons for each choice, and what was rejected (NestJS, an ORM, ECharts or
Recharts, TanStack Query, WebSockets, Tailwind), are in the
[case study](docs/case-study.md#decisions-and-what-was-rejected).

## The demo path

Locally, against the seed: fleet overview → **Payments API** (flagged with an active alert) →
`error_rate_pct` in **production** → the spike, with the `v2.14.0` deployment
marker just before it and the alert threshold overlaid → the alert's detail,
whose **Open the metric chart** link goes back to the chart centred on the
alert.

| Fleet overview | Alert detail |
| --- | --- |
| ![Fleet overview](docs/screenshots/fleet-overview.png) | ![Alert detail](docs/screenshots/alert-detail.png) |

Light and dark themes follow the operating system
([dark screenshot](docs/screenshots/metric-chart-dark.png)).

On the hosted demo the incident changes service every 3 hours, so start
from **Alerts**: open the newest alert and follow **Open the metric chart**.

![A live incident: Checkout API's error rate spikes after release v3.95.8 ships and recovers after the rollback to v3.95.7](docs/screenshots/live-incident.png)

## Live data

With `SIMULATION_ENABLED=true` (the hosted demo), the API writes the
fleet's data itself, once a minute:

- Normal traffic: every metric's catalogue baseline with a daily swing and
  per-minute noise, always under its alert threshold.
- An incident every 3 hours (UTC 00:00, 03:00, ...), rotating through the
  four services. A release reaches staging, then production; 4 minutes
  later error rate and p95 latency spike; on-call rolls back to the
  previous release 13 minutes into the spike, and the metrics recover.
- A healthy release on another service in between, so not every
  deployment marker is the guilty one.

Alerts are never written by the simulation. The same evaluator that runs
locally reads the points and opens and resolves them, and the alerts list
and fleet overview update over the SSE stream.

Every value is a pure function of the timestamp
(`apps/api/src/infra/simulation/scenario.ts`). That lets an API that was
asleep (free hosting tiers stop idle services) write the exact data it
missed when it starts again, and replay the evaluator over any incident in
that gap. Points older than 8 days are pruned.

Relative chart ranges (`?range=1h|6h|24h|7d`, the default) follow "now"
and refresh every minute without remounting the chart. An explicit `start`
and `end`, which an alert's chart link carries, stays fixed.

Deploying it: [docs/deployment.md](docs/deployment.md) (Neon, Render,
Vercel, all free tiers).

## Running it locally

Requires Node 20 or newer, pnpm, and PostgreSQL 16.

```bash
pnpm install
```

Start a database. Either use Docker:

```bash
pnpm db:up    # postgres:16-alpine, user/password/db all "opslens", port 5432
```

or a local Postgres (for example `brew services start postgresql@16`), with a
role and database both named `opslens` and password `opslens`.

Then migrate, seed, and start both apps in two terminals:

```bash
export DATABASE_URL="postgres://opslens:opslens@localhost:5432/opslens"
pnpm --filter @opslens/api migrate:up
pnpm --filter @opslens/api seed     # deterministic demo scenario, safe to re-run

pnpm dev:api                        # terminal 1: Fastify on :4000
NEXT_PUBLIC_OPSLENS_API_URL="http://localhost:4000" pnpm dev:web   # terminal 2: Next.js on :3000
```

Open `http://localhost:3000`. If the API is down or the database is empty,
every screen still renders, with an inline error and a Retry button or an
empty state instead of a crash.

Re-run the seed to move the scenario back to "now". The seed writes a fixed
history ending at seed time, and nothing adds points afterwards unless you
start the API with the simulation on. To try the live data locally, use a
separate database, because the seed's fixed scenario and the simulation
are meant to be used apart:

```bash
export DATABASE_URL="postgres://opslens:opslens@localhost:5432/opslens_live"   # create it first
pnpm --filter @opslens/api migrate:up
pnpm --filter @opslens/api bootstrap   # reference rows and alert rules only
SIMULATION_ENABLED=true pnpm dev:api   # backfills 24 hours on start
```

## Backend API

`GET /api/services`, `/services/:serviceId`, `/metrics`,
`/metrics/:metricId/points`, `/alerts`, `/alerts/:alertId`, `/deployments`,
`/deployments/:deploymentId`, and `/realtime/stream` (SSE).

- Lists are paginated with a maximum of 100 rows and an allowlisted sort. An
  unsafe `sort` value is a 400, not an SQL fragment.
- Metric points are bounded: at most a seven-day window and 1,000 points per
  request. A metric with no points in an environment returns `200` with an
  empty array, not a 404.
- Alert evaluation runs once a minute in the API process. A rule fires only
  when every point in its trailing window violates the threshold, the window
  is fully covered, and the newest point is recent. A partial unique index
  allows at most one open (firing or acknowledged) alert per rule and
  environment, so repeated evaluations are idempotent. Firing alerts resolve
  when the rule stops violating; acknowledged alerts stay open until
  handled.
- Every fire and resolve is published on the SSE stream, so an open alerts
  page and the fleet overview update without polling. The stream carries change signals only; REST
  stays the source of truth.

## Architecture rules that are enforced, not just described

`eslint-plugin-boundaries` fails the lint if a layer reaches where it should
not.

| Layer | Folder | Owns | Never owns |
| --- | --- | --- | --- |
| App | `apps/web/src/app` | Routes, metadata, initial server fetch | Business logic |
| Feature | `apps/web/src/features/*` | One workflow's UI and data composition | Another feature's internals |
| UI | `apps/web/src/components` | Presentational primitives with no OpsLens vocabulary | Fetching, domain concepts |
| Infrastructure | `apps/web/src/lib` | API clients, URL state, the fetch state machine | JSX |

`apps/api/src` mirrors this: one folder per module under `modules/`, shared
code under `infra/`, and a module may use `infra/` but never another module.

## Testing

| Layer | Command | Needs |
| --- | --- | --- |
| API unit, contract and validation | `pnpm --filter @opslens/api test` | nothing |
| API integration (real SQL, including the live simulation tick) | `pnpm --filter @opslens/api test:integration` | migrated Postgres |
| Web components (Vitest, Testing Library) | `pnpm --filter @opslens/web test` | nothing |
| E2E (Playwright): demo journey, keyboard-only journey, SSE reconnection, axe scans in light and dark | `pnpm --filter @opslens/web test:e2e` | migrated and seeded Postgres |

The E2E specs live in `apps/web/e2e/`: the demo journey
(`regression-investigation`), the keyboard-only pass (`keyboard-navigation`),
SSE reconnection (`realtime-reconnection`), and the axe scans
(`accessibility`, every screen in light and dark). Before the first run,
install the browser once:

```bash
pnpm --filter @opslens/web exec playwright install chromium
```

Playwright starts the API and the web app itself (see
`apps/web/playwright.config.ts`). Locally it reuses servers already
listening on `:3000` and `:4000`, so stop your dev servers first if you want
a clean run.

Integration tests truncate the database they point at, so run them against a
scratch database rather than the one you seeded for the demo. They run
serially by design (see `apps/api/vitest.integration.config.ts`).

CI (`.github/workflows/ci.yml`) is configured to run lint, typecheck, unit
tests and the build on every pull request and every push to `main`, plus the
integration and E2E suites against a `postgres:16-alpine` service container.
All three jobs (`checks`, `integration`, `e2e`) passed on
[pull request #2](https://github.com/mdsenelen/opslens/pull/2), the first CI
run to include the keyboard and axe suites. Phone-width axe scans were a
one-off local check and are not part of CI.
