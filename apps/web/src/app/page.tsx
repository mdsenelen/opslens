import type { EnvironmentName } from "@opslens/shared-types";
import type { Metadata } from "next";
import { FleetOverview } from "@/features/fleet-overview/fleet-overview";
import { getServices } from "@/lib/services-client";

// A per-route title (docs/spec/11-accessibility.md's focus-management-on-
// navigation requirement) so Next's built-in route announcer has a real
// page name to announce instead of every route sharing the root "OpsLens"
// title.
export const metadata: Metadata = { title: "Fleet overview" };

export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string; environment?: string }> }) {
  const params = await searchParams;
  const initialData = await getServices({ q: params.q, environment: params.environment as EnvironmentName | undefined });
  return <FleetOverview initialData={initialData} />;
}
