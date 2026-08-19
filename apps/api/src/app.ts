import cors from "@fastify/cors";
import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";

import { registerPingRoutes } from "./modules/ping/ping.routes";

export function buildApp() {
  const app = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.register(cors, {
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  });

  // Each module owns its own routes/service/repository (see repo blueprint,
  // apps/api/src/modules/*). Phase 0 wires only the ping stub; Phase 2 adds
  // services/metrics/alerts/deployments here in the same shape.
  app.register(registerPingRoutes, { prefix: "/api" });

  return app;
}
