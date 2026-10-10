"use client";

import type { Alert } from "@opslens/shared-types";
import Link from "next/link";
import { useCallback, useState } from "react";
import { LiveIndicator } from "@/components/live-indicator/live-indicator";
import { PageHeader } from "@/components/page-header/page-header";
import { Panel } from "@/components/panel/panel";
import { ErrorState, LoadingState } from "@/components/resource-status/resource-status";
import { SeverityBadge, StatusBadge } from "@/components/status-badge/status-badge";
import { describeApiError, type ApiError } from "@/lib/api-client";
import { getAlert, type AlertDetail as AlertDetailData } from "@/lib/alerts-client";
import { useConnectionAnnouncements, useRealtimeAlerts } from "@/lib/realtime-client";
import { useApiResource } from "@/lib/use-api-resource";
import { useLiveAnnouncer } from "@/lib/use-live-announcer";
import styles from "./alert-detail.module.css";

// The chart link opens a window centred on the moment the alert fired:
// wide enough to include the deployment that usually precedes a spike,
// narrow enough that the spike isn't flattened by a day of baseline.
const INVESTIGATION_WINDOW_MS = 3 * 3600_000;

function chartHref(alert: AlertDetailData): string {
  const firedAt = new Date(alert.firedAt).getTime();
  const params = new URLSearchParams({
    environment: alert.environmentName,
    start: new Date(firedAt - INVESTIGATION_WINDOW_MS).toISOString(),
    end: new Date(firedAt + INVESTIGATION_WINDOW_MS).toISOString(),
  });
  return `/services/${alert.serviceId}/metrics/${alert.rule.metricId}?${params.toString()}`;
}

/**
 * Screen 5/6: one alert and the rule that fired it — the confirmation step
 * of the primary journey (docs/spec/02-user-journeys.md, step 6). A single
 * alert has no filter-membership question, so live updates patch this one
 * object in place rather than the alerts-list screen's refetch-on-event
 * strategy.
 */
export function AlertDetail({ alertId, initialData }: { alertId: string; initialData: AlertDetailData | ApiError }) {
  const fetcher = useCallback(() => getAlert(alertId), [alertId]);
  const [state, retry] = useApiResource(fetcher, initialData);

  const serviceId = state.status === "ready" ? state.data.serviceId : undefined;
  const [liveStatus, setLiveStatus] = useState<AlertDetailData["status"] | null>(null);
  const [liveAnnouncement, announce] = useLiveAnnouncer();
  const handleAlertChange = useCallback(
    (alert: Alert) => {
      if (alert.id === alertId) {
        setLiveStatus(alert.status);
        announce(`An alert is now ${alert.status}.`);
      }
    },
    [alertId, announce],
  );
  const connectionState = useRealtimeAlerts(serviceId, handleAlertChange, retry);
  useConnectionAnnouncements(connectionState, announce);

  if (state.status === "loading") return <LoadingState label="Loading alert…" />;
  if (state.status === "error") return <ErrorState message={describeApiError(state.error)} onRetry={retry} />;

  const alert = state.data;
  const status = liveStatus ?? alert.status;

  return (
    <div className={styles.page}>
      <PageHeader
        back={{ href: "/alerts", label: "All alerts" }}
        title={<code className={styles.title}>{alert.metricName}</code>}
        meta={
          <>
            <StatusBadge status={status} />
            <SeverityBadge severity={alert.severity} />
            <span>
              {alert.serviceName} · {alert.environmentName}
            </span>
          </>
        }
        actions={<LiveIndicator state={connectionState} />}
      />

      {/* Screen-reader-only live region for status transitions and
          connection changes: polite, not assertive, so a background
          change doesn't interrupt the user (docs/spec/11-accessibility.md).
          Throttled via useLiveAnnouncer so a burst of events coalesces into
          one utterance. */}
      <div aria-live="polite" className={styles.srOnly}>
        {liveAnnouncement}
      </div>

      <div className={styles.grid}>
        <Panel title="Details">
          <dl className={styles.details}>
            <dt>Service</dt>
            <dd>
              <Link href={`/services/${alert.serviceId}`} className={styles.inlineLink}>
                {alert.serviceName}
              </Link>
            </dd>
            <dt>Environment</dt>
            <dd>{alert.environmentName}</dd>
            <dt>Rule</dt>
            <dd>
              <code>
                {alert.rule.comparator} {alert.rule.threshold} for {alert.rule.durationSeconds}s
              </code>
            </dd>
            <dt>Fired at</dt>
            <dd>{new Date(alert.firedAt).toLocaleString()}</dd>
            {alert.acknowledgedAt && (
              <>
                <dt>Acknowledged at</dt>
                <dd>{new Date(alert.acknowledgedAt).toLocaleString()}</dd>
              </>
            )}
            {alert.resolvedAt && (
              <>
                <dt>Resolved at</dt>
                <dd>{new Date(alert.resolvedAt).toLocaleString()}</dd>
              </>
            )}
          </dl>
        </Panel>

        <Panel title="Investigate">
          <p className={styles.investigateText}>
            Open the metric that fired, three hours either side of the alert, with every deployment in that window and the rule&apos;s threshold drawn on the
            chart.
          </p>
          <div className={styles.investigateActions}>
            <Link href={chartHref(alert)} className={styles.primaryLink}>
              Open the metric chart <span aria-hidden="true">→</span>
            </Link>
            <Link href={`/services/${alert.serviceId}`} className={styles.inlineLink}>
              All of this service&apos;s metrics
            </Link>
          </div>
        </Panel>
      </div>
    </div>
  );
}
