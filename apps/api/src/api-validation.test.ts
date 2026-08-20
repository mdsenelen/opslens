import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "./app";

// These are HTTP validation tests, not database integration tests: each input
// is rejected before a repository query can run.
const app = buildApp({
  db: {
    query: async () => {
      throw new Error("database must not be queried for invalid input");
    },
  } as never,
});

afterAll(async () => app.close());

describe("API request validation", () => {
  it("returns the standard envelope for an unsafe service sort", async () => {
    const response = await app.inject("/api/services?sort=name%3BDROP%20TABLE%20services");
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR", message: "request validation failed" },
    });
  });

  it("rejects unbounded metric requests before database access", async () => {
    const response = await app.inject("/api/metrics/00000000-0000-4000-8000-000000000001/points?environment=production&start=2026-08-01T00%3A00%3A00.000Z&end=2026-08-09T00%3A00%3A00.000Z");
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });
});
