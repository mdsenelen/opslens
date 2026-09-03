import http from "node:http";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { EventBroadcaster } from "./event-broadcaster";
import { registerRealtimeRoutes } from "./realtime.routes";

/**
 * Regression test for a real bug found via the E2E reconnection flow
 * (docs/spec/09-testing.md's "Priority 4"): this route calls
 * reply.hijack() to write directly to the raw socket for its long-lived
 * stream, which skips @fastify/cors's onSend hook entirely — so every
 * EventSource connection from a browser on a different origin (the
 * documented local setup: web on :3000, api on :4000) failed silently
 * with a CORS error, forever stuck reconnecting. `app.inject()` can't
 * exercise this: light-my-request's fake socket never surfaces a real
 * CORS failure the way a browser does, and a hijacked, never-ending
 * stream doesn't resolve inject's promise anyway — hence a real listening
 * server and a raw HTTP client here, closed as soon as headers arrive.
 */
async function buildRealtimeOnlyApp() {
  const app = Fastify();
  await registerRealtimeRoutes(app, new EventBroadcaster());
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("expected a bound TCP address");
  return { app, port: address.port };
}

function getHeaders(port: number): Promise<http.IncomingHttpHeaders> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/realtime/stream" }, (res) => {
      resolve(res.headers);
      res.destroy();
    });
    req.on("error", reject);
  });
}

describe("GET /realtime/stream CORS header", () => {
  const originalWebOrigin = process.env.WEB_ORIGIN;
  afterEach(() => {
    if (originalWebOrigin === undefined) delete process.env.WEB_ORIGIN;
    else process.env.WEB_ORIGIN = originalWebOrigin;
  });

  it("sets Access-Control-Allow-Origin to the default web origin", async () => {
    delete process.env.WEB_ORIGIN;
    const { app, port } = await buildRealtimeOnlyApp();
    try {
      const headers = await getHeaders(port);
      expect(headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    } finally {
      await app.close();
    }
  });

  it("honors WEB_ORIGIN when set, matching @fastify/cors's own source of truth", async () => {
    process.env.WEB_ORIGIN = "https://ops.example.com";
    const { app, port } = await buildRealtimeOnlyApp();
    try {
      const headers = await getHeaders(port);
      expect(headers["access-control-allow-origin"]).toBe("https://ops.example.com");
    } finally {
      await app.close();
    }
  });
});
