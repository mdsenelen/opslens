import {
  alertDetailSchema,
  alertListItemSchema,
  alertListQuerySchema,
  paginatedSchema,
} from "@opslens/shared-types";
import type { z } from "zod";
import { fetchApi, toQueryString, type ApiError } from "./api-client";

export type AlertListItem = z.infer<typeof alertListItemSchema>;
export type AlertDetail = z.infer<typeof alertDetailSchema>;

// Derived from the API's own query schema (output side, so defaults are
// optional here and numbers stay numbers), not hand-copied: a new filter or
// sort key there reaches this type without a second edit.
export type AlertListQuery = Partial<z.output<typeof alertListQuerySchema>>;

const alertListResponseSchema = paginatedSchema(alertListItemSchema);
export type AlertListResponse = z.infer<typeof alertListResponseSchema>;

export async function getAlerts(query: AlertListQuery = {}): Promise<AlertListResponse | ApiError> {
  return fetchApi(`/api/alerts${toQueryString(query)}`, alertListResponseSchema);
}

export async function getAlert(alertId: string): Promise<AlertDetail | ApiError> {
  return fetchApi(`/api/alerts/${alertId}`, alertDetailSchema);
}
