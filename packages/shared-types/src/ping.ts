import { z } from "zod";

/**
 * Phase 0 stub contract: proves the shared-types package is consumed
 * identically by the Fastify API and the Next.js web app. Domain schemas
 * (Service, Metric, MetricPoint, AlertRule, Alert, Deployment) land in
 * Phase 1 as apps/api/src/infra/db/migrations are written against them.
 */
export const pingResponseSchema = z.object({
  message: z.string(),
  service: z.literal("opslens-api"),
  timestamp: z.iso.datetime(),
});

export type PingResponse = z.infer<typeof pingResponseSchema>;
