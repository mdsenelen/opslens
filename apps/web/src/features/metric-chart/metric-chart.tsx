"use client";

import type { EnvironmentName, MetricPoint } from "@opslens/shared-types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { DataTable, type Column } from "@/components/data-table/data-table";
import { EmptyState, ErrorState, LoadingState } from "@/components/resource-status/resource-status";
import { getAlert, getAlerts } from "@/lib/alerts-client";
import { describeApiError, isApiError, type ApiError } from "@/lib/api-client";
import { getDeployments, type DeploymentListItem } from "@/lib/deployments-client";
import { getMetricPoints, type MetricPointsResponse } from "@/lib/metrics-client";
import { useApiResource } from "@/lib/use-api-resource";
import { useUrlState } from "@/lib/url-state";
import { MetricPointsChart, type Threshold } from "./metric-points-chart";
import styles from "./metric-chart.module.css";

const PRESETS = [
  { label: "1h", hours: 1 },
  { label: "6h", hours: 6 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 24 * 7 },
] as const;

/**
 * The canvas chart is never the only way to get the data
 * (docs/spec/11-accessibility.md's "Metric chart" section) — this computes
 * the same min/max/latest a sighted user reads off the chart's axes and
 * cursor tooltip, stated as plain text instead.
 */
function summarizePoints(points: MetricPoint[]): { count: number; earliest: MetricPoint; latest: MetricPoint; min: MetricPoint; max: MetricPoint } | undefined {
  if (points.length === 0) return undefined;
  let earliest = points[0]!;
  let latest = points[0]!;
  let min = points[0]!;
  let max = points[0]!;
  for (const p of points) {
    if (new Date(p.ts) < new Date(earliest.ts)) earliest = p;
    if (new Date(p.ts) > new Date(latest.ts)) latest = p;
    if (p.value < min.value) min = p;
    if (p.value > max.value) max = p;
  }
  return { count: points.length, earliest, latest, min, max };
}

function MetricSummary({ points, unit }: { points: MetricPoint[]; unit: string }) {
  const summary = summarizePoints(points);
  if (!summary) return null;
  const { count, earliest, latest, min, max } = summary;
  return (
    <p className={styles.summary}>
      {count} points from {new Date(earliest.ts).toLocaleString()} to {new Date(latest.ts).toLocaleString()}, ranging {min.value}–{max.value} {unit}. Latest
      value: <strong>{latest.value} {unit}</strong>.
    </p>
  );
}

/**
 * Screen 3 of the primary journey: the metric's time series with the
 * deployment that likely caused a spike overlaid, and — when an alert
 * already exists for this metric/environment — the threshold that fired it
 * (docs/spec/02-user-journeys.md). Against the seeded scenario this is
 * where the v2.14.0 deploy sits just before the payments-api error-rate
 * spike (apps/api/src/infra/db/seed.ts).
 */
export function MetricChart({
  serviceId,
  metricId,
  environment,
  start,
  end,
  initialData,
}: {
  serviceId: string;
  metricId: string;
  environment: EnvironmentName;
  start: string;
  end: string;
  initialData: MetricPointsResponse | ApiError;
}) {
  const { set } = useUrlState();

  // order: "desc" — the API caps points at 1000 per request
  // (metricPointsQuerySchema), and production's seeded cadence is one
  // point per minute (apps/api/src/infra/db/seed.ts), so a 24h window
  // alone is 1,440 points. Requesting ascending order (the API's default)
  // would silently return the *oldest* 1000 and truncate away the most
  // recent several hours — exactly where a regression is. Points are
  // re-sorted ascending below before rendering, since the chart needs
  // chronological order regardless of fetch order.
  const fetcher = useCallback(() => getMetricPoints(metricId, { environment, start, end, order: "desc" }), [metricId, environment, start, end]);
  const [state, retry] = useApiResource(fetcher, initialData);

  const [deployments, setDeployments] = useState<DeploymentListItem[]>([]);
  useEffect(() => {
    let cancelled = false;
    void getDeployments({ serviceId, environment, start, end, limit: 100 }).then((result) => {
      if (!cancelled && !isApiError(result)) setDeployments(result.items);
    });
    return () => {
      cancelled = true;
    };
  }, [serviceId, environment, start, end]);

  const metricName = state.status === "ready" ? state.data.metric.name : undefined;
  // Tagged with the metricName it was fetched for, so a stale threshold
  // from the previous metric is simply filtered out at render time below
  // instead of needing an unconditional setState(undefined) at the top of
  // the effect (which eslint's react-hooks/set-state-in-effect flags as an
  // avoidable synchronous setState in an effect body).
  const [threshold, setThreshold] = useState<(Threshold & { metricName: string }) | undefined>();
  useEffect(() => {
    if (!metricName) return;
    let cancelled = false;
    // Best-effort only: there is no dedicated "alert rule for this metric"
    // endpoint, so a threshold line shows up only when an alert already
    // exists for this exact metric/environment (docs/spec/05-visualization.md).
    // Finding none is not an error state.
    void (async () => {
      const alerts = await getAlerts({ serviceId, environment, limit: 100 });
      if (cancelled || isApiError(alerts)) return;
      const match = alerts.items.find((a) => a.metricName === metricName);
      if (!match) return;
      const detail = await getAlert(match.id);
      if (cancelled || isApiError(detail)) return;
      setThreshold({ value: detail.rule.threshold, label: `${detail.rule.comparator} ${detail.rule.threshold}`, metricName });
    })();
    return () => {
      cancelled = true;
    };
  }, [serviceId, environment, metricName]);
  const displayedThreshold = threshold?.metricName === metricName ? threshold : undefined;

  // The table alternative below is lazy-rendered — building up to 1,000
  // rows (metricPointsQuerySchema's cap) costs nothing until a keyboard/
  // screen-reader user actually opens the <details>.
  const [tableOpen, setTableOpen] = useState(false);
  const unit = state.status === "ready" ? state.data.metric.unit : "";
  const pointColumns: Column<MetricPoint>[] = [
    { key: "ts", header: "Timestamp", render: (p) => new Date(p.ts).toLocaleString() },
    { key: "value", header: `Value (${unit})`, render: (p) => String(p.value) },
  ];

  return (
    <div className={styles.page}>
      <p>
        <Link href={`/services/${serviceId}`}>← Back to service</Link>
      </p>
      <h1>
        {metricName ?? "Metric"} <span className={styles.environment}>({environment})</span>
      </h1>

      <div className={styles.presets} role="group" aria-label="Time range">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => {
              const now = Date.now();
              set({ start: new Date(now - preset.hours * 3600_000).toISOString(), end: new Date(now).toISOString() });
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {state.status === "loading" && <LoadingState label="Loading metric data…" />}
      {state.status === "error" && <ErrorState message={describeApiError(state.error)} onRetry={retry} />}
      {state.status === "ready" && state.data.points.length === 0 && (
        <EmptyState message={`No data points for this metric in ${environment} in the selected window.`} />
      )}
      {state.status === "ready" && state.data.points.length > 0 && (
        <>
          {displayedThreshold && (
            <p className={styles.thresholdNote}>
              Alert threshold: <strong>{displayedThreshold.label}</strong> {state.data.metric.unit}
            </p>
          )}
          <MetricSummary points={state.data.points} unit={state.data.metric.unit} />
          <MetricPointsChart
            points={state.data.points.map((p) => ({ ts: new Date(p.ts).getTime(), value: p.value })).sort((a, b) => a.ts - b.ts)}
            deployments={deployments.map((d) => ({ id: d.id, ts: new Date(d.deployedAt).getTime(), version: d.version, status: d.status }))}
            threshold={displayedThreshold}
            unit={state.data.metric.unit}
          />
          {/* Same series as the canvas chart above, as a real <table> —
              lazy-rendered (see tableOpen above) since opening it can mean
              up to 1,000 rows. */}
          <details className={styles.pointsTable} onToggle={(e) => setTableOpen(e.currentTarget.open)}>
            <summary>Show data as a table ({state.data.points.length} points)</summary>
            {tableOpen && (
              // tabIndex/role/aria-label: axe's scrollable-region-focusable
              // rule (WCAG 2.1.1/2.1.3) — a div with overflow-y: auto and no
              // other focusable content inside has no keyboard way to
              // scroll it. This gets the same :focus-visible outline as
              // every other focusable element (globals.css's
              // [tabindex]:focus-visible rule).
              <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={`${metricName ?? "Metric"} data table, scrollable`}>
                <DataTable
                  columns={pointColumns}
                  rows={[...state.data.points].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())}
                  caption={`${metricName ?? "Metric"} in ${environment}, chronological`}
                />
              </div>
            )}
          </details>
        </>
      )}

      {deployments.length > 0 && (
        <div className={styles.deploymentList}>
          <h2>Deployments in this window</h2>
          {/* Deployment markers are drawn on the chart's canvas, which isn't
              screen-reader-navigable — this list is the same data as plain
              text, per docs/spec/11-accessibility.md. */}
          <ul>
            {deployments.map((d) => (
              <li key={d.id}>
                <strong>{d.version}</strong> — {d.status} — {new Date(d.deployedAt).toLocaleString()}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
