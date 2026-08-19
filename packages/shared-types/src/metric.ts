import { z } from "zod";

export const metricKindSchema = z.enum(["gauge", "counter", "histogram"]);
export type MetricKind = z.infer<typeof metricKindSchema>;

export const metricSchema = z.object({
  id: z.uuid(),
  serviceId: z.uuid(),
  name: z.string().min(1).max(200),
  unit: z.string().min(1).max(50),
  kind: metricKindSchema,
  createdAt: z.iso.datetime(),
});
export type Metric = z.infer<typeof metricSchema>;

export const createMetricSchema = metricSchema.omit({
  id: true,
  createdAt: true,
});
export type CreateMetric = z.infer<typeof createMetricSchema>;
