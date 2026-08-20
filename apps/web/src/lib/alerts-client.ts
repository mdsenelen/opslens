import {
  alertDetailSchema,
  alertListItemSchema,
  paginatedSchema,
  type AlertSeverity,
  type AlertStatus,
  type EnvironmentName,
} from "@opslens/shared-types";
import type { z } from "zod";
import { fetchApi, toQueryString, type ApiError } from "./api-client";

export type AlertListItem = z.infer<typeof alertListItemSchema>;
export type AlertDetail = z.infer<typeof alertDetailSchema>;

export type AlertListQuery = {
  serviceId?: string;
  environment?: EnvironmentName;
  status?: AlertStatus;
  severity?: AlertSeverity;
  page?: number;
  limit?: number;
  sort?: "firedAt" | "status";
  order?: "asc" | "desc";
};

const alertListResponseSchema = paginatedSchema(alertListItemSchema);
export type AlertListResponse = z.infer<typeof alertListResponseSchema>;

export async function getAlerts(query: AlertListQuery = {}): Promise<AlertListResponse | ApiError> {
  return fetchApi(`/api/alerts${toQueryString(query)}`, alertListResponseSchema);
}

export async function getAlert(alertId: string): Promise<AlertDetail | ApiError> {
  return fetchApi(`/api/alerts/${alertId}`, alertDetailSchema);
}
