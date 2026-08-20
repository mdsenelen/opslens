import {
  deploymentListItemSchema,
  deploymentSchema,
  paginatedSchema,
  type DeploymentStatus,
  type EnvironmentName,
} from "@opslens/shared-types";
import type { z } from "zod";
import { fetchApi, toQueryString, type ApiError } from "./api-client";

export type DeploymentListItem = z.infer<typeof deploymentListItemSchema>;
export type Deployment = z.infer<typeof deploymentSchema>;

export type DeploymentListQuery = {
  serviceId?: string;
  environment?: EnvironmentName;
  status?: DeploymentStatus;
  start?: string;
  end?: string;
  page?: number;
  limit?: number;
  order?: "asc" | "desc";
};

const deploymentListResponseSchema = paginatedSchema(deploymentListItemSchema);
export type DeploymentListResponse = z.infer<typeof deploymentListResponseSchema>;

export async function getDeployments(query: DeploymentListQuery = {}): Promise<DeploymentListResponse | ApiError> {
  return fetchApi(`/api/deployments${toQueryString(query)}`, deploymentListResponseSchema);
}

export async function getDeployment(deploymentId: string): Promise<Deployment | ApiError> {
  return fetchApi(`/api/deployments/${deploymentId}`, deploymentSchema);
}
