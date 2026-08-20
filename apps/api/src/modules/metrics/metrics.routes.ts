/* eslint-disable @typescript-eslint/no-explicit-any -- pg's untyped row shape is mapped and Zod-serialized at the boundary. */
import { apiErrorSchema, metricIdParamsSchema, metricListQuerySchema, metricPointsQuerySchema, metricPointsResponseSchema, metricSchema, paginatedSchema } from "@opslens/shared-types";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Database } from "../../infra/db/pool";
import { paginate } from "../../infra/db/pagination";

const metric = (r: Record<string, any>) => ({ id:r.id, serviceId:r.service_id, name:r.name, unit:r.unit, kind:r.kind, createdAt:new Date(r.created_at).toISOString() });
export async function registerMetricRoutes(app: FastifyInstance, db: Database) {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  typed.get("/metrics", { schema:{ querystring:metricListQuerySchema, response:{200:paginatedSchema(metricSchema),400:apiErrorSchema} } }, async (request) => {
    const {page,limit,serviceId,name,sort,order}=request.query; const args: unknown[]=[]; const where:string[]=[];
    if(serviceId){args.push(serviceId);where.push(`service_id=$${args.length}`)} if(name){args.push(`%${name}%`);where.push(`name ILIKE $${args.length}`)}
    const clause=where.length?`WHERE ${where.join(" AND ")}`:"";
    const column=sort === "name" ? "name" : "created_at";
    return paginate(db, {
      countSql: `SELECT count(*)::text total FROM metrics ${clause}`,
      selectSql: `SELECT * FROM metrics ${clause} ORDER BY ${column} ${order.toUpperCase()}, id ASC LIMIT $${args.length+1} OFFSET $${args.length+2}`,
      args, page, limit, map: metric,
    });
  });
  typed.get("/metrics/:metricId/points", { schema:{params:metricIdParamsSchema,querystring:metricPointsQuerySchema,response:{200:metricPointsResponseSchema,400:apiErrorSchema,404:apiErrorSchema}} }, async(request,reply)=>{
    const {environment,start,end,limit,order}=request.query;
    // Metric and environment existence are checked independently — a valid
    // metric with zero points in this environment is a real, empty answer
    // (200 + []), not a 404. A prior version joined through metric_points
    // for this check, which meant "no points yet" and "metric doesn't
    // exist" were indistinguishable.
    const [metricResult, environmentResult] = await Promise.all([
      db.query<Record<string,any>>("SELECT * FROM metrics WHERE id=$1",[request.params.metricId]),
      db.query<{id:string;name:string}>("SELECT id,name FROM environments WHERE name=$1",[environment]),
    ]);
    const metricRow=metricResult.rows[0]; if(!metricRow)return reply.code(404).send({error:{code:"NOT_FOUND",message:"metric not found"}});
    const environmentRow=environmentResult.rows[0]; if(!environmentRow)return reply.code(404).send({error:{code:"NOT_FOUND",message:"environment not found"}});
    const points=await db.query<Record<string,any>>(`SELECT id,metric_id,environment_id,ts,value FROM metric_points WHERE metric_id=$1 AND environment_id=$2 AND ts >= $3 AND ts <= $4 ORDER BY ts ${order.toUpperCase()}, id ASC LIMIT $5`,[request.params.metricId,environmentRow.id,start,end,limit]);
    return {metric:metric(metricRow),environment:{id:environmentRow.id,name:environmentRow.name as never},points:points.rows.map(p=>({id:p.id,metricId:p.metric_id,environmentId:p.environment_id,ts:new Date(p.ts as string).toISOString(),value:p.value})),limit};
  });
}
