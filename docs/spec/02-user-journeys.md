# 02 — User journeys

## Primary journey: investigate the regression

This is the seeded scenario, walked screen by screen (screens per
[01-product-definition.md](./01-product-definition.md)):

1. **Dashboard** — Fleet overview loads via `GET /api/services`. User scans
   for a nonzero `activeAlertCount`; `payments-api` shows one.
2. **Filter** — user optionally narrows by environment (`production`) or
   searches (`q=payments`), both server-side via `serviceListQuerySchema`.
3. **Inspect metric / open entity** — clicks `payments-api`, lands on
   Service Detail (`GET /api/services/:serviceId`), sees its two metrics
   (`p95_latency_ms`, `error_rate_pct`) and which environments have data.
4. **Inspect time series** — opens `error_rate_pct` in `production`
   (`GET /api/metrics/:metricId/points?environment=production&start=...&
   end=...`), sees the 15-minute spike to ~9% against a ~0.4% baseline.
5. **Investigate anomaly / correlate to deployment** — the same
   service/environment/window's deployments
   (`GET /api/deployments?serviceId=...&environment=production&start=...&
   end=...`) surface `v2.14.0`, deployed 4 minutes before the spike started
   — rendered as a marker on the same chart, not a separate lookup step.
6. **Confirm the alert** — opens the firing alert
   (`GET /api/alerts/:alertId`), sees its rule (`gt 5` over `180s`,
   `critical`) and confirms it's the same metric/environment as the spike
   just inspected.
7. **Return to overview** — back to Fleet Overview; the story is closed.

Every step above maps to an endpoint that already exists and returns real
data today — this journey is buildable against the current API with zero
backend changes beyond the two audit fixes noted in
[00-overview.md](./00-overview.md).

## State model: match the existing four-way ApiError, don't invent a new one

`apps/web/src/lib/api-client.ts` already discriminates every failure into
exactly four kinds (`ApiError`, lines 5-9): `network`, `validation`,
`not-found`, `server`. Every screen's error handling in this spec reuses
that union rather than introducing a parallel error taxonomy. Concretely:

| State | Trigger | UI treatment |
|---|---|---|
| **Loading** | Initial fetch in flight | Skeleton matching the eventual layout (table skeleton for lists, chart-axis skeleton for the metric chart) — never a bare spinner replacing the whole screen, so layout doesn't jump on load. |
| **Empty** | Fetch succeeded, `items: []` or `points: []` | A stated, screen-specific empty message (e.g. "No deployments in this window" on Deployments; "No data points for this metric in `staging` yet" on the metric chart) — never the same generic "Nothing here" everywhere, since the *reason* for empty differs (no rows exist vs. filters excluded everything). |
| **Error — network** | `ApiError.kind === "network"` (fetch itself threw — API unreachable) | "Can't reach the API" banner with a Retry button; matches `README.md:40`'s stated principle that "no screen should hard-crash because a fetch failed." |
| **Error — validation** | `ApiError.kind === "validation"` (response failed the shared Zod schema) | This indicates a contract mismatch between deployed frontend and backend, not a user-actionable error — log it, show a generic "Something went wrong loading this" without exposing the Zod error internals to the user. |
| **Error — not-found** | `ApiError.kind === "not-found"` | Only reachable today for a genuinely missing resource id (e.g. an alert id that doesn't exist) — render a proper "not found" state, not a retry button, since retrying an invalid id will never succeed. |
| **Error — server** | `ApiError.kind === "server"` (non-2xx, non-404) | Generic error banner with Retry and the numeric status shown for debuggability, matching the `status` field already carried on this variant. |
| **Retry** | User action on any error state | Re-run the same fetch that failed; for the metric chart specifically, retry must re-request the *same* time range the user had selected, not reset to a default window. |
| **Real-time connection lost** | SSE `EventSource.onerror` fires (section 06) | A small, non-blocking indicator (e.g. a dot/badge near the affected data, not a full-screen interrupt) — the last-fetched data stays visible and interactive; this is explicitly not the same as the fetch-failure error state above, since the initial page data loaded fine. |
| **Reconnecting** | Between an SSE drop and either successful reconnect or giving up | Same indicator as above, distinguishable from "lost" (e.g. "reconnecting…" vs. "live updates paused") — see section 06 for the reconnection/backoff mechanics this state reflects. |

## The one state that depends on a backend fix

`GET /api/metrics/:id/points` currently 404s when a metric is valid but has
zero points in the requested environment (audit finding, confirmed at
`metrics.routes.ts:18-19`: the existence check joins through
`metric_points`, so a metric with no points in that environment never
produces a row to find). Until that's fixed to return `200` with
`points: []`, the frontend cannot distinguish "this metric doesn't have data
in `development` yet" (a legitimate empty state — `development` is
deliberately unpopulated per `seed.ts:123-130`) from "this metric id doesn't
exist" (a genuine not-found). This is called out here as a blocking
dependency for the Empty-state row above, not something the frontend should
route around (e.g. by treating every 404 on this endpoint as "empty" —
that would silently swallow real not-found errors too).

## Secondary journeys (brief)

- **Browse deployments independent of an alert**: Deployments list, filtered
  by service/environment/status/time — a "what shipped recently" check with
  no anomaly driving it. Same loading/empty/error states as above.
- **Triage the alert list**: land directly on Alerts (e.g. from a bookmark
  or after being paged), filter to `status=firing`, work through each one —
  this is journey steps 5-6 above entered directly rather than via the
  fleet overview.
