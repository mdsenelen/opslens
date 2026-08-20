"use client";

import type { EnvironmentName } from "@opslens/shared-types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
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
          <MetricPointsChart
            points={state.data.points.map((p) => ({ ts: new Date(p.ts).getTime(), value: p.value })).sort((a, b) => a.ts - b.ts)}
            deployments={deployments.map((d) => ({ id: d.id, ts: new Date(d.deployedAt).getTime(), version: d.version, status: d.status }))}
            threshold={displayedThreshold}
            unit={state.data.metric.unit}
          />
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
