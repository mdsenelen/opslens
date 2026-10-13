import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { createTestDatabase, truncateAll } from "../../infra/db/test-db";

// Requires a real Postgres (see metrics.integration.test.ts). The alert
// detail's rule.metricId is what lets the alert screen link straight back
// to the metric chart that shows the violation, so it is checked against
// the real join rather than a fake db.
const db = createTestDatabase();
const app = buildApp({ db });

afterAll(async () => {
  await app.close();
  await db.end();
});

beforeEach(async () => {
  await truncateAll(db);
});

describe("GET /api/alerts/:alertId against a real database", () => {
  it("returns the firing rule's metricId alongside its threshold", async () => {
    const {
      rows: [service],
    } = await db.query<{ id: string }>("INSERT INTO services (name, slug) VALUES ('Test Service', 'test-service') RETURNING id");
    const {
      rows: [metric],
    } = await db.query<{ id: string }>("INSERT INTO metrics (service_id, name, unit, kind) VALUES ($1, 'error_rate_pct', 'percent', 'gauge') RETURNING id", [
      service!.id,
    ]);
    const {
      rows: [environment],
    } = await db.query<{ id: string }>("INSERT INTO environments (name) VALUES ('production') RETURNING id");
    const {
      rows: [rule],
    } = await db.query<{ id: string }>(
      "INSERT INTO alert_rules (metric_id, comparator, threshold, duration_seconds, severity, enabled) VALUES ($1, 'gt', 5, 180, 'critical', true) RETURNING id",
      [metric!.id],
    );
    const {
      rows: [alert],
    } = await db.query<{ id: string }>(
      "INSERT INTO alerts (alert_rule_id, service_id, environment_id, status, fired_at) VALUES ($1, $2, $3, 'firing', $4) RETURNING id",
      [rule!.id, service!.id, environment!.id, new Date().toISOString()],
    );

    const response = await app.inject(`/api/alerts/${alert!.id}`);

    expect(response.statusCode).toBe(200);
    expect(response.json().rule).toEqual({ metricId: metric!.id, comparator: "gt", threshold: 5, durationSeconds: 180 });
  });
});
