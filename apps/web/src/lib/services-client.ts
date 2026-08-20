import {
  paginatedSchema,
  serviceDetailSchema,
  serviceListItemSchema,
  type EnvironmentName,
} from "@opslens/shared-types";
import type { z } from "zod";
import { fetchApi, toQueryString, type ApiError } from "./api-client";

export type ServiceListItem = z.infer<typeof serviceListItemSchema>;
export type ServiceDetail = z.infer<typeof serviceDetailSchema>;

export type ServiceListQuery = {
  q?: string;
  environment?: EnvironmentName;
  page?: number;
  limit?: number;
  sort?: "name" | "createdAt";
  order?: "asc" | "desc";
};

const serviceListResponseSchema = paginatedSchema(serviceListItemSchema);
export type ServiceListResponse = z.infer<typeof serviceListResponseSchema>;

export async function getServices(query: ServiceListQuery = {}): Promise<ServiceListResponse | ApiError> {
  return fetchApi(`/api/services${toQueryString(query)}`, serviceListResponseSchema);
}

export async function getService(serviceId: string): Promise<ServiceDetail | ApiError> {
  return fetchApi(`/api/services/${serviceId}`, serviceDetailSchema);
}
