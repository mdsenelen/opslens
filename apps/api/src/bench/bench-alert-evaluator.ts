import { performance } from "node:perf_hooks";
import { Pool } from "pg";
import { runAlertEvaluation } from "../modules/alerts/alert-evaluation-job";
import {
  buildScaledDataset, describeEnvironment, dropDatabase, KEEP, parseCopyMode, parseScale, percentile, SOURCE_URL,
} from "./scaled-dataset";

/**
 * Times the real alert evaluator (runAlertEvaluation) against the seed
 * scaled to BENCH_SCALE times its metric_points, the same dataset
 * (scaled-dataset.ts) as bench-services-environment.ts.
 *
 *   DATABASE_URL=postgres://opslens:opslens@localhost:5432/opslens \
 *     pnpm --filter @opslens/api bench:alert-evaluator
 *
 * After building the dataset, runs the evaluator BENCH_WARMUP times
 * untimed and BENCH_RUNS times timed. The alerts table is restored to its
 * seeded state before every run, outside the timed region, so each run does
 * identical work including its alert transitions.
 *
 * BENCH_COPIES=same-ts brackets the copy method (see scaled-dataset.ts),
 * since the method behind the first recorded figure was not written down.
 */

const SCALE = parseScale(process.env.BENCH_SCALE, 100);
const WARMUP = Number(process.env.BENCH_WARMUP ?? 3);
const RUNS = Number(process.env.BENCH_RUNS ?? 30);
const BUDGET_MS = 60_000; // server.ts evaluates every 60 s
const COPIES = parseCopyMode(process.env.BENCH_COPIES);

async function main(): Promise<void> {
  const admin = new Pool({ connectionString: SOURCE_URL });
  let db: Pool | undefined;
  try {
    db = await buildScaledDataset(admin, SCALE, COPIES);

    const { rows: [stats] } = await db.query<{ points: string; rules: string; evaluated_at: Date }>(
      "SELECT (SELECT count(*) FROM metric_points)::text AS points, (SELECT count(*) FROM alert_rules WHERE enabled)::text AS rules, (SELECT max(ts) FROM metric_points) AS evaluated_at",
    );
    // The newest seeded point is the seed's "now": what the 60 s tick would
    // see right after seeding. Fixed, so every run evaluates the same instant.
    const evaluatedAt = new Date(stats!.evaluated_at);
    await db.query("CREATE TABLE bench_alerts_baseline AS SELECT * FROM alerts");
    const restoreAlerts = async () => {
      await db!.query("DELETE FROM alerts");
      await db!.query("INSERT INTO alerts SELECT * FROM bench_alerts_baseline");
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
    const env = await describeEnvironment(db);

    console.log(`
Alert evaluator benchmark (${new Date().toISOString()})
  machine      ${env.machine}
  runtime      ${env.runtime}
  dataset      ${Number(stats!.points).toLocaleString("en-US")} metric_points (seed x ${SCALE}, copies: ${COPIES}), ${stats!.rules} enabled rules
  evaluatedAt  ${evaluatedAt.toISOString()} (newest seeded point)
  runs         ${WARMUP} warm-up, ${RUNS} timed; alert transitions per run: ${[...transitions].join(", ")}
  min          ${ms(sorted[0]!)}
  median       ${ms(median)}  (${share(median)})
  p95          ${ms(p95)}  (${share(p95)})
  max          ${ms(sorted.at(-1)!)}`);
  } finally {
    await db?.end();
    if (!KEEP) await dropDatabase(admin);
    await admin.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
