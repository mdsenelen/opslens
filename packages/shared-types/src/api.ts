import { z } from "zod";

import { alertSchema, alertStatusSchema } from "./alert";
import { alertSeveritySchema } from "./alert-rule";
import { deploymentSchema, deploymentStatusSchema } from "./deployment";
import { environmentNameSchema } from "./environment";
import { metricSchema } from "./metric";
import { metricPointSchema } from "./metric-point";
import { serviceSchema } from "./service";

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const paginatedSchema = <T extends z.ZodType>(item: T) => z.object({
  items: z.array(item), page: z.number().int(), limit: z.number().int(), total: z.number().int(),
});

const isoQuery = z.string().datetime({ offset: true });
export const timeRangeQuerySchema = z.object({
  start: isoQuery,
  end: isoQuery,
}).superRefine(({ start, end }, ctx) => {
  if (new Date(start) >= new Date(end)) ctx.addIssue({ code: "custom", path: ["end"], message: "end must be after start" });
  if (new Date(end).getTime() - new Date(start).getTime() > 7 * 24 * 60 * 60 * 1000) ctx.addIssue({ code: "custom", path: ["end"], message: "time range must not exceed 7 days" });
});

export const serviceListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(100).optional(),
  environment: environmentNameSchema.optional(),
  sort: z.enum(["name", "createdAt"]).default("name"),
  order: z.enum(["asc", "desc"]).default("asc"),
});
export const serviceListItemSchema = serviceSchema.extend({ activeAlertCount: z.number().int().nonnegative() });
export const serviceDetailSchema = z.object({ service: serviceSchema, metrics: z.array(metricSchema), environments: z.array(z.object({ id: z.uuid(), name: environmentNameSchema })) });

export const metricListQuerySchema = paginationQuerySchema.extend({ serviceId: z.uuid().optional(), name: z.string().trim().min(1).max(200).optional(), sort: z.enum(["name", "createdAt"]).default("name"), order: z.enum(["asc", "desc"]).default("asc") });
export const metricPointsQuerySchema = timeRangeQuerySchema.extend({ environment: environmentNameSchema, limit: z.coerce.number().int().min(1).max(1000).default(500), order: z.enum(["asc", "desc"]).default("asc") });

export const alertListQuerySchema = paginationQuerySchema.extend({ serviceId: z.uuid().optional(), environment: environmentNameSchema.optional(), status: alertStatusSchema.optional(), severity: alertSeveritySchema.optional(), sort: z.enum(["firedAt", "status"]).default("firedAt"), order: z.enum(["asc", "desc"]).default("desc") });
export const alertListItemSchema = alertSchema.extend({ severity: alertSeveritySchema, metricName: z.string(), serviceName: z.string(), environmentName: environmentNameSchema });
export const alertDetailSchema = alertListItemSchema.extend({ rule: z.object({ comparator: z.enum(["gt", "gte", "lt", "lte"]), threshold: z.number(), durationSeconds: z.number().int().positive() }) });

export const deploymentListQuerySchema = paginationQuerySchema.extend({ start: isoQuery.optional(), end: isoQuery.optional(), serviceId: z.uuid().optional(), environment: environmentNameSchema.optional(), status: deploymentStatusSchema.optional(), sort: z.literal("deployedAt").default("deployedAt"), order: z.enum(["asc", "desc"]).default("desc") }).superRefine((value, ctx) => {
  if ((value.start && !value.end) || (!value.start && value.end)) ctx.addIssue({ code: "custom", path: ["start"], message: "start and end must be provided together" });
  if (value.start && value.end) {
    if (new Date(value.start) >= new Date(value.end)) ctx.addIssue({ code: "custom", path: ["end"], message: "end must be after start" });
    if (new Date(value.end).getTime() - new Date(value.start).getTime() > 7 * 24 * 60 * 60 * 1000) ctx.addIssue({ code: "custom", path: ["end"], message: "time range must not exceed 7 days" });
  }
});
export const deploymentListItemSchema = deploymentSchema.extend({ serviceName: z.string(), environmentName: environmentNameSchema });

export const serviceIdParamsSchema = z.object({ serviceId: z.uuid() });
export const metricIdParamsSchema = z.object({ metricId: z.uuid() });
export const alertIdParamsSchema = z.object({ alertId: z.uuid() });
export const deploymentIdParamsSchema = z.object({ deploymentId: z.uuid() });

export const metricPointsResponseSchema = z.object({ metric: metricSchema, environment: z.object({ id: z.uuid(), name: environmentNameSchema }), points: z.array(metricPointSchema), limit: z.number().int() });
