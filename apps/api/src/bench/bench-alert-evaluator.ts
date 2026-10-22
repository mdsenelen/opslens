import { execFileSync } from "node:child_process";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { Pool } from "pg";
import { runAlertEvaluation } from "../modules/alerts/alert-evaluation-job";

/**
 * Times the real alert evaluator (runAlertEvaluation) against the seed
 * scaled to BENCH_SCALE times its metric_points, the same dataset shape as
 * the EXPLAIN ANALYZE measurements in docs/performance-report.md.
 *
 *   DATABASE_URL=postgres://opslens:opslens@localhost:5432/opslens \
 *     pnpm --filter @opslens/api bench:alert-evaluator
 *
 * DATABASE_URL is only used to create and later drop a throwaway database
 * (BENCH_DATABASE, default opslens_bench) on the same server; the database
 * it points at is never written to. That needs a role with CREATEDB.
 *
 * Steps: migrate and seed the throwaway database with the normal scripts,
 * copy every metric point BENCH_SCALE - 1 more times, each copy shifted
 * further into the past by the seed's own time span (so the evaluator's
 * trailing windows hold exactly the seeded points and the extra rows are
 * pure history), VACUUM ANALYZE, then run the evaluator BENCH_WARMUP times
 * untimed and BENCH_RUNS times timed. The alerts table is restored to its
 * seeded state before every run, outside the timed region, so each run does
 * identical work including its alert transitions.
 *
 * BENCH_COPIES=same-ts keeps every copy at its original timestamp instead,
 * so each trailing window holds BENCH_SCALE times as many points. That is
 * a heavier and less realistic shape (no real service reports the same
 * instant 100 times); it exists to bracket how much the copy method moves
 * the result, since the method behind the first recorded figure was not
 * written down.
 */

const SOURCE_URL = process.env.DATABASE_URL ?? "postgres://opslens:opslens@localhost:5432/opslens";
const BENCH_DATABASE = process.env.BENCH_DATABASE ?? "opslens_bench";
const SCALE = Number(process.env.BENCH_SCALE ?? 100);
const WARMUP = Number(process.env.BENCH_WARMUP ?? 3);
const RUNS = Number(process.env.BENCH_RUNS ?? 30);
const BUDGET_MS = 60_000; // server.ts evaluates every 60 s
const KEEP = process.env.BENCH_KEEP === "1";
const COPIES = process.env.BENCH_COPIES ?? "history";

if (!/^[a-z_][a-z0-9_]*$/.test(BENCH_DATABASE)) throw new Error(`BENCH_DATABASE must be a plain identifier, got ${BENCH_DATABASE}`);
if (!Number.isInteger(SCALE) || SCALE < 1) throw new Error("BENCH_SCALE must be a positive integer");
if (COPIES !== "history" && COPIES !== "same-ts") throw new Error(`BENCH_COPIES must be history or same-ts, got ${COPIES}`);

function benchUrl(): string {
  const url = new URL(SOURCE_URL);
  url.pathname = `/${BENCH_DATABASE}`;
  return url.toString();
}

/** Nearest-rank percentile of an ascending array. */
function percentile(sorted: number[], p: number): number {
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

async function recreateDatabase(admin: Pool): Promise<void> {
  await admin.query(`DROP DATABASE IF EXISTS ${BENCH_DATABASE}`);
  await admin.query(`CREATE DATABASE ${BENCH_DATABASE}`);
}

function migrateAndSeed(url: string): void {
  const env = { ...process.env, DATABASE_URL: url };
  execFileSync("pnpm", ["run", "--silent", "migrate:up"], { env, stdio: "ignore" });
  execFileSync("pnpm", ["run", "--silent", "seed"], { env, stdio: "inherit" });
}

async function scaleMetricPoints(db: Pool): Promise<void> {
  // In history mode each copy moves back by the seed's whole span plus a
  // minute, so no copy overlaps the seeded window or another copy.
  const shift = COPIES === "history" ? "g * span.width" : "interval '0'";
  await db.query(
    `INSERT INTO metric_points (metric_id, environment_id, ts, value)
     SELECT mp.metric_id, mp.environment_id, mp.ts - ${shift}, mp.value
     FROM metric_points mp,
          generate_series(1, $1::int - 1) AS g,
          (SELECT max(ts) - min(ts) + interval '1 minute' AS width FROM metric_points) AS span`,
    [SCALE],
  );
  await db.query("VACUUM ANALYZE metric_points");
}

async function main(): Promise<void> {
  const admin = new Pool({ connectionString: SOURCE_URL });
  await recreateDatabase(admin);
  const db = new Pool({ connectionString: benchUrl() });
  try {
    migrateAndSeed(benchUrl());
    await scaleMetricPoints(db);

    const { rows: [stats] } = await db.query<{ points: string; rules: string; evaluated_at: Date }>(
      "SELECT (SELECT count(*) FROM metric_points)::text AS points, (SELECT count(*) FROM alert_rules WHERE enabled)::text AS rules, (SELECT max(ts) FROM metric_points) AS evaluated_at",
    );
    // The newest seeded point is the seed's "now": what the 60 s tick would
    // see right after seeding. Fixed, so every run evaluates the same instant.
    const evaluatedAt = new Date(stats!.evaluated_at);
    await db.query("CREATE TABLE bench_alerts_baseline AS SELECT * FROM alerts");
    const restoreAlerts = async () => {
      await db.query("DELETE FROM alerts");
      await db.query("INSERT INTO alerts SELECT * FROM bench_alerts_baseline");
    };

    for (let i = 0; i < WARMUP; i++) {
      await restoreAlerts();
      await runAlertEvaluation(db, evaluatedAt);
    }

    const timings: number[] = [];
    const transitions = new Set<number>();
    for (let i = 0; i < RUNS; i++) {
      await restoreAlerts();
      const started = performance.now();
      const changes = await runAlertEvaluation(db, evaluatedAt);
      timings.push(performance.now() - started);
      transitions.add(changes);
    }

    const sorted = [...timings].sort((a, b) => a - b);
    const median = percentile(sorted, 50);
    const p95 = percentile(sorted, 95);
    const ms = (value: number) => `${value.toFixed(1)} ms`;
    const share = (value: number) => `${((value / BUDGET_MS) * 100).toFixed(2)}% of ${BUDGET_MS / 1000} s`;
    const { rows: [pg] } = await db.query<{ version: string }>("SELECT version()");

    console.log(`
Alert evaluator benchmark (${new Date().toISOString()})
  machine      ${os.cpus()[0]?.model ?? "unknown CPU"}, ${os.cpus().length} cores, ${(os.totalmem() / 2 ** 30).toFixed(0)} GB, ${os.type()} ${os.release()}
  runtime      Node ${process.version}, ${pg!.version.split(",")[0]}
  dataset      ${Number(stats!.points).toLocaleString("en-US")} metric_points (seed x ${SCALE}, copies: ${COPIES}), ${stats!.rules} enabled rules
  evaluatedAt  ${evaluatedAt.toISOString()} (newest seeded point)
  runs         ${WARMUP} warm-up, ${RUNS} timed; alert transitions per run: ${[...transitions].join(", ")}
  min          ${ms(sorted[0]!)}
  median       ${ms(median)}  (${share(median)})
  p95          ${ms(p95)}  (${share(p95)})
  max          ${ms(sorted.at(-1)!)}`);
  } finally {
    await db.end();
    if (!KEEP) await admin.query(`DROP DATABASE IF EXISTS ${BENCH_DATABASE}`);
    await admin.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
