import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ensureAlertRules, upsertReferenceData } from "./infra/db/reference-data";
import { createTestDatabase, truncateAll } from "./infra/db/test-db";
import { deploymentsBetween, incidentsBetween, PERIOD_MS } from "./infra/simulation/scenario";
import { runLiveTick } from "./live-simulation";
import { BACKFILL_MS, RETENTION_MS } from "./modules/simulation/simulation-job";

// Requires a real, migrated Postgres (see vitest.integration.config.ts).
// Exercises the full live tick the API runs every minute when
// SIMULATION_ENABLED=true: points and deployments written by the
// simulation, and alerts opened and resolved by the real evaluator.
const db = createTestDatabase();
const MINUTE = 60_000;

afterAll(async () => db.end());

beforeEach(async () => {
  await truncateAll(db);
  const { metricIds } = await upsertReferenceData(db);
  await ensureAlertRules(db, metricIds);
});

// 2h30m into a period: the period's incident (40 to 59 minutes in) is
// over and its healthy release (1h50m in) has shipped, so nothing is
// mid-spike at `now`. 90 seconds past a minute keeps the tick off any
// step boundary.
const now = new Date(Math.floor(Date.UTC(2026, 9, 13, 12) / PERIOD_MS) * PERIOD_MS + 150 * MINUTE + 90_000);

async function count(sql: string, args: unknown[] = []): Promise<number> {
  const { rows } = await db.query<{ n: string }>(sql, args);
  return Number(rows[0]!.n);
}

describe("live simulation tick", () => {
  it("backfills the last 24 hours on an empty database: one point per minute in production, every 5 in staging", async () => {
    const result = await runLiveTick(db, now);

    // 4 services x 2 metrics, 1,440 production minutes + 288 staging steps.
    expect(result.pointsWritten).toBe(8 * (1440 + 288));
    expect(await count("SELECT count(*) AS n FROM metric_points")).toBe(8 * (1440 + 288));
    expect(result.deploymentsWritten).toBe(deploymentsBetween(now.getTime() - BACKFILL_MS, now.getTime()).length);
  });

  it("writes nothing twice: a second tick at the same instant adds no rows, and a tick a minute later adds one point per production series", async () => {
    await runLiveTick(db, now);
    const points = await count("SELECT count(*) AS n FROM metric_points");
    const deployments = await count("SELECT count(*) AS n FROM deployments");

    const again = await runLiveTick(db, now);
    expect(again).toMatchObject({ pointsWritten: 0, deploymentsWritten: 0, replayAt: [] });

    const next = await runLiveTick(db, new Date(now.getTime() + MINUTE));
    expect(next.pointsWritten).toBe(8);
    expect(next.replayAt).toEqual([]);
    expect(await count("SELECT count(*) AS n FROM metric_points")).toBe(points + 8);
    expect(await count("SELECT count(*) AS n FROM deployments")).toBe(deployments);
  });

  it("opens and resolves real alerts for every incident it slept through, timed inside each spike", async () => {
    const published: string[] = [];
    await runLiveTick(db, now, (alert) => published.push(alert.status));

    const incidents = incidentsBetween(now.getTime() - BACKFILL_MS, now.getTime()).filter((i) => i.spikeStart > now.getTime() - BACKFILL_MS);
    expect(incidents).toHaveLength(8);

    const { rows } = await db.query<{ slug: string; metric: string; status: string; fired_at: Date; resolved_at: Date | null }>(
      `SELECT s.slug, m.name AS metric, a.status, a.fired_at, a.resolved_at
         FROM alerts a JOIN alert_rules r ON r.id = a.alert_rule_id JOIN metrics m ON m.id = r.metric_id JOIN services s ON s.id = a.service_id
        ORDER BY a.fired_at`,
    );
    // Both rules (error rate and latency) fire once per incident.
    expect(rows).toHaveLength(incidents.length * 2);
    for (const incident of incidents) {
      const alerts = rows.filter((r) => r.slug === incident.serviceSlug && r.fired_at.getTime() >= incident.spikeStart && r.fired_at.getTime() <= incident.spikeEnd);
      expect(alerts.map((a) => a.metric).sort()).toEqual(["error_rate_pct", "p95_latency_ms"]);
      for (const alert of alerts) {
        expect(alert.status).toBe("resolved");
        expect(alert.resolved_at!.getTime()).toBeGreaterThanOrEqual(incident.spikeEnd);
      }
    }
    expect(await count("SELECT count(*) AS n FROM alerts WHERE status <> 'resolved'")).toBe(0);
    // Every write went out on the realtime stream: a fire and a resolve each.
    expect(published.filter((s) => s === "firing")).toHaveLength(incidents.length * 2);
    expect(published.filter((s) => s === "resolved")).toHaveLength(incidents.length * 2);
  });

  it("fires while an incident is in progress and resolves after recovery, minute by minute", async () => {
    const incident = incidentsBetween(now.getTime(), now.getTime() + PERIOD_MS).find((i) => i.spikeStart > now.getTime())!;
    // Wake up shortly before the spike so the backfill holds no incident of its own.
    await runLiveTick(db, new Date(incident.spikeStart - 10 * MINUTE));
    await db.query("DELETE FROM alerts");

    const statusAt = async (t: number) => {
      await runLiveTick(db, new Date(t));
      return count("SELECT count(*) AS n FROM alerts WHERE status = 'firing'");
    };
    let firing = 0;
    for (let t = incident.spikeStart - 9 * MINUTE; t <= incident.spikeStart + 8 * MINUTE; t += MINUTE) firing = await statusAt(t);
    expect(firing).toBe(2);
    for (let t = incident.spikeStart + 9 * MINUTE; t <= incident.spikeEnd + 2 * MINUTE; t += MINUTE) firing = await statusAt(t);
    expect(firing).toBe(0);
    expect(await count("SELECT count(*) AS n FROM alerts WHERE status = 'resolved'")).toBe(2);
  });

  it("prunes points and deployments older than the retention window", async () => {
    const { rows } = await db.query<{ metric_id: string; environment_id: string }>(
      "SELECT m.id AS metric_id, e.id AS environment_id FROM metrics m CROSS JOIN environments e WHERE e.name = 'production' LIMIT 1",
    );
    const old = new Date(now.getTime() - RETENTION_MS - MINUTE).toISOString();
    await db.query("INSERT INTO metric_points (metric_id, environment_id, ts, value) VALUES ($1, $2, $3, 1)", [rows[0]!.metric_id, rows[0]!.environment_id, old]);

    await runLiveTick(db, now);

    expect(await count("SELECT count(*) AS n FROM metric_points WHERE ts < $1", [new Date(now.getTime() - RETENTION_MS).toISOString()])).toBe(0);
  });
});
