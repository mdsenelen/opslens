import {
  deploymentListItemSchema,
  deploymentListQuerySchema,
  deploymentSchema,
  paginatedSchema,
} from "@opslens/shared-types";
import type { z } from "zod";
import { fetchApi, toQueryString, type ApiError } from "./api-client";

export type DeploymentListItem = z.infer<typeof deploymentListItemSchema>;
export type Deployment = z.infer<typeof deploymentSchema>;

// Derived from the API's own query schema (output side, so defaults are
// optional here and numbers stay numbers), not hand-copied: a new filter or
// sort key there reaches this type without a second edit.
export type DeploymentListQuery = Partial<z.output<typeof deploymentListQuerySchema>>;

const deploymentListResponseSchema = paginatedSchema(deploymentListItemSchema);
export type DeploymentListResponse = z.infer<typeof deploymentListResponseSchema>;

export async function getDeployments(query: DeploymentListQuery = {}): Promise<DeploymentListResponse | ApiError> {
  return fetchApi(`/api/deployments${toQueryString(query)}`, deploymentListResponseSchema);
}

export async function getDeployment(deploymentId: string): Promise<Deployment | ApiError> {
  return fetchApi(`/api/deployments/${deploymentId}`, deploymentSchema);
}
