import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { createTestDatabase, truncateAll } from "../../infra/db/test-db";

// Requires a real Postgres: `pnpm db:up && pnpm --filter @opslens/api
// migrate:up`, then `pnpm --filter @opslens/api test:integration`. This is
// the layer api-validation.test.ts's fake-db tests deliberately don't
// reach — the 404-vs-empty bug the audit found was a real SQL/data-shape
// bug (metrics.routes.ts joined the existence check through metric_points,
// so "no points yet" and "metric doesn't exist" were indistinguishable),
// invisible to a test that never runs the query at all.
const db = createTestDatabase();
const app = buildApp({ db });

afterAll(async () => {
  await app.close();
  await db.end();
});

beforeEach(async () => {
  await truncateAll(db);
});

async function seedServiceWithOneMetric() {
  const {
    rows: [service],
  } = await db.query<{ id: string }>("INSERT INTO services (name, slug) VALUES ('Test Service', 'test-service') RETURNING id");
  const {
    rows: [metric],
  } = await db.query<{ id: string }>(
    "INSERT INTO metrics (service_id, name, unit, kind) VALUES ($1, 'latency_ms', 'ms', 'gauge') RETURNING id",
    [service!.id],
  );
  const {
    rows: [production],
  } = await db.query<{ id: string }>("INSERT INTO environments (name) VALUES ('production') RETURNING id");
  await db.query("INSERT INTO environments (name) VALUES ('staging')");
  // A client-computed timestamp, not SQL now() — the window boundaries
  // below are also client-computed (Date.now()), and Postgres's clock can
  // read a hair ahead of Node's even moments later, which occasionally
  // excluded a now()-timestamped point sitting right at the window's end.
  await db.query("INSERT INTO metric_points (metric_id, environment_id, ts, value) VALUES ($1, $2, $3, 42)", [
    metric!.id,
    production!.id,
    new Date().toISOString(),
  ]);

  return { serviceId: service!.id, metricId: metric!.id };
}

function recentWindow() {
  const now = new Date();
  return { start: new Date(now.getTime() - 60_000).toISOString(), end: now.toISOString() };
}

describe("GET /api/metrics/:metricId/points against a real database", () => {
  it("returns 200 with an empty points array for a valid metric with no points in the requested environment", async () => {
    const { metricId } = await seedServiceWithOneMetric();
    const { start, end } = recentWindow();

    const response = await app.inject(`/api/metrics/${metricId}/points?environment=staging&start=${start}&end=${end}`);

    expect(response.statusCode).toBe(200);
    expect(response.json().points).toEqual([]);
  });

  it("returns the real points for an environment that has data", async () => {
    const { metricId } = await seedServiceWithOneMetric();
    const { start, end } = recentWindow();

    const response = await app.inject(`/api/metrics/${metricId}/points?environment=production&start=${start}&end=${end}`);

    expect(response.statusCode).toBe(200);
    expect(response.json().points).toHaveLength(1);
  });

  it("still 404s for a metric id that does not exist", async () => {
    await seedServiceWithOneMetric();
    const { start, end } = recentWindow();

    const response = await app.inject(`/api/metrics/00000000-0000-4000-8000-000000000000/points?environment=production&start=${start}&end=${end}`);

    expect(response.statusCode).toBe(404);
  });
});
