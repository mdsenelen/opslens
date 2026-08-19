import { z } from "zod";

export const alertStatusSchema = z.enum([
  "firing",
  "acknowledged",
  "resolved",
]);
export type AlertStatus = z.infer<typeof alertStatusSchema>;

export const alertSchema = z.object({
  id: z.uuid(),
  alertRuleId: z.uuid(),
  serviceId: z.uuid(),
  environmentId: z.uuid(),
  status: alertStatusSchema,
  firedAt: z.iso.datetime(),
  acknowledgedAt: z.iso.datetime().nullable(),
  resolvedAt: z.iso.datetime().nullable(),
});
export type Alert = z.infer<typeof alertSchema>;

export const createAlertSchema = alertSchema.omit({ id: true });
export type CreateAlert = z.infer<typeof createAlertSchema>;
