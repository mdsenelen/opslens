import { describe, expect, it } from "vitest";
import {
  alertListQuerySchema,
  deploymentListQuerySchema,
  metricPointsQuerySchema,
  serviceListQuerySchema,
} from "@opslens/shared-types";

describe("Phase 2 query contracts", () => {
  it("rejects unsafe sort/filter values and overlarge pages", () => {
    expect(serviceListQuerySchema.safeParse({ sort: "name; drop table services" }).success).toBe(false);
    expect(alertListQuerySchema.safeParse({ status: "firing' OR true --" }).success).toBe(false);
    expect(deploymentListQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it("requires bounded, ordered metric time ranges", () => {
    expect(metricPointsQuerySchema.safeParse({ environment: "production", start: "2026-08-01T00:00:00.000Z", end: "2026-08-09T00:00:00.000Z" }).success).toBe(false);
    expect(metricPointsQuerySchema.safeParse({ environment: "production", start: "2026-08-20T01:00:00.000Z", end: "2026-08-20T00:00:00.000Z" }).success).toBe(false);
    expect(metricPointsQuerySchema.parse({ environment: "production", start: "2026-08-20T00:00:00.000Z", end: "2026-08-20T01:00:00.000Z", limit: 999 }).limit).toBe(999);
  });
});
