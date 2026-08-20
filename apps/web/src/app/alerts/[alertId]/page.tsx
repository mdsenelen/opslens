import { AlertDetail } from "@/features/alert-detail/alert-detail";
import { getAlert } from "@/lib/alerts-client";

export default async function AlertDetailPage({ params }: { params: Promise<{ alertId: string }> }) {
  const { alertId } = await params;
  const initialData = await getAlert(alertId);
  return <AlertDetail alertId={alertId} initialData={initialData} />;
}
