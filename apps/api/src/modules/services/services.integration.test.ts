import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { createTestDatabase, truncateAll } from "../../infra/db/test-db";

// Requires a real Postgres (see metrics.integration.test.ts).
const db = createTestDatabase();
const app = buildApp({ db });

afterAll(async () => {
  await app.close();
  await db.end();
});

beforeEach(async () => {
  await truncateAll(db);
});

describe("GET /api/services activeAlertCount against a real database", () => {
  it("counts firing and acknowledged alerts as active, and not resolved ones", async () => {
    const {
      rows: [service],
    } = await db.query<{ id: string }>("INSERT INTO services (name, slug) VALUES ('Test Service', 'test-service') RETURNING id");
    const {
      rows: [environment],
    } = await db.query<{ id: string }>("INSERT INTO environments (name) VALUES ('production') RETURNING id");
    // One rule per alert: the open-alert unique index allows only one
    // firing/acknowledged alert per rule and environment.
    for (const [name, status] of [
      ["a", "firing"],
      ["b", "acknowledged"],
      ["c", "resolved"],
    ] as const) {
      const {
        rows: [metric],
      } = await db.query<{ id: string }>("INSERT INTO metrics (service_id, name, unit, kind) VALUES ($1, $2, 'ms', 'gauge') RETURNING id", [service!.id, name]);
      const {
        rows: [rule],
      } = await db.query<{ id: string }>(
        "INSERT INTO alert_rules (metric_id, comparator, threshold, duration_seconds, severity, enabled) VALUES ($1, 'gt', 5, 180, 'critical', true) RETURNING id",
        [metric!.id],
      );
      await db.query("INSERT INTO alerts (alert_rule_id, service_id, environment_id, status, fired_at) VALUES ($1, $2, $3, $4, $5)", [
        rule!.id,
        service!.id,
        environment!.id,
        status,
        new Date().toISOString(),
      ]);
    }

    const response = await app.inject("/api/services");

    expect(response.statusCode).toBe(200);
    expect(response.json().items[0].activeAlertCount).toBe(2);
  });
});
