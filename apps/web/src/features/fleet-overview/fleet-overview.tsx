"use client";

import { useCallback } from "react";
import { DataTable, type Column } from "@/components/data-table/data-table";
import { FilterBar, FilterField } from "@/components/filter-bar/filter-bar";
import { LiveIndicator } from "@/components/live-indicator/live-indicator";
import { PageHeader } from "@/components/page-header/page-header";
import { Panel } from "@/components/panel/panel";
import { EmptyState, ErrorState, LoadingState } from "@/components/resource-status/resource-status";
import { StatGroup, StatTile } from "@/components/stat-tile/stat-tile";
import { AlertCountBadge } from "@/components/status-badge/status-badge";
import { describeApiError, type ApiError } from "@/lib/api-client";
import { useConnectionAnnouncements, useRealtimeAlerts } from "@/lib/realtime-client";
import { getServices, type ServiceListItem, type ServiceListResponse } from "@/lib/services-client";
import { useApiResource } from "@/lib/use-api-resource";
import { useLiveAnnouncer } from "@/lib/use-live-announcer";
import { useUrlState } from "@/lib/url-state";
import styles from "./fleet-overview.module.css";

const ENVIRONMENTS = ["production", "staging", "development"] as const;

/**
 * Screen 1 of the primary journey (docs/spec/02-user-journeys.md): scan for
 * a nonzero active-alert count, then drill into the flagged service.
 *
 * Alert counts follow the realtime stream: any alert-status event triggers
 * a background refresh of the list (the event names one alert, but the
 * counts are per service and filtered, so refetching is simpler than
 * patching). No per-event announcement here; the alerts list is where
 * individual transitions are announced.
 */
export function FleetOverview({ initialData }: { initialData: ServiceListResponse | ApiError }) {
  const { get, set } = useUrlState();
  const q = get("q");
  const environment = get("environment") as (typeof ENVIRONMENTS)[number] | undefined;

  const fetcher = useCallback(() => getServices({ q, environment }), [q, environment]);
  const [state, retry, refresh] = useApiResource(fetcher, initialData);

  const [liveAnnouncement, announce] = useLiveAnnouncer();
  const connectionState = useRealtimeAlerts(undefined, refresh, refresh);
  useConnectionAnnouncements(connectionState, announce);

  const columns: Column<ServiceListItem>[] = [
    { key: "name", header: "Service", render: (s) => s.name },
    {
      key: "activeAlertCount",
      header: "Active alerts",
      render: (s) => <AlertCountBadge count={s.activeAlertCount} />,
    },
    { key: "description", header: "Description", render: (s) => <span className={styles.description}>{s.description ?? "No description"}</span> },
  ];

  // Derived from the list already on screen, not a second request: these
  // tiles describe exactly the rows below, filters included.
  const items = state.status === "ready" ? state.data.items : undefined;
  const alerting = items?.filter((s) => s.activeAlertCount > 0).length;

  return (
    <div className={styles.page}>
      <PageHeader
        title="Fleet overview"
        description="Every service in the fleet and whether it has an open alert. Start with anything that is alerting."
        actions={<LiveIndicator state={connectionState} />}
      />

      <div aria-live="polite" className="srOnly">
        {liveAnnouncement}
      </div>

      {items && alerting !== undefined && (
        <StatGroup label="Fleet summary">
          <StatTile label="Services" value={items.length} />
          <StatTile label="Healthy" value={items.length - alerting} icon="✓" tone="positive" />
          <StatTile label="With active alerts" value={alerting} icon="⚠" tone={alerting > 0 ? "negative" : "neutral"} />
        </StatGroup>
      )}

      <Panel
        flush
        title="Services"
        actions={
          <FilterBar>
            <FilterField label="Search" htmlFor="fleet-search">
              <input
                id="fleet-search"
                type="search"
                defaultValue={q ?? ""}
                onChange={(e) => set({ q: e.target.value || undefined })}
                placeholder="Service name…"
              />
            </FilterField>
            <FilterField label="Environment" htmlFor="fleet-environment">
              <select id="fleet-environment" defaultValue={environment ?? ""} onChange={(e) => set({ environment: e.target.value || undefined })}>
                <option value="">All environments</option>
                {ENVIRONMENTS.map((env) => (
                  <option key={env} value={env}>
                    {env}
                  </option>
                ))}
              </select>
            </FilterField>
          </FilterBar>
        }
      >
        {state.status === "loading" && <LoadingState label="Loading services…" />}
        {state.status === "error" && (
          <div className={styles.inset}>
            <ErrorState message={describeApiError(state.error)} onRetry={retry} />
          </div>
        )}
        {state.status === "ready" && state.data.items.length === 0 && <EmptyState message="No services match these filters." />}
        {state.status === "ready" && state.data.items.length > 0 && (
          <DataTable columns={columns} rows={state.data.items} getRowHref={(s) => `/services/${s.id}`} />
        )}
      </Panel>
    </div>
  );
}
