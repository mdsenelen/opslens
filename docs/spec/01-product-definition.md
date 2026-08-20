# 01 — Product definition

## Target user

A backend/platform engineer responsible for a small service fleet (the seed
data models exactly four services: `checkout-api`, `payments-api`,
`inventory-api`, `notifications-worker` — see
`apps/api/src/infra/db/seed.ts:51-72`) who needs to answer, quickly: *is
anything broken right now, and if so, what changed right before it broke?*
This is not an SRE at a company with a dedicated observability team and a
six-figure Datadog contract — it's the single engineer or small team who owns
both the shipping and the watching of these services, checking a dashboard
after a deploy or when paged.

## Primary problem

Given a small number of services across a few environments, each with a
couple of metrics and periodic deployments, notice a regression fast and
correlate it to its likely cause (almost always: the most recent deployment
to that service/environment) without grepping logs or cross-referencing
three separate tools.

## Primary workflow

This is the one the seeded data is built to demonstrate, verbatim
(`seed.ts:132-145`): `payments-api` in `production` gets a `v2.14.0` deploy,
4 minutes later p95 latency and error rate both spike for 15 minutes, and the
`error_rate_pct` alert rule fires and stays open. The MVP's entire UI surface
exists to make that sequence — deploy → regression → firing alert →
investigation → correlation back to the deploy — walkable end to end:

1. Land on the fleet overview, see `payments-api` flagged (its
   `activeAlertCount` from `serviceListItemSchema` is nonzero).
2. Open the service, see its metrics and environments
   (`serviceDetailSchema`).
3. Open `p95_latency_ms` or `error_rate_pct` for `production`, see the spike
   in the time-series chart.
4. See the `v2.14.0` deployment marker sitting just before the spike on the
   same chart (deployments in the same service/environment/time-window,
   `deploymentListItemSchema`).
5. Open the firing alert, see its rule (threshold, comparator, duration) and
   confirm it's the same metric/environment as the spike.
6. Return to the overview with the story closed.

## Core entities

Service, Environment, Metric, MetricPoint, AlertRule, Alert, Deployment — the
exact seven that already exist as Zod schemas and migrations. See
[03-domain-model.md](./03-domain-model.md) for the full adopt/reject
reasoning on candidate entities (Incident, TimeRange, Filter, Dashboard,
DashboardWidget) that the task brief asked to evaluate but that are not
already in the schema.

## Core screens (MVP)

1. **Fleet overview** — all services, filterable by environment/search
   (`serviceListQuerySchema`'s `q`/`environment` params already support
   this), each row showing active alert count.
2. **Service detail** — one service's metrics and environments
   (`serviceDetailSchema`), entry point to per-metric charts.
3. **Metric detail / chart** — one metric in one environment over a time
   range, deployment markers overlaid (`metricPointsResponseSchema` +
   `deploymentListItemSchema` filtered to the same service/environment/
   window).
4. **Alerts list** — filterable by service/environment/status/severity
   (`alertListQuerySchema`), the primary "what's on fire" view.
5. **Alert detail** — one alert with its rule (`alertDetailSchema`), links
   back to the metric and to the deployment that likely caused it.
6. **Deployments list** — filterable, time-bounded
   (`deploymentListQuerySchema`), the secondary "what shipped recently" view.

No dedicated "Deployment detail" screen is justified for MVP — the
`GET /deployments/:deploymentId` endpoint already exists in
`deployments.routes.ts`, but a deployment's only interesting relationship is
"which metric spiked after it," which the metric chart's overlay already
shows. A standalone detail page would just re-render the same six fields
`deploymentListItemSchema` already carries in the list row.

## MVP feature list

- Fleet overview with search/environment filter and per-row alert count.
- Service detail with its metric and environment list.
- Time-series chart per metric/environment with a bounded, user-adjustable
  time range (bounded by the existing 7-day cap).
- Deployment markers overlaid on the metric chart, scoped to the same
  service/environment/window.
- Alerts list with filters (service, environment, status, severity) and
  detail view showing the rule that fired.
- Deployments list with filters (service, environment, status, time range).
- Real-time push of new metric points and alert status transitions into any
  open dashboard view (section 06).
- The four-way error/loading/empty/retry state handling already scaffolded
  by `apps/web/src/lib/api-client.ts`'s `ApiError` union, applied
  consistently across every screen (section 02).

## Explicit post-MVP list

- Dashboard/DashboardWidget — user-configurable, arrangeable widget
  dashboards. Nothing in the schema models a saved layout, and the fleet
  overview already serves as the one dashboard this fleet size needs. See
  [03-domain-model.md](./03-domain-model.md) for the full reasoning.
- Alert acknowledgement *workflow* UI (assigning, commenting, escalation) —
  the `acknowledged` status and `acknowledgedAt` field already exist in the
  schema and the seed data (`seed.ts:404-426` seeds one resolved/acknowledged
  alert), so a simple "acknowledge" action button is reasonable for MVP, but
  a full workflow (assignment, notes, escalation policies) is not.
- Multi-metric composite/correlation charts (overlaying two metrics on one
  axis) — the seeded scenario's two metrics (latency, error rate) are
  correlated in time but the MVP shows them as two separate charts on the
  same service detail page; a synchronized-crosshair or dual-axis overlay is
  a nice-to-have, not load-bearing for the demo narrative.
- Write/mutation UI for creating services, metrics, alert rules, or
  deployments — every existing route is `GET`-only
  (`apps/api/src/modules/*/*.routes.ts`); the seed script is the only writer
  today. Building create/edit screens ahead of the corresponding write API
  would be building against a contract that doesn't exist yet.
- User accounts, auth, multi-tenancy — nothing in the schema or routes has
  any notion of a user or tenant boundary.

## Explicit excluded-from-MVP list (not even roadmapped)

- Incident management (the aggregate-of-alerts entity) — see
  [03-domain-model.md](./03-domain-model.md) for why this is excluded rather
  than deferred: at this fleet size an Alert already *is* the incident.
- Notification/paging integrations (Slack, PagerDuty, email) — out of scope
  for a portfolio dashboard demonstrating frontend/full-stack depth, not a
  gap in the domain model.
- Log aggregation or trace correlation — a genuinely different product
  (this is a metrics/alerts/deployments dashboard, not an APM).
- Custom/user-defined metrics or alert rules via UI — `alert_rules` and
  `metrics` are seed-owned; no route supports creating them.
