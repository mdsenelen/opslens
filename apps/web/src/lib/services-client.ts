import {
  paginatedSchema,
  serviceDetailSchema,
  serviceListItemSchema,
  serviceListQuerySchema,
} from "@opslens/shared-types";
import type { z } from "zod";
import { fetchApi, toQueryString, type ApiError } from "./api-client";

export type ServiceListItem = z.infer<typeof serviceListItemSchema>;
export type ServiceDetail = z.infer<typeof serviceDetailSchema>;

// Derived from the API's own query schema (output side, so defaults are
// optional here and numbers stay numbers), not hand-copied: a new filter or
// sort key there reaches this type without a second edit.
export type ServiceListQuery = Partial<z.output<typeof serviceListQuerySchema>>;

const serviceListResponseSchema = paginatedSchema(serviceListItemSchema);
export type ServiceListResponse = z.infer<typeof serviceListResponseSchema>;

export async function getServices(query: ServiceListQuery = {}): Promise<ServiceListResponse | ApiError> {
  return fetchApi(`/api/services${toQueryString(query)}`, serviceListResponseSchema);
}

export async function getService(serviceId: string): Promise<ServiceDetail | ApiError> {
  return fetchApi(`/api/services/${serviceId}`, serviceDetailSchema);
}
