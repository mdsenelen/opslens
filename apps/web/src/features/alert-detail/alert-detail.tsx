"use client";

import type { Alert } from "@opslens/shared-types";
import Link from "next/link";
import { useCallback, useState } from "react";
import { ErrorState, LoadingState } from "@/components/resource-status/resource-status";
import { SeverityBadge, StatusBadge } from "@/components/status-badge/status-badge";
import { describeApiError, type ApiError } from "@/lib/api-client";
import { getAlert, type AlertDetail as AlertDetailData } from "@/lib/alerts-client";
import { useRealtimeAlerts } from "@/lib/realtime-client";
import { useApiResource } from "@/lib/use-api-resource";
import styles from "./alert-detail.module.css";

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
  const handleAlertChange = useCallback(
    (alert: Alert) => {
      if (alert.id === alertId) setLiveStatus(alert.status);
    },
    [alertId],
  );
  useRealtimeAlerts(serviceId, handleAlertChange, retry);

  if (state.status === "loading") return <LoadingState label="Loading alert…" />;
  if (state.status === "error") return <ErrorState message={describeApiError(state.error)} onRetry={retry} />;

  const alert = state.data;
  const status = liveStatus ?? alert.status;

  return (
    <div className={styles.page}>
      <p>
        <Link href="/alerts">← Alerts</Link>
      </p>
      <div className={styles.header}>
        <h1>{alert.metricName}</h1>
        <StatusBadge status={status} />
        <SeverityBadge severity={alert.severity} />
      </div>

      <dl className={styles.details}>
        <dt>Service</dt>
        <dd>
          <Link href={`/services/${alert.serviceId}`}>{alert.serviceName}</Link>
        </dd>
        <dt>Environment</dt>
        <dd>{alert.environmentName}</dd>
        <dt>Rule</dt>
        <dd>
          {alert.rule.comparator} {alert.rule.threshold} for {alert.rule.durationSeconds}s
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

      <p>
        <Link href={`/services/${alert.serviceId}`}>View this service&apos;s metrics →</Link>
      </p>
    </div>
  );
}
