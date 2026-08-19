import { pingResponseSchema } from "@opslens/shared-types";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

export async function registerPingRoutes(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    "/ping",
    {
      schema: {
        response: { 200: pingResponseSchema },
      },
    },
    async () => ({
      message: "opslens api is up",
      service: "opslens-api" as const,
      timestamp: new Date().toISOString(),
    }),
  );
}
