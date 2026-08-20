"use client";

import type { Alert } from "@opslens/shared-types";
import { useCallback, useEffect, useState } from "react";
import { DataTable, type Column } from "@/components/data-table/data-table";
import { FilterBar, FilterField } from "@/components/filter-bar/filter-bar";
import { EmptyState, ErrorState, LoadingState } from "@/components/resource-status/resource-status";
import { SeverityBadge, StatusBadge } from "@/components/status-badge/status-badge";
import { describeApiError, isApiError, type ApiError } from "@/lib/api-client";
import { getAlerts, type AlertListItem, type AlertListResponse } from "@/lib/alerts-client";
import { useRealtimeAlerts } from "@/lib/realtime-client";
import { getServices, type ServiceListItem } from "@/lib/services-client";
import { useApiResource } from "@/lib/use-api-resource";
import { useUrlState } from "@/lib/url-state";
import styles from "./alerts-list.module.css";

const ENVIRONMENTS = ["production", "staging", "development"] as const;
const STATUSES = ["firing", "acknowledged", "resolved"] as const;
const SEVERITIES = ["info", "warning", "critical"] as const;

/**
 * The "what's on fire" screen, filterable and live-updating. Screen 4/6 of
 * the MVP (docs/spec/01-product-definition.md); step 5-6 of the primary
 * journey when entered from the fleet overview, or the entry point of the
 * "triage the alert list" secondary journey (docs/spec/02-user-journeys.md).
 */
export function AlertsList({ initialData }: { initialData: AlertListResponse | ApiError }) {
  const { get, set } = useUrlState();
  const serviceId = get("serviceId");
  const environment = get("environment") as (typeof ENVIRONMENTS)[number] | undefined;
  const status = get("status") as (typeof STATUSES)[number] | undefined;
  const severity = get("severity") as (typeof SEVERITIES)[number] | undefined;

  const fetcher = useCallback(() => getAlerts({ serviceId, environment, status, severity }), [serviceId, environment, status, severity]);
  const [state, retry] = useApiResource(fetcher, initialData);

  const [services, setServices] = useState<ServiceListItem[]>([]);
  useEffect(() => {
    void getServices({ limit: 100 }).then((result) => {
      if (!isApiError(result)) setServices(result.items);
    });
  }, []);

  // A status change can add/remove a row from the current filters (e.g.
  // status=firing), so the live-update strategy here is "refetch the
  // filtered list on notification" rather than patching one row in place —
  // simpler and correct at this dataset size. alert-detail.tsx (a single
  // alert, no filter-membership question) patches in place instead.
  const [liveAnnouncement, setLiveAnnouncement] = useState("");
  const handleAlertChange = useCallback(
    (alert: Alert) => {
      setLiveAnnouncement(`An alert is now ${alert.status}.`);
      retry();
    },
    [retry],
  );
  const connectionState = useRealtimeAlerts(serviceId, handleAlertChange, retry);

  const columns: Column<AlertListItem>[] = [
    { key: "serviceName", header: "Service", render: (a) => a.serviceName },
    { key: "metricName", header: "Metric", render: (a) => a.metricName },
    { key: "environmentName", header: "Environment", render: (a) => a.environmentName },
    { key: "severity", header: "Severity", render: (a) => <SeverityBadge severity={a.severity} /> },
    { key: "status", header: "Status", render: (a) => <StatusBadge status={a.status} /> },
    { key: "firedAt", header: "Fired at", render: (a) => new Date(a.firedAt).toLocaleString() },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>Alerts</h1>
        {connectionState !== "open" && (
          <span className={styles.connectionBadge}>
            {connectionState === "connecting" && "Connecting to live updates…"}
            {connectionState === "reconnecting" && "Reconnecting…"}
            {connectionState === "lost" && "Live updates paused"}
          </span>
        )}
      </div>

      {/* Screen-reader-only live region for status transitions — polite,
          not assertive, so a background change doesn't interrupt the user
          (docs/spec/11-accessibility.md). */}
      <div aria-live="polite" className={styles.srOnly}>
        {liveAnnouncement}
      </div>

      <FilterBar>
        <FilterField label="Service" htmlFor="alerts-service">
          <select id="alerts-service" defaultValue={serviceId ?? ""} onChange={(e) => set({ serviceId: e.target.value || undefined })}>
            <option value="">All services</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Environment" htmlFor="alerts-environment">
          <select id="alerts-environment" defaultValue={environment ?? ""} onChange={(e) => set({ environment: e.target.value || undefined })}>
            <option value="">All environments</option>
            {ENVIRONMENTS.map((env) => (
              <option key={env} value={env}>
                {env}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Status" htmlFor="alerts-status">
          <select id="alerts-status" defaultValue={status ?? ""} onChange={(e) => set({ status: e.target.value || undefined })}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Severity" htmlFor="alerts-severity">
          <select id="alerts-severity" defaultValue={severity ?? ""} onChange={(e) => set({ severity: e.target.value || undefined })}>
            <option value="">All severities</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </FilterField>
      </FilterBar>

      {state.status === "loading" && <LoadingState label="Loading alerts…" />}
      {state.status === "error" && <ErrorState message={describeApiError(state.error)} onRetry={retry} />}
      {state.status === "ready" && state.data.items.length === 0 && <EmptyState message="No alerts match these filters." />}
      {state.status === "ready" && state.data.items.length > 0 && <DataTable columns={columns} rows={state.data.items} getRowHref={(a) => `/alerts/${a.id}`} />}
    </div>
  );
}
