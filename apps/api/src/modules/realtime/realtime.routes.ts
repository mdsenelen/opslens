import type { RealtimeEvent } from "@opslens/shared-types";
import type { FastifyInstance } from "fastify";
import { getWebOrigin } from "../../infra/web-origin";
import type { EventBroadcaster } from "./event-broadcaster";

/**
 * One SSE endpoint. `serviceId`, when given, scopes this connection to
 * alert-status events for that service only — a dashboard viewing one
 * service's alerts doesn't need every other service's transitions. Omit it
 * to receive every alert-status event (the unfiltered alerts-list screen).
 */
export async function registerRealtimeRoutes(app: FastifyInstance, broadcaster: EventBroadcaster) {
  app.get("/realtime/stream", (request, reply) => {
    const { serviceId } = request.query as { serviceId?: string };

    // Long-lived response written directly to the socket — tell Fastify
    // not to attempt its own reply lifecycle on top of this. That also
    // means @fastify/cors's onSend hook never runs for this route (it
    // skips the whole hook chain), so the CORS header has to be set here
    // explicitly — without it, EventSource in a browser silently fails
    // every connection to an API on a different origin (i.e. exactly the
    // documented local dev setup: web on :3000, api on :4000).
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": getWebOrigin(),
    });
    // Flushes headers immediately so EventSource's connection opens without
    // waiting on the first real event, which may be minutes away.
    reply.raw.write(":ready\n\n");

    const inScope = (event: RealtimeEvent) =>
      !serviceId || event.type !== "alert-status" || event.alert.serviceId === serviceId;

    const unsubscribe = broadcaster.subscribe((event) => {
      if (!inScope(event)) return;
      reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });

    request.raw.on("close", () => {
      unsubscribe();
      reply.raw.end();
    });
  });
}
