import { environmentNameSchema, type EnvironmentName } from "@opslens/shared-types";
import type { Metadata } from "next";
import { MetricChart } from "@/features/metric-chart/metric-chart";
import { getMetricPoints } from "@/lib/metrics-client";
import { defaultTimeRange } from "@/lib/time-range";

// A static title, not the fetched metric's name — see
// app/alerts/[alertId]/page.tsx's metadata comment on why.
export const metadata: Metadata = { title: "Metric chart" };

const DEFAULT_WINDOW_HOURS = 24;

export default async function MetricPage({
  params,
  searchParams,
}: {
  params: Promise<{ serviceId: string; metricId: string }>;
  searchParams: Promise<{ environment?: string; start?: string; end?: string }>;
}) {
  const { serviceId, metricId } = await params;
  const search = await searchParams;

  const parsedEnvironment = environmentNameSchema.safeParse(search.environment);
  const environment: EnvironmentName = parsedEnvironment.success ? parsedEnvironment.data : "production";

  const fallback = defaultTimeRange(DEFAULT_WINDOW_HOURS);
  const start = search.start ?? fallback.start;
  const end = search.end ?? fallback.end;

  // order: "desc" so the initial server-rendered fetch matches the client
  // fetcher in metric-chart.tsx — see that file's comment on why ascending
  // (the API's default) would truncate away the most recent points.
  const initialData = await getMetricPoints(metricId, { environment, start, end, order: "desc" });

  return <MetricChart serviceId={serviceId} metricId={metricId} environment={environment} start={start} end={end} initialData={initialData} />;
}
