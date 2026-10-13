import type { Metadata } from "next";
import { ServiceDetail } from "@/features/service-detail/service-detail";
import { getService } from "@/lib/services-client";

// A static title, not the fetched service's name — see
// app/alerts/[alertId]/page.tsx's metadata comment on why.
export const metadata: Metadata = { title: "Service detail" };

export default async function ServicePage({ params }: { params: Promise<{ serviceId: string }> }) {
  const { serviceId } = await params;
  const initialData = await getService(serviceId);
  return <ServiceDetail serviceId={serviceId} initialData={initialData} />;
}
