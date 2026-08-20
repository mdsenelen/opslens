/* eslint-disable @typescript-eslint/no-explicit-any -- pg's untyped row shape is mapped and Zod-serialized at the boundary. */
import {
  apiErrorSchema, paginatedSchema, serviceDetailSchema, serviceIdParamsSchema,
  serviceListItemSchema, serviceListQuerySchema,
} from "@opslens/shared-types";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Database } from "../../infra/db/pool";
import { paginate } from "../../infra/db/pagination";

const serviceRow = (r: Record<string, any>) => ({ id: r.id, name: r.name, slug: r.slug, description: r.description, createdAt: new Date(r.created_at).toISOString() });

export async function registerServiceRoutes(app: FastifyInstance, db: Database) {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  typed.get("/services", { schema: { querystring: serviceListQuerySchema, response: { 200: paginatedSchema(serviceListItemSchema), 400: apiErrorSchema } } }, async (request) => {
    const { page, limit, q, environment, sort, order } = request.query;
    const sortColumns = { name: "s.name", createdAt: "s.created_at" } as const;
    const args: unknown[] = [];
    const where: string[] = [];
    if (q) { args.push(`%${q}%`); where.push(`(s.name ILIKE $${args.length} OR s.slug ILIKE $${args.length})`); }
    if (environment) { args.push(environment); where.push(`EXISTS (SELECT 1 FROM metrics m JOIN metric_points mp ON mp.metric_id=m.id JOIN environments e ON e.id=mp.environment_id WHERE m.service_id=s.id AND e.name=$${args.length})`); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return paginate(db, {
      countSql: `SELECT count(*)::text AS total FROM services s ${clause}`,
      selectSql: `SELECT s.*, count(a.id) FILTER (WHERE a.status='firing')::int AS active_alert_count FROM services s LEFT JOIN alerts a ON a.service_id=s.id ${clause} GROUP BY s.id ORDER BY ${sortColumns[sort]} ${order.toUpperCase()}, s.id ASC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      args, page, limit,
      map: (r: Record<string, any>) => ({ ...serviceRow(r), activeAlertCount: Number(r.active_alert_count) }),
    });
  });
  typed.get("/services/:serviceId", { schema: { params: serviceIdParamsSchema, response: { 200: serviceDetailSchema, 400: apiErrorSchema, 404: apiErrorSchema } } }, async (request, reply) => {
    const result = await db.query<Record<string, any>>("SELECT * FROM services WHERE id=$1", [request.params.serviceId]);
    const service = result.rows[0];
    if (!service) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "service not found" } });
    const [metrics, environments] = await Promise.all([
      db.query<Record<string, any>>("SELECT * FROM metrics WHERE service_id=$1 ORDER BY name ASC, id ASC", [service.id]),
      db.query<{ id: string; name: "production" | "staging" | "development" }>("SELECT DISTINCT e.id,e.name FROM environments e JOIN metric_points mp ON mp.environment_id=e.id JOIN metrics m ON m.id=mp.metric_id WHERE m.service_id=$1 ORDER BY e.name ASC", [service.id]),
    ]);
    return { service: serviceRow(service), metrics: metrics.rows.map((m) => ({ id:m.id, serviceId:m.service_id, name:m.name, unit:m.unit, kind:m.kind, createdAt:new Date(m.created_at).toISOString() })), environments: environments.rows };
  });
}
