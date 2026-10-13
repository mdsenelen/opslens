"use client";

import Link from "next/link";
import { useCallback } from "react";
import { PageHeader } from "@/components/page-header/page-header";
import { Panel } from "@/components/panel/panel";
import { EmptyState, ErrorState, LoadingState } from "@/components/resource-status/resource-status";
import { describeApiError, type ApiError } from "@/lib/api-client";
import { getService, type ServiceDetail as ServiceDetailData } from "@/lib/services-client";
import { useApiResource } from "@/lib/use-api-resource";
import styles from "./service-detail.module.css";

const BACK = { href: "/", label: "Fleet overview" };

/**
 * Screen 2 of the primary journey: one service's metrics and the
 * environments they have data in, entry point to the per-metric chart
 * (docs/spec/02-user-journeys.md).
 */
export function ServiceDetail({ serviceId, initialData }: { serviceId: string; initialData: ServiceDetailData | ApiError }) {
  const fetcher = useCallback(() => getService(serviceId), [serviceId]);
  const [state, retry] = useApiResource(fetcher, initialData);

  if (state.status === "loading") {
    return (
      <div className={styles.page}>
        <PageHeader back={BACK} title="Service" />
        <LoadingState label="Loading service…" />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className={styles.page}>
        <PageHeader back={BACK} title="Service" />
        <ErrorState message={describeApiError(state.error)} onRetry={retry} />
      </div>
    );
  }

  const { service, metrics, environments } = state.data;

  return (
    <div className={styles.page}>
      <PageHeader
        back={BACK}
        title={service.name}
        meta={<code>{service.slug}</code>}
        description={service.description ?? undefined}
        actions={
          <>
            <Link className={styles.secondaryLink} href={`/alerts?serviceId=${serviceId}`}>
              Open alerts
            </Link>
            <Link className={styles.secondaryLink} href={`/deployments?serviceId=${serviceId}`}>
              Deployment history
            </Link>
          </>
        }
      />

      <Panel title="Metrics" description="Pick a metric and an environment to open its chart, with deployments and the alert threshold overlaid.">
        {metrics.length === 0 ? (
          <EmptyState message="No metrics defined for this service." />
        ) : (
          <ul className={styles.metricList}>
            {metrics.map((metric) => (
              <li key={metric.id} className={styles.metric}>
                <div className={styles.metricInfo}>
                  <code className={styles.metricName}>{metric.name}</code>
                  <span className={styles.metricUnit}>{metric.unit}</span>
                </div>
                {environments.length === 0 ? (
                  <span className={styles.noEnv}>No environment data yet</span>
                ) : (
                  <span className={styles.envLinks}>
                    {environments.map((env) => (
                      <Link key={env.id} className={styles.envLink} href={`/services/${serviceId}/metrics/${metric.id}?environment=${env.name}`}>
                        {env.name}
                        <span aria-hidden="true">→</span>
                      </Link>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
