import {
  metricListQuerySchema,
  metricPointsQuerySchema,
  metricPointsResponseSchema,
  metricSchema,
  paginatedSchema,
} from "@opslens/shared-types";
import type { z } from "zod";
import { fetchApi, toQueryString, type ApiError } from "./api-client";

export type Metric = z.infer<typeof metricSchema>;
export type MetricPointsResponse = z.infer<typeof metricPointsResponseSchema>;

// Derived from the API's own query schema (output side, so defaults are
// optional here and numbers stay numbers), not hand-copied: a new filter or
// sort key there reaches this type without a second edit.
export type MetricListQuery = Partial<z.output<typeof metricListQuerySchema>>;

// environment/start/end are required by the API's metricPointsQuerySchema
// (packages/shared-types/src/api.ts) — no server-side default exists for
// any of them — so only limit and order are optional here.
type MetricPointsQueryOutput = z.output<typeof metricPointsQuerySchema>;
export type MetricPointsQuery = Pick<MetricPointsQueryOutput, "environment" | "start" | "end"> & Partial<Pick<MetricPointsQueryOutput, "limit" | "order">>;

// The API's per-request cap on metric points (metricPointsQuerySchema).
// Callers pass it explicitly: left unset, the API's default of 500 silently
// cut a "24h" window down to its most recent ~8 hours at production's
// one-point-per-minute cadence.
export const METRIC_POINT_LIMIT = 1000;

const metricListResponseSchema = paginatedSchema(metricSchema);
export type MetricListResponse = z.infer<typeof metricListResponseSchema>;

export async function getMetrics(query: MetricListQuery = {}): Promise<MetricListResponse | ApiError> {
  return fetchApi(`/api/metrics${toQueryString(query)}`, metricListResponseSchema);
}

export async function getMetricPoints(metricId: string, query: MetricPointsQuery): Promise<MetricPointsResponse | ApiError> {
  return fetchApi(`/api/metrics/${metricId}/points${toQueryString(query)}`, metricPointsResponseSchema);
}
