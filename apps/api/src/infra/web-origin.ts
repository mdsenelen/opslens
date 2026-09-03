/**
 * The single browser origin allowed to call this API — used by both
 * @fastify/cors (app.ts) and the realtime module's SSE route. The latter
 * can't rely on the cors plugin's onSend hook: it calls reply.hijack() to
 * take over the raw response for a long-lived stream, which skips
 * Fastify's normal reply lifecycle (and every hook registered on it)
 * entirely, so it has to set the header itself from the same source.
 */
export function getWebOrigin(): string {
  return process.env.WEB_ORIGIN ?? "http://localhost:3000";
}
