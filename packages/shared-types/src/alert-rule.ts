import { z } from "zod";

export const alertComparatorSchema = z.enum(["gt", "gte", "lt", "lte"]);
export type AlertComparator = z.infer<typeof alertComparatorSchema>;

export const alertSeveritySchema = z.enum(["info", "warning", "critical"]);
export type AlertSeverity = z.infer<typeof alertSeveritySchema>;

export const alertRuleSchema = z.object({
  id: z.uuid(),
  metricId: z.uuid(),
  comparator: alertComparatorSchema,
  threshold: z.number(),
  durationSeconds: z.number().int().positive(),
  severity: alertSeveritySchema,
  enabled: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type AlertRule = z.infer<typeof alertRuleSchema>;

export const createAlertRuleSchema = alertRuleSchema.omit({
  id: true,
  createdAt: true,
});
export type CreateAlertRule = z.infer<typeof createAlertRuleSchema>;
