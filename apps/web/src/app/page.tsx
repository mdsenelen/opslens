import type { EnvironmentName } from "@opslens/shared-types";
import { FleetOverview } from "@/features/fleet-overview/fleet-overview";
import { getServices } from "@/lib/services-client";

export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string; environment?: string }> }) {
  const params = await searchParams;
  const initialData = await getServices({ q: params.q, environment: params.environment as EnvironmentName | undefined });
  return <FleetOverview initialData={initialData} />;
}
