# 05 — Visualization architecture

## What this project actually needs

Exactly one non-trivial visualization: a time-series line chart of
`MetricPoint.value` over `ts`, for one metric in one environment, over a
bounded window (≤7 days, ≤1,000 points per `metricPointsQuerySchema`), with
deployment markers overlaid. Everything else on every other screen (Fleet
Overview, Alerts, Deployments) is a filterable, paginated table. This
section is deliberately narrow because the domain is narrow — there is no
seeded data, route, or MVP screen that needs a bar chart, pie chart,
heatmap, or any "exotic" chart type, so none is designed here.

## Chart library: uPlot

**Recommendation: [uPlot](https://github.com/leeoniya/uPlot).** Justified
against this project's actual needs, not a generic library survey:

- **Data volume and update pattern fit.** The chart renders up to 1,000
  points per request today, and per section 06 will receive a new point
  roughly every alert-evaluation tick once real-time push lands. uPlot
  renders to a single `<canvas>` and is purpose-built for exactly this
  case — dense time series that update frequently — via an imperative
  `setData()` call that redraws without any virtual-DOM diffing. At this
  data volume that's not a hard requirement (any library could technically
  render 1,000 points), but it means the real-time-update path (section 06)
  never has to worry about render cost, rather than needing to be
  carefully throttled/batched to avoid janking an SVG-based chart.
- **Bundle cost matches project scale.** ~45KB gzipped, zero dependencies.
  This is a portfolio project demonstrating engineering judgment, not a
  case for a heavyweight charting suite — a multi-hundred-KB library
  (e.g. a full Highcharts/AmCharts license-gated product) would be
  conspicuously oversized for "one line chart with markers."
- **Deployment markers are a first-class uPlot feature** (plugins for
  vertical reference lines with hover annotations), not something that has
  to be hand-rolled in an SVG overlay — directly matches the "deployment
  marker on the chart" requirement from
  [01-product-definition.md](./01-product-definition.md) step 4.

**Rejected alternatives, and why, specifically for this project:**

- **Recharts / Visx / Nivo (SVG, React-idiomatic)** — the natural first
  instinct for a React app, and reasonable for a chart that renders once
  and sits static. Rejected here specifically because of the real-time
  requirement: SVG chart libraries re-render a DOM node per data point on
  every data change, and section 06 has this chart receiving live pushed
  updates — that's the one property this project's chart actually needs
  that a React-idiomatic SVG library handles worse than a canvas library,
  not a stylistic preference.
- **Chart.js** — canvas-based like uPlot, more general-purpose (many chart
  types, larger bundle, ~200KB+ with common plugins), and its update API is
  less purpose-built for high-frequency time-series appends than uPlot's.
  Reasonable second choice; uPlot wins on being smaller and more precisely
  scoped to exactly this use case with nothing unused shipped.
- **TradingView Lightweight Charts** — also canvas, also time-series-native,
  and a legitimate alternative. Rejected because it's opinionated toward
  financial/OHLC chart types (candlesticks, volume bars) this project has
  no use for, and its API is shaped around that domain more than uPlot's
  general-purpose line/area/bar primitives are.
- **Raw D3** — gives full control at the cost of hand-rolling scales, axes,
  interaction, and canvas/SVG rendering from scratch. Justified when a
  chart's visual requirements are genuinely bespoke; this project's chart
  requirement (line + area, threshold reference line, vertical deployment
  markers, tooltip) is squarely inside what uPlot already provides
  out of the box — building it in raw D3 would be reimplementing uPlot
  with more code and more surface for bugs, for no visual requirement this
  project actually has.

## React integration pattern

uPlot is not a React component — it's a DOM library that owns a canvas
element imperatively. The wrapper component holds the uPlot instance in a
`ref`, creates it once on mount (`useEffect` with `[]` deps), and pushes new
data via `uplot.setData(...)` in a separate effect keyed on the data
dependency — never by passing data as a prop that triggers a full
re-render/remount. This is the mechanism [10-performance.md](./10-performance.md)'s
render-count measurement verifies is implemented correctly; getting this
wrong (re-mounting the whole chart on every incoming point) would silently
defeat the entire reason uPlot was chosen.

## Tables: pagination, not virtualization

Every list screen (Fleet Overview, Alerts, Deployments) uses the existing
server-side pagination already implemented in every list route
(`paginationQuerySchema`, capped at 100 rows/page — see
[10-performance.md](./10-performance.md) for why that cap makes
virtualization unnecessary for MVP). Standard `<table>` markup per
[11-accessibility.md](./11-accessibility.md)'s semantic-table requirement,
with sort controlled by the same URL state as filters
([04-frontend-architecture.md](./04-frontend-architecture.md)).

## Filtering, synchronized across chart and table

On the Metric chart screen, the deployment markers overlaid on the chart
and the (optional, secondary) deployments list on the same page must use
the *same* time window and service/environment scope — both are the same
URL-state-owned `start`/`end`/`serviceId`/`environment` params
(section 04), fetched independently (metric points vs. deployments are
different endpoints) but never allowed to drift out of sync, since the
entire point of the overlay (per the primary journey in
[02-user-journeys.md](./02-user-journeys.md)) is that the marker's position
on the chart is trustworthy relative to the spike it's meant to explain.

## Chart interactions (MVP scope)

- Hover tooltip showing exact timestamp + value at the nearest point —
  uPlot's built-in cursor/tooltip plugin.
- Hover on a deployment marker showing version + deployed-at time (the
  fields already in `deploymentListItemSchema`).
- A visible threshold reference line when the metric has an associated
  alert rule, using the rule's `threshold`/`comparator` already returned by
  `alertDetailSchema` — makes the "why did this fire" connection visible on
  the chart itself, not just inferable from the separate alert detail page.
- Time-range adjustment via a small set of preset windows (e.g. last 1h /
  6h / 24h / 7d, the last one being the API's hard cap) rather than a
  full custom date-range picker for MVP — matches the 7-day cap already
  enforced by `timeRangeQuerySchema` and avoids building UI for a range
  the API would reject anyway.

No pan/zoom, brush-to-select-range, or multi-metric overlay is in MVP scope
— consistent with the post-MVP list in
[01-product-definition.md](./01-product-definition.md).
