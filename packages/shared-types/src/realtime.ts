import { z } from "zod";

import { alertSchema } from "./alert";
import { metricPointSchema } from "./metric-point";

/**
 * SSE event envelopes pushed over GET /api/realtime/stream. alert-status is
 * produced today by alert-evaluation-job.ts on every fire/resolve write.
 * metric-point is specified for contract completeness (the domain clearly
 * needs it once points are ingested live) but has no producer yet — there
 * is no points-ingestion endpoint in this API; seed.ts is the only writer
 * of metric_points. Don't wire a client to expect this event until a real
 * producer exists.
 */
export const realtimeAlertStatusEventSchema = z.object({
  type: z.literal("alert-status"),
  alert: alertSchema,
});
export type RealtimeAlertStatusEvent = z.infer<typeof realtimeAlertStatusEventSchema>;

export const realtimeMetricPointEventSchema = z.object({
  type: z.literal("metric-point"),
  point: metricPointSchema,
});
export type RealtimeMetricPointEvent = z.infer<typeof realtimeMetricPointEventSchema>;

export const realtimeEventSchema = z.discriminatedUnion("type", [
  realtimeAlertStatusEventSchema,
  realtimeMetricPointEventSchema,
]);
export type RealtimeEvent = z.infer<typeof realtimeEventSchema>;
