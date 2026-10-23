import {
  alertListQuerySchema,
  deploymentListQuerySchema,
  metricListQuerySchema,
  metricPointsQuerySchema,
  serviceListQuerySchema,
} from "@opslens/shared-types";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import type { AlertListQuery } from "./alerts-client";
import { toQueryString } from "./api-client";
import type { DeploymentListQuery } from "./deployments-client";
import type { MetricListQuery, MetricPointsQuery } from "./metrics-client";
import type { ServiceListQuery } from "./services-client";

const serviceId = "6f1c2c1e-6c1b-4c7e-9a52-3e4b8f2d9a10";

// What the API actually receives: the client's query object as a query
// string, decoded back into plain string values.
function overTheWire(query: Record<string, string | number | boolean | undefined>): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(toQueryString(query)));
}

describe("web query types and the API's query schemas", () => {
  // Type-level: checked by `pnpm typecheck` (CI's checks job), not at
  // runtime. Fails if a client goes back to a hand-written query type that
  // no longer matches its schema.
  it("derives every client query type from the shared schema", () => {
    expectTypeOf<ServiceListQuery>().toEqualTypeOf<Partial<z.output<typeof serviceListQuerySchema>>>();
    expectTypeOf<MetricListQuery>().toEqualTypeOf<Partial<z.output<typeof metricListQuerySchema>>>();
    expectTypeOf<AlertListQuery>().toEqualTypeOf<Partial<z.output<typeof alertListQuerySchema>>>();
    expectTypeOf<DeploymentListQuery>().toEqualTypeOf<Partial<z.output<typeof deploymentListQuerySchema>>>();
    expectTypeOf<MetricPointsQuery["environment"]>().toEqualTypeOf<z.output<typeof metricPointsQuerySchema>["environment"]>();
  });

  it("encodes queries the API's own schemas accept", () => {
    const services: ServiceListQuery = { q: "pay", environment: "production", page: 2, limit: 50, sort: "createdAt", order: "desc" };
    const metrics: MetricListQuery = { serviceId, name: "error_rate_pct", sort: "name", order: "asc" };
    const points: MetricPointsQuery = { environment: "production", start: "2026-10-20T00:00:00.000Z", end: "2026-10-21T00:00:00.000Z", limit: 1000 };
    const alerts: AlertListQuery = { serviceId, environment: "staging", status: "firing", severity: "critical", sort: "status" };
    const deployments: DeploymentListQuery = { serviceId, status: "success", start: points.start, end: points.end };

    expect(serviceListQuerySchema.safeParse(overTheWire(services)).success).toBe(true);
    expect(metricListQuerySchema.safeParse(overTheWire(metrics)).success).toBe(true);
    expect(metricPointsQuerySchema.safeParse(overTheWire(points)).success).toBe(true);
    expect(alertListQuerySchema.safeParse(overTheWire(alerts)).success).toBe(true);
    expect(deploymentListQuerySchema.safeParse(overTheWire(deployments)).success).toBe(true);
  });
});
