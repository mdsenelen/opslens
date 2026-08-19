import { z } from "zod";

export const metricPointSchema = z.object({
  id: z.uuid(),
  metricId: z.uuid(),
  environmentId: z.uuid(),
  ts: z.iso.datetime(),
  value: z.number(),
});
export type MetricPoint = z.infer<typeof metricPointSchema>;

export const createMetricPointSchema = metricPointSchema.omit({ id: true });
export type CreateMetricPoint = z.infer<typeof createMetricPointSchema>;
