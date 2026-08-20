import type { DeploymentStatus, EnvironmentName } from "@opslens/shared-types";
import { DeploymentsList } from "@/features/deployments-list/deployments-list";
import { getDeployments } from "@/lib/deployments-client";

export default async function DeploymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ serviceId?: string; environment?: string; status?: string }>;
}) {
  const params = await searchParams;
  const initialData = await getDeployments({
    serviceId: params.serviceId,
    environment: params.environment as EnvironmentName | undefined,
    status: params.status as DeploymentStatus | undefined,
  });
  return <DeploymentsList initialData={initialData} />;
}
