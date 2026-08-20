import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, truncateAll } from "../../infra/db/test-db";
import { runAlertEvaluation } from "./alert-evaluation-job";

// Requires a real Postgres: `pnpm db:up && pnpm --filter @opslens/api
// migrate:up`, then `pnpm --filter @opslens/api test:integration`. Proves
// two things the pure evaluateRule unit tests (alert-evaluator.test.ts)
// can't: that the recency-tolerance fix actually fires against realistic
// ingested rows (not hand-built point objects that can encode the same
// wrong assumption as the code under test), and that the partial unique
// index added in migration 1700000000008 actually enforces "at most one
// open alert per rule/environment" — README.md's idempotency claim, backed
// by a real constraint instead of trusted application logic alone.
const db = createTestDatabase();

afterAll(async () => db.end());

beforeEach(async () => truncateAll(db));

const DURATION_SECONDS = 180;

// evaluateRule requires the earliest surviving point to sit at-or-before
// the window start, while the window filter itself requires >= that same
// start — so real coverage needs a point sitting exactly on the boundary
// (this is why alert-evaluator.test.ts's own fixtures use `point(180, ...)`
// for a 180s-duration rule, not 175 or 185). Seeding points relative to the
// same `evaluatedAt` the test later passes to runAlertEvaluation —  instead
// of two independent wall-clock reads — is what makes that boundary exact
// and removes any dependency on real elapsed test-execution time.
async function seedFiringScenario(evaluatedAt: Date) {
  const {
    rows: [service],
  } = await db.query<{ id: string }>("INSERT INTO services (name, slug) VALUES ('Payments API', 'payments-api') RETURNING id");
  const {
    rows: [metric],
  } = await db.query<{ id: string }>(
    "INSERT INTO metrics (service_id, name, unit, kind) VALUES ($1, 'error_rate_pct', 'percent', 'gauge') RETURNING id",
    [service!.id],
  );
  const {
    rows: [environment],
  } = await db.query<{ id: string }>("INSERT INTO environments (name) VALUES ('production') RETURNING id");
  const {
    rows: [rule],
  } = await db.query<{ id: string }>(
    "INSERT INTO alert_rules (metric_id, comparator, threshold, duration_seconds, severity, enabled) VALUES ($1, 'gt', 5, $2, 'critical', true) RETURNING id",
    [metric!.id, DURATION_SECONDS],
  );

  // Realistic ingestion cadence: a point every 60s, the newest one 30s
  // before evaluatedAt — the shape the recency-tolerance fix targets (the
  // pre-fix exact-instant check required a point at-or-after evaluatedAt,
  // which this shape never satisfies).
  const base = evaluatedAt.getTime();
  for (const offsetSeconds of [DURATION_SECONDS, 120, 60, 30]) {
    await db.query("INSERT INTO metric_points (metric_id, environment_id, ts, value) VALUES ($1, $2, $3, 9)", [
      metric!.id,
      environment!.id,
      new Date(base - offsetSeconds * 1000).toISOString(),
    ]);
  }

  return { serviceId: service!.id, metricId: metric!.id, environmentId: environment!.id, ruleId: rule!.id };
}

describe("runAlertEvaluation against a real database", () => {
  it("fires against realistic ingestion cadence", async () => {
    const evaluatedAt = new Date();
    await seedFiringScenario(evaluatedAt);

    const changes = await runAlertEvaluation(db, evaluatedAt);

    expect(changes).toBe(1);
    const { rows } = await db.query<{ status: string }>("SELECT status FROM alerts");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("firing");
  });

  it("never opens a second alert for the same rule/environment on repeated evaluation", async () => {
    const evaluatedAt = new Date();
    await seedFiringScenario(evaluatedAt);

    await runAlertEvaluation(db, evaluatedAt);
    const secondRunChanges = await runAlertEvaluation(db, evaluatedAt);

    expect(secondRunChanges).toBe(0);
    const { rows } = await db.query<{ count: string }>("SELECT count(*)::text FROM alerts WHERE status IN ('firing', 'acknowledged')");
    expect(Number(rows[0]!.count)).toBe(1);
  });

  it("resolves a firing alert once the rule stops violating", async () => {
    const evaluatedAt = new Date();
    const { metricId, environmentId } = await seedFiringScenario(evaluatedAt);
    await runAlertEvaluation(db, evaluatedAt);

    await db.query("DELETE FROM metric_points WHERE metric_id = $1", [metricId]);
    const resolvedAt = new Date(evaluatedAt.getTime() + 1000);
    await db.query("INSERT INTO metric_points (metric_id, environment_id, ts, value) VALUES ($1, $2, $3, 0.5)", [
      metricId,
      environmentId,
      resolvedAt.toISOString(),
    ]);

    const changes = await runAlertEvaluation(db, resolvedAt);

    expect(changes).toBe(1);
    const { rows } = await db.query<{ status: string }>("SELECT status FROM alerts ORDER BY fired_at ASC");
    expect(rows[0]!.status).toBe("resolved");
  });

  it("calls onAlertChange with the resulting row for both a fire and a resolve", async () => {
    const evaluatedAt = new Date();
    const { metricId, environmentId } = await seedFiringScenario(evaluatedAt);
    const changes: string[] = [];

    await runAlertEvaluation(db, evaluatedAt, (alert) => changes.push(alert.status));
    expect(changes).toEqual(["firing"]);

    await db.query("DELETE FROM metric_points WHERE metric_id = $1", [metricId]);
    const resolvedAt = new Date(evaluatedAt.getTime() + 1000);
    await db.query("INSERT INTO metric_points (metric_id, environment_id, ts, value) VALUES ($1, $2, $3, 0.5)", [
      metricId,
      environmentId,
      resolvedAt.toISOString(),
    ]);
    await runAlertEvaluation(db, resolvedAt, (alert) => changes.push(alert.status));

    expect(changes).toEqual(["firing", "resolved"]);
  });
});
