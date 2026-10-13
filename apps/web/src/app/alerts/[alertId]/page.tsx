import type { Metadata } from "next";
import { AlertDetail } from "@/features/alert-detail/alert-detail";
import { getAlert } from "@/lib/alerts-client";

// A static title, not the fetched alert's metric name — the metadata and
// the page component would otherwise each fetch it independently (the
// fetchApi helper doesn't dedupe with Next's fetch cache; see
// apps/web/src/lib/api-client.ts's cache: "no-store"). See
// app/page.tsx's metadata comment.
export const metadata: Metadata = { title: "Alert detail" };

export default async function AlertDetailPage({ params }: { params: Promise<{ alertId: string }> }) {
  const { alertId } = await params;
  const initialData = await getAlert(alertId);
  return <AlertDetail alertId={alertId} initialData={initialData} />;
}
