import {
  metricPointsResponseSchema,
  metricSchema,
  paginatedSchema,
  type EnvironmentName,
} from "@opslens/shared-types";
import type { z } from "zod";
import { fetchApi, toQueryString, type ApiError } from "./api-client";

export type Metric = z.infer<typeof metricSchema>;
export type MetricPointsResponse = z.infer<typeof metricPointsResponseSchema>;

export type MetricListQuery = {
  serviceId?: string;
  name?: string;
  page?: number;
  limit?: number;
  sort?: "name" | "createdAt";
  order?: "asc" | "desc";
};

// environment/start/end are required by the API's metricPointsQuerySchema
// (packages/shared-types/src/api.ts) — no server-side default exists for
// any of them.
export type MetricPointsQuery = {
  environment: EnvironmentName;
  start: string;
  end: string;
  limit?: number;
  order?: "asc" | "desc";
};

const metricListResponseSchema = paginatedSchema(metricSchema);
export type MetricListResponse = z.infer<typeof metricListResponseSchema>;

export async function getMetrics(query: MetricListQuery = {}): Promise<MetricListResponse | ApiError> {
  return fetchApi(`/api/metrics${toQueryString(query)}`, metricListResponseSchema);
}

export async function getMetricPoints(metricId: string, query: MetricPointsQuery): Promise<MetricPointsResponse | ApiError> {
  return fetchApi(`/api/metrics/${metricId}/points${toQueryString(query)}`, metricPointsResponseSchema);
}
