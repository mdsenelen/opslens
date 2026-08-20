import type { AlertSeverity, AlertStatus, EnvironmentName } from "@opslens/shared-types";
import { AlertsList } from "@/features/alerts-list/alerts-list";
import { getAlerts } from "@/lib/alerts-client";

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ serviceId?: string; environment?: string; status?: string; severity?: string }>;
}) {
  const params = await searchParams;
  const initialData = await getAlerts({
    serviceId: params.serviceId,
    environment: params.environment as EnvironmentName | undefined,
    status: params.status as AlertStatus | undefined,
    severity: params.severity as AlertSeverity | undefined,
  });
  return <AlertsList initialData={initialData} />;
}
