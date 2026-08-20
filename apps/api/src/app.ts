import cors from "@fastify/cors";
import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";

import { registerPingRoutes } from "./modules/ping/ping.routes";
import { createDatabase, type Database } from "./infra/db/pool";
import { registerServiceRoutes } from "./modules/services/services.routes";
import { registerMetricRoutes } from "./modules/metrics/metrics.routes";
import { registerAlertRoutes } from "./modules/alerts/alerts.routes";
import { registerDeploymentRoutes } from "./modules/deployments/deployments.routes";
import { registerRealtimeRoutes } from "./modules/realtime/realtime.routes";
import { eventBroadcaster } from "./modules/realtime/event-broadcaster";

export function buildApp(options: { db?: Database } = {}) {
  const app = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>();
  const db = options.db ?? createDatabase();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.register(cors, {
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  });

  // Each module owns its own routes/service/repository (see repo blueprint,
  // apps/api/src/modules/*). Phase 0 wires only the ping stub; Phase 2 adds
  // services/metrics/alerts/deployments here in the same shape.
  app.register(registerPingRoutes, { prefix: "/api" });
  app.register(async (instance) => registerServiceRoutes(instance, db), { prefix: "/api" });
  app.register(async (instance) => registerMetricRoutes(instance, db), { prefix: "/api" });
  app.register(async (instance) => registerAlertRoutes(instance, db), { prefix: "/api" });
  app.register(async (instance) => registerDeploymentRoutes(instance, db), { prefix: "/api" });
  app.register(async (instance) => registerRealtimeRoutes(instance, eventBroadcaster), { prefix: "/api" });

  app.setErrorHandler((error, _request, reply) => {
    if (typeof error === "object" && error !== null && "validation" in error && Array.isArray(error.validation)) {
      const validation = error.validation as Array<{ instancePath?: string; params?: unknown; message?: string }>;
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "request validation failed", details: validation.map((issue) => ({ path: issue.instancePath ?? String(issue.params ?? ""), message: issue.message ?? "invalid value" })) } });
    }
    app.log.error(error);
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "internal server error" } });
  });

  return app;
}
