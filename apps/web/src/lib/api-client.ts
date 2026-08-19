import { pingResponseSchema, type PingResponse } from "@opslens/shared-types";

const API_BASE_URL = process.env.OPSLENS_API_URL ?? "http://localhost:4000";

export type ApiError =
  | { kind: "network"; message: string }
  | { kind: "validation"; message: string }
  | { kind: "not-found"; message: string }
  | { kind: "server"; message: string; status: number };

/**
 * Phase 0 stub of the API-client boundary described in the repo blueprint:
 * every feature calls through here, never `fetch` directly, so error
 * shapes are normalized in exactly one place. Phase 2 grows this into
 * typed fetchers per module (services, metrics, alerts, deployments).
 */
export async function getPing(): Promise<PingResponse | ApiError> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/ping`, { cache: "no-store" });
  } catch (err) {
    return { kind: "network", message: (err as Error).message };
  }

  if (response.status === 404) {
    return { kind: "not-found", message: "ping endpoint not found" };
  }
  if (!response.ok) {
    return {
      kind: "server",
      status: response.status,
      message: `api responded with ${response.status}`,
    };
  }

  const parsed = pingResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    return { kind: "validation", message: parsed.error.message };
  }
  return parsed.data;
}
