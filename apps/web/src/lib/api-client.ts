import { pingResponseSchema, type PingResponse } from "@opslens/shared-types";
import type { z } from "zod";

const API_BASE_URL = process.env.OPSLENS_API_URL ?? "http://localhost:4000";

export type ApiError =
  | { kind: "network"; message: string }
  | { kind: "validation"; message: string }
  | { kind: "not-found"; message: string }
  | { kind: "server"; message: string; status: number };

export function isApiError(result: unknown): result is ApiError {
  return typeof result === "object" && result !== null && "kind" in result;
}

/**
 * The API-client boundary: every module-specific fetcher (services-client,
 * metrics-client, alerts-client, deployments-client) calls through this
 * instead of `fetch` directly, so every failure mode — network failure,
 * 404, other non-2xx, or a response that fails the same Zod schema the API
 * itself validates its output against — is normalized into the ApiError
 * union in exactly one place.
 */
export async function fetchApi<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T | ApiError> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { cache: "no-store", ...init });
  } catch (err) {
    return { kind: "network", message: (err as Error).message };
  }

  if (response.status === 404) {
    return { kind: "not-found", message: `${path} not found` };
  }
  if (!response.ok) {
    return {
      kind: "server",
      status: response.status,
      message: `api responded with ${response.status}`,
    };
  }

  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    return { kind: "validation", message: parsed.error.message };
  }
  return parsed.data;
}

/** Builds a `?a=1&b=2` query string, dropping undefined values. */
export function toQueryString(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export async function getPing(): Promise<PingResponse | ApiError> {
  return fetchApi("/api/ping", pingResponseSchema);
}

/** User-facing copy for each ApiError kind, per docs/spec/02-user-journeys.md's state table. */
export function describeApiError(error: ApiError): string {
  switch (error.kind) {
    case "network":
      return `Can't reach the API — ${error.message}.`;
    case "not-found":
      return "Not found.";
    case "validation":
      return "Something went wrong loading this.";
    case "server":
      return `The API returned an error (status ${error.status}).`;
  }
}
