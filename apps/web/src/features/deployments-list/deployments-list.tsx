"use client";

import { useCallback, useEffect, useState } from "react";
import { DataTable, type Column } from "@/components/data-table/data-table";
import { FilterBar, FilterField } from "@/components/filter-bar/filter-bar";
import { PageHeader } from "@/components/page-header/page-header";
import { Panel } from "@/components/panel/panel";
import { EmptyState, ErrorState, LoadingState } from "@/components/resource-status/resource-status";
import { DeploymentStatusBadge } from "@/components/status-badge/status-badge";
import { describeApiError, isApiError, type ApiError } from "@/lib/api-client";
import { getDeployments, type DeploymentListItem, type DeploymentListResponse } from "@/lib/deployments-client";
import { getServices, type ServiceListItem } from "@/lib/services-client";
import { useApiResource } from "@/lib/use-api-resource";
import { useUrlState } from "@/lib/url-state";
import styles from "./deployments-list.module.css";

const ENVIRONMENTS = ["production", "staging", "development"] as const;
const STATUSES = ["pending", "success", "failed"] as const;

/**
 * Screen 6/6: "what shipped recently," independent of any alert — the
 * secondary journey in docs/spec/02-user-journeys.md. No detail page exists
 * for a single deployment (explicit MVP decision in
 * docs/spec/01-product-definition.md): its only interesting relationship is
 * "which metric spiked after it," which the metric chart's overlay already
 * shows.
 */
export function DeploymentsList({ initialData }: { initialData: DeploymentListResponse | ApiError }) {
  const { get, set } = useUrlState();
  const serviceId = get("serviceId");
  const environment = get("environment") as (typeof ENVIRONMENTS)[number] | undefined;
  const status = get("status") as (typeof STATUSES)[number] | undefined;

  const fetcher = useCallback(() => getDeployments({ serviceId, environment, status }), [serviceId, environment, status]);
  const [state, retry] = useApiResource(fetcher, initialData);

  const [services, setServices] = useState<ServiceListItem[]>([]);
  useEffect(() => {
    void getServices({ limit: 100 }).then((result) => {
      if (!isApiError(result)) setServices(result.items);
    });
  }, []);

  const columns: Column<DeploymentListItem>[] = [
    { key: "serviceName", header: "Service", render: (d) => d.serviceName },
    { key: "environmentName", header: "Environment", render: (d) => d.environmentName },
    { key: "version", header: "Version", render: (d) => <code>{d.version}</code> },
    { key: "status", header: "Status", render: (d) => <DeploymentStatusBadge status={d.status} /> },
    { key: "deployedAt", header: "Deployed at", render: (d) => new Date(d.deployedAt).toLocaleString() },
  ];

  return (
    <div className={styles.page}>
      <PageHeader
        title="Deployments"
        description="What shipped, where, and when. A deployment that lines up with a spike shows as a marker on that metric's chart."
      />
      <Panel flush>
        <div className={styles.filters}>
          <FilterBar>
            <FilterField label="Service" htmlFor="deployments-service">
              <select id="deployments-service" defaultValue={serviceId ?? ""} onChange={(e) => set({ serviceId: e.target.value || undefined })}>
                <option value="">All services</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Environment" htmlFor="deployments-environment">
              <select id="deployments-environment" defaultValue={environment ?? ""} onChange={(e) => set({ environment: e.target.value || undefined })}>
                <option value="">All environments</option>
                {ENVIRONMENTS.map((env) => (
                  <option key={env} value={env}>
                    {env}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Status" htmlFor="deployments-status">
              <select id="deployments-status" defaultValue={status ?? ""} onChange={(e) => set({ status: e.target.value || undefined })}>
                <option value="">All statuses</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </FilterField>
          </FilterBar>
        </div>

        {state.status === "loading" && <LoadingState label="Loading deployments…" />}
        {state.status === "error" && (
          <div className={styles.inset}>
            <ErrorState message={describeApiError(state.error)} onRetry={retry} />
          </div>
        )}
        {state.status === "ready" && state.data.items.length === 0 && <EmptyState message="No deployments match these filters." />}
        {state.status === "ready" && state.data.items.length > 0 && <DataTable columns={columns} rows={state.data.items} />}
      </Panel>
    </div>
  );
}
