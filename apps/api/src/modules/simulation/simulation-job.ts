import type { Database } from "../../infra/db/pool";
import { DATA_ENVIRONMENTS, METRIC_DEFS } from "../../infra/simulation/catalog";
import { deploymentsBetween, incidentsBetween, timestampsBetween, valueAt } from "../../infra/simulation/scenario";

const MINUTE = 60_000;

/** How far back a writer with no data, or a long sleep, fills in. */
export const BACKFILL_MS = 24 * 60 * MINUTE;
/** The chart's longest preset is 7 days; one extra day of slack. */
export const RETENTION_MS = 8 * 24 * 60 * MINUTE;
/** A gap longer than this means the process was not running. */
const GAP_THRESHOLD_MS = 3 * MINUTE;
const REPLAY_STEP_MS = 2 * MINUTE;
const REPLAY_TAIL_MS = 6 * MINUTE;

export type SimulationTickResult = {
  pointsWritten: number;
  deploymentsWritten: number;
  /**
   * Past instants at which the alert evaluator should run because the
   * process slept through an incident. Empty when there was no gap.
   */
  replayAt: Date[];
};

type SeriesRow = {
  service_slug: string;
  metric_id: string;
  metric_name: string;
  environment_id: string;
  environment_name: string;
  last_ts: string | null;
};

/**
 * One tick of the live demo: writes every metric point and scheduled
 * deployment between the last write and `now`, and prunes data older
 * than the retention window.
 *
 * It holds no state between calls. Each series continues from its own
 * newest row (or from now minus BACKFILL_MS if it has none), so a tick
 * after an hour's sleep writes that hour, and two ticks at the same
 * instant write nothing twice. The values come from scenario.ts, which
 * is why filling in the past gives the same data as being awake.
 *
 * Alerts are deliberately not written here. When a gap contained an
 * incident, the result lists the instants at which the caller should run
 * the real evaluator, so alerts for missed incidents come from the same
 * rules as live ones.
 */
export async function runSimulationTick(db: Database, now = new Date()): Promise<SimulationTickResult> {
  const nowMs = now.getTime();
  const floorMs = nowMs - BACKFILL_MS;

  const { rows: series } = await db.query<SeriesRow>(
    `SELECT s.slug AS service_slug, m.id AS metric_id, m.name AS metric_name,
            e.id AS environment_id, e.name::text AS environment_name,
            (SELECT max(mp.ts) FROM metric_points mp WHERE mp.metric_id = m.id AND mp.environment_id = e.id) AS last_ts
       FROM metrics m
       JOIN services s ON s.id = m.service_id
      CROSS JOIN environments e
      WHERE e.name::text = ANY($1::text[])`,
    [DATA_ENVIRONMENTS.map((e) => e.name)],
  );

  const metricIds: string[] = [];
  const environmentIds: string[] = [];
  const timestamps: string[] = [];
  const values: number[] = [];
  let gapStart = nowMs;

  for (const row of series) {
    const metric = METRIC_DEFS.find((m) => m.name === row.metric_name);
    const environment = DATA_ENVIRONMENTS.find((e) => e.name === row.environment_name);
    if (!metric || !environment) continue;

    const after = Math.max(row.last_ts ? new Date(row.last_ts).getTime() : floorMs, floorMs);
    if (environment.stepMinutes === 1) gapStart = Math.min(gapStart, after);

    for (const ts of timestampsBetween(after, nowMs, environment.stepMinutes * MINUTE)) {
      metricIds.push(row.metric_id);
      environmentIds.push(row.environment_id);
      timestamps.push(new Date(ts).toISOString());
      values.push(valueAt(row.service_slug, metric, environment.name, ts));
    }
  }

  if (timestamps.length > 0) {
    await db.query(
      `INSERT INTO metric_points (metric_id, environment_id, ts, value)
       SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::timestamptz[], $4::double precision[])`,
      [metricIds, environmentIds, timestamps, values],
    );
  }

  // Scheduled deployments in the backfill window, inserted only if that
  // exact row is not there yet. Re-checking the whole window each tick is
  // a few dozen candidate rows, and it means a missed tick never loses one.
  const scheduled = deploymentsBetween(floorMs, nowMs);
  const deploymentResult = await db.query(
    `INSERT INTO deployments (service_id, environment_id, version, status, deployed_at)
     SELECT s.id, e.id, d.version, 'success', d.deployed_at
       FROM unnest($1::text[], $2::text[], $3::text[], $4::timestamptz[]) AS d(slug, environment, version, deployed_at)
       JOIN services s ON s.slug = d.slug
       JOIN environments e ON e.name::text = d.environment
      WHERE NOT EXISTS (
        SELECT 1 FROM deployments x
         WHERE x.service_id = s.id AND x.environment_id = e.id AND x.version = d.version AND x.deployed_at = d.deployed_at
      )`,
    [scheduled.map((d) => d.serviceSlug), scheduled.map((d) => d.environment), scheduled.map((d) => d.version), scheduled.map((d) => new Date(d.deployedAt).toISOString())],
  );

  const cutoff = new Date(nowMs - RETENTION_MS).toISOString();
  await db.query("DELETE FROM metric_points WHERE ts < $1", [cutoff]);
  await db.query("DELETE FROM deployments WHERE deployed_at < $1", [cutoff]);
  await db.query("DELETE FROM alerts WHERE status = 'resolved' AND resolved_at < $1", [cutoff]);

  return {
    pointsWritten: timestamps.length,
    deploymentsWritten: deploymentResult.rowCount ?? 0,
    replayAt: nowMs - gapStart > GAP_THRESHOLD_MS ? replayInstants(gapStart, nowMs) : [],
  };
}

/**
 * Evaluation instants covering every incident inside a gap: every 2
 * minutes from the spike's start until a few minutes after it ends, which
 * is enough for each rule to fire (its window fills with violating
 * points) and to resolve again. Instants in the last minute are left to
 * the caller's normal evaluation at `now`.
 */
function replayInstants(gapStart: number, nowMs: number): Date[] {
  const instants: number[] = [];
  for (const incident of incidentsBetween(gapStart, nowMs)) {
    for (let t = incident.spikeStart; t <= incident.spikeEnd + REPLAY_TAIL_MS; t += REPLAY_STEP_MS) {
      if (t > gapStart && t < nowMs - MINUTE) instants.push(t);
    }
  }
  return [...new Set(instants)].sort((a, b) => a - b).map((t) => new Date(t));
}
