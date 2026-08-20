# 12 — Repository structure

Extends the current tree; nothing below replaces the existing
`apps/api`, `apps/web`, `packages/shared-types` shape.

```
opslens/
├── docker-compose.yml                  # local Postgres — unchanged
├── package.json                        # pnpm workspace root — unchanged
├── docs/
│   └── spec/                           # this document set
│
├── packages/
│   └── shared-types/
│       └── src/
│           ├── service.ts              # existing — unchanged
│           ├── environment.ts          # existing — unchanged
│           ├── metric.ts               # existing — unchanged
│           ├── metric-point.ts         # existing — unchanged
│           ├── alert-rule.ts           # existing — unchanged
│           ├── alert.ts                # existing — unchanged
│           ├── deployment.ts           # existing — unchanged
│           ├── api.ts                  # existing — unchanged
│           ├── realtime.ts             # NEW — SSE event envelope schemas (section 06)
│           └── index.ts                # existing — add the realtime.ts re-export
│
├── apps/
│   ├── api/
│   │   └── src/
│   │       ├── app.ts                  # existing — register modules/realtime
│   │       ├── server.ts               # existing — add SIGTERM/SIGINT handling (section 07)
│   │       ├── infra/
│   │       │   └── db/
│   │       │       ├── pool.ts         # existing — add pool.on("error") (section 07)
│   │       │       ├── pagination.ts   # NEW — shared paginate() helper (section 07)
│   │       │       ├── migrations/     # existing — add the two constraint migrations (section 08)
│   │       │       └── seed.ts         # existing — unchanged
│   │       └── modules/
│   │           ├── ping/               # existing — unchanged
│   │           ├── services/           # existing — unchanged, adopts paginate()
│   │           ├── metrics/            # existing — fix 404-vs-empty bug (section 07)
│   │           ├── alerts/             # existing — fix recency tolerance (section 07)
│   │           ├── deployments/        # existing — unchanged, adopts paginate()
│   │           └── realtime/           # NEW — the module eslint.config.js already
│   │               ├── realtime.routes.ts     #   names but doesn't yet contain (section 06)
│   │               └── event-broadcaster.ts   #   in-process pub/sub for SSE subscribers
│   │
│   └── web/
│       └── src/
│           ├── app/                    # routes — Next.js App Router (section 04)
│           │   ├── page.tsx            # existing stub — becomes Fleet Overview
│           │   ├── services/
│           │   │   └── [serviceId]/
│           │   │       ├── page.tsx           # NEW — Service Detail
│           │   │       └── metrics/
│           │   │           └── [metricId]/
│           │   │               └── page.tsx   # NEW — Metric chart
│           │   ├── alerts/
│           │   │   ├── page.tsx        # NEW — Alerts list
│           │   │   └── [alertId]/
│           │   │       └── page.tsx    # NEW — Alert detail
│           │   └── deployments/
│           │       └── page.tsx        # NEW — Deployments list
│           │
│           ├── features/               # NEW — one folder per workflow (section 04)
│           │   ├── fleet-overview/
│           │   ├── service-detail/
│           │   ├── metric-chart/
│           │   ├── alerts-list/
│           │   ├── alert-detail/
│           │   └── deployments-list/
│           │
│           ├── components/             # NEW — presentational primitives (section 04)
│           │   ├── data-table/
│           │   ├── status-badge/       # color-independent alert status/severity (section 11)
│           │   └── filter-bar/
│           │
│           └── lib/
│               ├── api-client.ts       # existing — grows typed fetchers per module
│               ├── url-state.ts        # NEW — URL-backed filter/time-range state (section 04)
│               └── realtime-client.ts  # NEW — EventSource wrapper (section 06)
│
└── (CI workflow — .github/workflows/ci.yml, NEW, per section 09)
```

## Responsibility notes for every new directory

| Path | Responsibility |
|---|---|
| `docs/spec/` | This spec — the written design blueprint the README and eslint configs already reference. |
| `packages/shared-types/src/realtime.ts` | Zod schemas for SSE event envelopes (`metric-point` / `alert-status-change` events) — same symmetric-validation pattern as every other shared schema. |
| `apps/api/src/infra/db/pagination.ts` | The one generic helper the audit asked for: runs a count + paginated select against caller-supplied SQL, returns the `{items,page,limit,total}` envelope every list route already builds by hand. |
| `apps/api/src/modules/realtime/` | Owns the SSE endpoint and in-process event fan-out; depends on `infra/` only, per the existing module-boundary rule — matches the module the eslint config's comment already names. |
| `apps/web/src/app/**` | Routes and layouts only — no fetching, no business logic, per the existing boundary rule in `apps/web/eslint.config.mjs`. |
| `apps/web/src/features/*` | One folder per workflow — composes `components/` + `lib/` into a working screen; the layer the current tree is entirely missing today. |
| `apps/web/src/components/*` | Presentational primitives with no fetching and no domain awareness — reusable across features. |
| `apps/web/src/lib/url-state.ts` | URL-backed representation of the TimeRange/Filter query state identified in section 03 as "fold into query state, not a domain entity." |
| `apps/web/src/lib/realtime-client.ts` | Thin `EventSource` wrapper implementing the reconnect/backoff behavior specified in section 06, consumed by features, never by `app/` directly. |
| `.github/workflows/ci.yml` | Runs lint/typecheck/test (including the Postgres-backed integration suite via a `services:` Postgres) on every push, per section 09. |

## What does *not* get added

No `services/` or `repositories/` directory inside `apps/api/src/modules/*`
for MVP — [07-backend-architecture.md](./07-backend-architecture.md)
concluded that layer isn't justified at current route complexity; the one
new backend file (`pagination.ts`) lives in `infra/`, not a new
per-module layer. No `packages/ui` or design-system package — one app
consumes `components/`, so there's nothing to share across packages yet.
No `apps/web/src/store` or global state library — section 04 specifies
state ownership split across URL/local/server/real-time state using
built-in React and Next.js primitives, not a new state-management
dependency.
