# 03 — Domain model

Each candidate entity is evaluated against what's actually in
`packages/shared-types/src/*` and `apps/api/src/infra/db/migrations/*` — not
assumed by default because it's a common dashboard-domain noun.

## Adopted as-is (already fully modeled)

### Service
`packages/shared-types/src/service.ts`. `id`, `name`, `slug` (kebab-case,
enforced by regex), `description` (nullable), `createdAt`. Unique on both
`name` and `slug` at the DB level (`create-services.ts:10-11`). No changes
needed for MVP.

### Environment
`packages/shared-types/src/environment.ts`. Deliberately thin — a closed
three-value enum (`production`, `staging`, `development`) plus an `id`, not a
rich aggregate. The schema file's own comment
(`environment.ts:3-6`) already states this is intentional: "a lookup
dimension, not a rich aggregate." Adopted as-is; there is no seeded data or
route that treats Environment as anything richer (no per-environment config,
no environment-level metadata beyond the name).

### Metric
`packages/shared-types/src/metric.ts`. `id`, `serviceId`, `name`, `unit`,
`kind` (`gauge` | `counter` | `histogram`), `createdAt`. Unique on
`(service_id, name)` (`create-metrics.ts:33`). Adopted as-is. Note for
section 05: only `gauge` kind is actually seeded (`p95_latency_ms`,
`error_rate_pct` — `seed.ts:93-118`); the chart architecture should not
special-case `counter`/`histogram` rendering for MVP since no seeded data
exercises it, but the schema's `kind` field is preserved for future use.

### MetricPoint
`packages/shared-types/src/metric-point.ts`. `id`, `metricId`,
`environmentId`, `ts`, `value`. No natural key — the migration
(`create-metric-points.ts`) has no unique constraint, matching the seed
script's own comment that these are "wholly owned" generated data with no
sensible upsert key. Adopted as-is.

### AlertRule
`packages/shared-types/src/alert-rule.ts`. `id`, `metricId`, `comparator`
(`gt`/`gte`/`lt`/`lte`), `threshold`, `durationSeconds`, `severity`
(`info`/`warning`/`critical`), `enabled`, `createdAt`. Adopted as-is — this
is the entity `alert-evaluator.ts`'s pure `evaluateRule` function operates
against, and its shape already exactly matches what the evaluator needs
(nothing more, nothing less).

### Alert
`packages/shared-types/src/alert.ts`. `id`, `alertRuleId`, `serviceId`,
`environmentId`, `status` (`firing`/`acknowledged`/`resolved`), `firedAt`,
`acknowledgedAt`, `resolvedAt`. Adopted as-is. Note: `serviceId` is
denormalized onto Alert even though it's derivable via
`alertRuleId → metricId → serviceId` — this is deliberate and correct: the
evaluation job needs it directly for the alert-list "filter by service"
query path (`alerts.routes.ts`'s `WHERE a.service_id=$n`) without a join
back through `alert_rules → metrics`, and it's what `alert-evaluation-job.ts`
already writes on insert (`alert-evaluation-job.ts:13`). No change proposed.

### Deployment
`packages/shared-types/src/deployment.ts`. `id`, `serviceId`,
`environmentId`, `version`, `status` (`pending`/`success`/`failed`),
`deployedAt`. Adopted as-is.

## Evaluated and rejected for MVP

### Incident
**Excluded, not deferred.** An Incident would aggregate one-or-more related
Alerts into a single higher-level record (with its own lifecycle, owner,
timeline) — the classic pattern at organizations running many services where
one root cause fans out into a dozen simultaneous alerts. At this fleet's
scale (four services, two metrics each, the seed data firing exactly one
alert) that fan-out never happens: one Alert already *is* the incident. There
is no schema table, no migration, no route, and no seeded scenario that
implies a many-alerts-to-one-incident relationship. Introducing Incident now
would be modeling for a fleet size this project doesn't have and isn't
simulating. Revisit only if the product direction changes to explicitly model
multi-service cascading failures.

### Dashboard / DashboardWidget
**Excluded, not deferred.** These would model a user-configurable,
persisted arrangement of widgets — the schema has no `dashboards` or
`dashboard_widgets` table, no route, and critically, no concept of a user to
own a saved layout in the first place (no auth, no user table anywhere in
the migrations). The Fleet Overview screen (section 01) already serves as
the single dashboard this product needs; building a generic
widget-composition system for one fixed layout would be the single largest
scope-inflation risk in this spec. If a second, meaningfully different
overview layout is ever needed, it should be a second hard-coded route, not
a widget framework.

## Evaluated and folded into existing concepts (not separate entities)

### TimeRange
Not a persisted entity — it's a query parameter shape, and it already exists
as one: `timeRangeQuerySchema` in `packages/shared-types/src/api.ts:29-35`
(`start`/`end`, validated to be ordered and ≤7 days apart). The frontend
should represent it as URL search-state (section 04), not as a domain model
object. No new schema needed.

### Filter
Same treatment as TimeRange — filters are just the existing list-query
schemas (`serviceListQuerySchema`, `alertListQuerySchema`,
`deploymentListQuerySchema`, `metricListQuerySchema`), each already
Zod-validated per endpoint. There is no cross-cutting "Filter" entity to
design; each screen's filter state is that screen's query schema, held in
the URL (section 04).

## Summary table

| Candidate | Verdict | Reason |
|---|---|---|
| Service | Adopt as-is | Fully modeled, no gaps |
| Environment | Adopt as-is | Deliberately thin lookup, per schema's own comment |
| Metric | Adopt as-is | Fully modeled |
| MetricPoint | Adopt as-is | Fully modeled, no natural key by design |
| AlertRule | Adopt as-is | Matches evaluator's exact needs |
| Alert | Adopt as-is | Denormalized `serviceId` is deliberate, not a smell |
| Deployment | Adopt as-is | Fully modeled |
| Incident | **Exclude from MVP and roadmap** | No fan-out at this fleet scale; one alert is the incident |
| Dashboard/DashboardWidget | **Exclude from MVP and roadmap** | No persisted-layout schema, no user to own it, one layout suffices |
| TimeRange | Fold into query state | Already `timeRangeQuerySchema`; URL state, not a domain entity |
| Filter | Fold into query state | Already per-endpoint list-query schemas; URL state, not a domain entity |
