import { environmentNameSchema, type EnvironmentName } from "@opslens/shared-types";
import type { Metadata } from "next";
import { MetricChart } from "@/features/metric-chart/metric-chart";
import { getMetricPoints, METRIC_POINT_LIMIT } from "@/lib/metrics-client";
import { defaultTimeRange, parseTimeRangePreset, presetHours } from "@/lib/time-range";

// A static title, not the fetched metric's name — see
// app/alerts/[alertId]/page.tsx's metadata comment on why.
export const metadata: Metadata = { title: "Metric chart" };

export default async function MetricPage({
  params,
  searchParams,
}: {
  params: Promise<{ serviceId: string; metricId: string }>;
  searchParams: Promise<{ environment?: string; start?: string; end?: string; range?: string }>;
}) {
  const { serviceId, metricId } = await params;
  const search = await searchParams;

  const parsedEnvironment = environmentNameSchema.safeParse(search.environment);
  const environment: EnvironmentName = parsedEnvironment.success ? parsedEnvironment.data : "production";

  // An explicit start and end is a fixed window (an alert's investigation
  // link). Anything else is a live relative range, 24 hours by default.
  const range = search.start && search.end ? undefined : (parseTimeRangePreset(search.range) ?? "24h");
  const { start, end } = range ? defaultTimeRange(presetHours(range)) : { start: search.start!, end: search.end! };

  // order: "desc" so the initial server-rendered fetch matches the client
  // fetcher in metric-chart.tsx — see that file's comment on why ascending
  // (the API's default) would truncate away the most recent points.
  const initialData = await getMetricPoints(metricId, { environment, start, end, order: "desc", limit: METRIC_POINT_LIMIT });

  return <MetricChart serviceId={serviceId} metricId={metricId} environment={environment} range={range} start={start} end={end} initialData={initialData} />;
}
