import { ServiceDetail } from "@/features/service-detail/service-detail";
import { getService } from "@/lib/services-client";

export default async function ServicePage({ params }: { params: Promise<{ serviceId: string }> }) {
  const { serviceId } = await params;
  const initialData = await getService(serviceId);
  return <ServiceDetail serviceId={serviceId} initialData={initialData} />;
}
