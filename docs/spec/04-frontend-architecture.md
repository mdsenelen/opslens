# 04 — Frontend architecture

## Baseline

`apps/web/src` today is essentially one stub: `app/page.tsx` (an async
server component calling `getPing()`), `lib/api-client.ts` (the `ApiError`
union and one fetcher), and the four-layer boundary already enforced by
`apps/web/eslint.config.mjs` even though three of the four layers
(`features/`, `components/`) don't have any files in them yet. This section
fills that structure in — it does not redesign the boundary rule, which the
task brief treats as settled.

## Route structure (Next.js App Router)

Matches the six MVP screens from
[01-product-definition.md](./01-product-definition.md) directly:

```
app/
├── page.tsx                                    → Fleet Overview
├── services/[serviceId]/
│   ├── page.tsx                                 → Service Detail
│   └── metrics/[metricId]/page.tsx              → Metric chart
├── alerts/
│   ├── page.tsx                                  → Alerts list
│   └── [alertId]/page.tsx                        → Alert detail
└── deployments/page.tsx                          → Deployments list
```

No route group or parallel-route complexity is justified — six flat routes,
each one screen, matches the six-screen MVP exactly. `[serviceId]` and
`[metricId]` are the two dynamic segments the API's own resource
identifiers (`serviceIdParamsSchema`, `metricIdParamsSchema`) already
define; the route params are literally the same UUIDs the API expects, no
translation layer needed.

## Feature/module boundaries (extends the existing rule, doesn't change it)

One `features/*` folder per workflow, not per route — `service-detail` and
`metric-chart` are separate features because they're separately reusable
and separately data-fetching, even though `metric-chart` is nested under
the service-detail route. Per feature: a `container` component (fetches +
composes) and however many presentational pieces it needs from
`components/`. The boundary rule already forbids `feature → app` and
`ui → feature` (`apps/web/eslint.config.mjs:26-29`), so:

- `app/services/[serviceId]/page.tsx` renders `<ServiceDetail
  serviceId={params.serviceId} />` from `features/service-detail` — the
  page owns route params and passes them down, nothing else.
- `features/service-detail` calls the typed client
  (`lib/services-client.ts`, see below), owns loading/empty/error state
  handling per [02-user-journeys.md](./02-user-journeys.md)'s state table,
  and composes `components/data-table` for its metrics list.
- `components/data-table` knows nothing about services, metrics, or
  fetching — it takes rows, columns, and a sort handler as props.

## Server vs. client component strategy

Default to server components for anything that's a one-shot data fetch with
no interactivity — the existing `app/page.tsx` pattern
(`await getPing()` directly in an async server component) is exactly right
for, e.g., the initial Alert Detail render. Client components (`"use
client"`) are needed specifically where:

- **Filters** — service search, environment select, status/severity
  selects — need client-side interactivity to update URL state on change
  without a full navigation-triggered reload feeling jarring.
- **The metric chart** — uPlot is a DOM/canvas library; it must mount in
  the browser (section 05).
- **Real-time-subscribed views** — anything holding an open `EventSource`
  (section 06) must be a client component, since SSE is a browser API.

The recommended pattern per screen: the route's `page.tsx` stays a server
component doing the *initial* fetch (fast first paint, no client-side
waterfall for data that doesn't need to be interactive yet), passing that
initial data as props into a client component that takes over for
filtering/real-time updates from there — the same "server fetch feeds a
client island" split Next.js's App Router is built around, applied
consistently rather than reinvented per screen.

## State ownership split

Four kinds of state, each with one clear owner — this is the answer to
"where does this piece of state live," applied consistently so no screen
invents its own pattern:

| State kind | Owner | Examples |
|---|---|---|
| **URL state** | Next.js `searchParams` / `useSearchParams`, read/written via `lib/url-state.ts` | Every filter (`environment`, `status`, `severity`, `q`), every time range (`start`/`end` on the metric chart), pagination (`page`). Chosen because every one of these is already a query-string parameter on the corresponding API endpoint (`serviceListQuerySchema`, `alertListQuerySchema`, etc.) — URL state makes a filtered/paginated view bookmarkable and shareable for free, and keeps the "what am I looking at" state out of React state entirely. |
| **Local state** | `useState`/`useReducer` inside a feature or component | Transient UI-only state with no server or URL correspondence — a dropdown's open/closed state, an unsaved in-progress form input before it's committed to a URL param. |
| **Server state** | Fetched via the typed client, cached/revalidated by Next.js's own `fetch` caching (server components) or a thin `useEffect`-based fetch in client components — **no React Query/SWR dependency introduced.** | The actual `Service`/`Metric`/`Alert`/`Deployment` data. Given the API's own caching semantics are simple (no mutation endpoints exist yet — everything is `GET`, per [01-product-definition.md](./01-product-definition.md)'s explicit exclusion of write UI), a full client-state-caching library's invalidation machinery has nothing to invalidate against; Next.js's built-in fetch behavior is sufficient until mutations exist. |
| **Real-time state** | A dedicated hook (`useRealtimeMetricPoints`, `useRealtimeAlertStatus` — section 06) backed by `lib/realtime-client.ts`'s `EventSource` wrapper, merged into the server-fetched initial state, never replacing it wholesale | New points appended to the chart's dataset; alert status transitions patched into the currently-rendered alert/list — see section 06 for the merge/ordering rules. |

## Typed API client layer

`lib/api-client.ts` today has exactly one fetcher (`getPing`) and the
`ApiError` union everything else reuses. Per the file's own comment
("Phase 2 grows this into typed fetchers per module"), the extension is one
file per module, each following the same shape `getPing` already
establishes (try/catch → network error, status check → not-found/server
error, `schema.safeParse` → validation error, else return parsed data):

```
lib/
├── api-client.ts          # existing — ApiError union + shared fetch helper, stays
├── services-client.ts     # NEW — getServices(query), getService(id)
├── metrics-client.ts      # NEW — getMetrics(query), getMetricPoints(id, query)
├── alerts-client.ts       # NEW — getAlerts(query), getAlert(id)
└── deployments-client.ts  # NEW — getDeployments(query), getDeployment(id)
```

Each new fetcher imports its response schema directly from
`@opslens/shared-types` (`serviceListItemSchema`, `metricPointsResponseSchema`,
etc. — all already defined in `packages/shared-types/src/api.ts`) and
validates the same way `getPing` validates `pingResponseSchema` — this is
purely mechanical extension of an established pattern, not a new one. A
shared internal helper (extracted from the repeated try/catch/status-check
shape across all five fetchers) is reasonable once the duplication is
visible across all four new files, but the four fetcher files are written
first, and any extraction happens after, following the same "don't
pre-abstract" discipline as the backend's `pagination.ts` decision in
[07-backend-architecture.md](./07-backend-architecture.md).
