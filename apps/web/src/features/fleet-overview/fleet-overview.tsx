"use client";

import { useCallback } from "react";
import { DataTable, type Column } from "@/components/data-table/data-table";
import { FilterBar, FilterField } from "@/components/filter-bar/filter-bar";
import { EmptyState, ErrorState, LoadingState } from "@/components/resource-status/resource-status";
import { describeApiError, type ApiError } from "@/lib/api-client";
import { getServices, type ServiceListItem, type ServiceListResponse } from "@/lib/services-client";
import { useApiResource } from "@/lib/use-api-resource";
import { useUrlState } from "@/lib/url-state";
import styles from "./fleet-overview.module.css";

const ENVIRONMENTS = ["production", "staging", "development"] as const;

/**
 * Screen 1 of the primary journey (docs/spec/02-user-journeys.md): scan for
 * a nonzero active-alert count, then drill into the flagged service. The
 * seeded regression always surfaces here — payments-api carries one firing
 * alert (apps/api/src/infra/db/seed.ts).
 */
export function FleetOverview({ initialData }: { initialData: ServiceListResponse | ApiError }) {
  const { get, set } = useUrlState();
  const q = get("q");
  const environment = get("environment") as (typeof ENVIRONMENTS)[number] | undefined;

  const fetcher = useCallback(() => getServices({ q, environment }), [q, environment]);
  const [state, retry] = useApiResource(fetcher, initialData);

  const columns: Column<ServiceListItem>[] = [
    { key: "name", header: "Service", render: (s) => s.name },
    {
      key: "activeAlertCount",
      header: "Active alerts",
      render: (s) => (s.activeAlertCount > 0 ? <strong className={styles.alertCount}>{s.activeAlertCount}</strong> : "0"),
    },
    { key: "description", header: "Description", render: (s) => s.description ?? "—" },
  ];

  return (
    <div className={styles.page}>
      <h1>Fleet overview</h1>
      <FilterBar>
        <FilterField label="Search" htmlFor="fleet-search">
          <input id="fleet-search" type="search" defaultValue={q ?? ""} onChange={(e) => set({ q: e.target.value || undefined })} placeholder="Service name…" />
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

      {state.status === "loading" && <LoadingState label="Loading services…" />}
      {state.status === "error" && <ErrorState message={describeApiError(state.error)} onRetry={retry} />}
      {state.status === "ready" && state.data.items.length === 0 && <EmptyState message="No services match these filters." />}
      {state.status === "ready" && state.data.items.length > 0 && <DataTable columns={columns} rows={state.data.items} getRowHref={(s) => `/services/${s.id}`} />}
    </div>
  );
}
