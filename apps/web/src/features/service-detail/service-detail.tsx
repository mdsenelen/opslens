"use client";

import Link from "next/link";
import { useCallback } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/resource-status/resource-status";
import { describeApiError, type ApiError } from "@/lib/api-client";
import { getService, type ServiceDetail as ServiceDetailData } from "@/lib/services-client";
import { useApiResource } from "@/lib/use-api-resource";
import styles from "./service-detail.module.css";

/**
 * Screen 2 of the primary journey: one service's metrics and the
 * environments they have data in, entry point to the per-metric chart
 * (docs/spec/02-user-journeys.md).
 */
export function ServiceDetail({ serviceId, initialData }: { serviceId: string; initialData: ServiceDetailData | ApiError }) {
  const fetcher = useCallback(() => getService(serviceId), [serviceId]);
  const [state, retry] = useApiResource(fetcher, initialData);

  return (
    <div className={styles.page}>
      <p>
        <Link href="/">← Fleet overview</Link>
      </p>

      {state.status === "loading" && <LoadingState label="Loading service…" />}
      {state.status === "error" && <ErrorState message={describeApiError(state.error)} onRetry={retry} />}
      {state.status === "ready" && (
        <>
          <h1>{state.data.service.name}</h1>
          {state.data.service.description && <p className={styles.description}>{state.data.service.description}</p>}

          <h2>Metrics</h2>
          {state.data.metrics.length === 0 ? (
            <EmptyState message="No metrics defined for this service." />
          ) : (
            <ul className={styles.metricList}>
              {state.data.metrics.map((metric) => (
                <li key={metric.id}>
                  <span className={styles.metricName}>{metric.name}</span>{" "}
                  <span className={styles.metricUnit}>({metric.unit})</span>
                  {state.data.environments.length === 0 ? (
                    <span className={styles.noEnv}> — no environment data yet</span>
                  ) : (
                    <span className={styles.envLinks}>
                      {" — "}
                      {state.data.environments.map((env, i) => (
                        <span key={env.id}>
                          <Link href={`/services/${serviceId}/metrics/${metric.id}?environment=${env.name}`}>{env.name}</Link>
                          {i < state.data.environments.length - 1 ? " · " : ""}
                        </span>
                      ))}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
