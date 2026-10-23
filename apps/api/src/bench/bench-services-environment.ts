import { Pool } from "pg";
import { buildApp } from "../app";
import type { Database } from "../infra/db/pool";
import {
  buildScaledDataset, describeEnvironment, dropDatabase, KEEP, parseCopyMode, parseScale, percentile, SOURCE_URL,
} from "./scaled-dataset";

/**
 * EXPLAIN ANALYZE on the SQL that GET /api/services?environment= sends, at
 * each scale in BENCH_SCALES (default 1,10,100), on the same scaled dataset
 * as bench-alert-evaluator.ts (scaled-dataset.ts).
 *
 *   DATABASE_URL=postgres://opslens:opslens@localhost:5432/opslens \
 *     pnpm --filter @opslens/api bench:services-environment
 *
 * The SQL is not copied from the route. A real request goes through
 * buildApp() with a database wrapper that records every query and its
 * arguments, so the plans are for exactly what the route builds today.
 * The route sends two statements (the count and the paged select); each is
 * explained BENCH_RUNS times (default 5) and the median Execution Time
 * reported, with no untimed warm-up, so a cold first run shows in "runs".
 */

const SCALES = (process.env.BENCH_SCALES ?? "1,10,100").split(",").map((s) => parseScale(s.trim(), 1));
const RUNS = Number(process.env.BENCH_RUNS ?? 5);
const ENVIRONMENT = process.env.BENCH_ENVIRONMENT ?? "production";
const COPIES = parseCopyMode(process.env.BENCH_COPIES);

type Captured = { label: string; sql: string; args: unknown[] };
type PlanNode = { "Node Type": string; "Relation Name"?: string; "Index Name"?: string; "Workers Planned"?: number; Plans?: PlanNode[] };

async function captureRouteQueries(db: Pool): Promise<Captured[]> {
  const captured: Captured[] = [];
  const recording: Database = {
    query: ((sql: string, args?: unknown[]) => {
      captured.push({ label: "", sql, args: args ?? [] });
      return db.query(sql, args);
    }) as Database["query"],
  };
  const app = buildApp({ db: recording });
  try {
    const res = await app.inject({ method: "GET", url: `/api/services?environment=${ENVIRONMENT}` });
    if (res.statusCode !== 200) throw new Error(`GET /api/services returned ${res.statusCode}: ${res.body}`);
  } finally {
    await app.close();
  }
  if (captured.length !== 2) throw new Error(`expected the count and the select, captured ${captured.length} queries`);
  captured[0]!.label = "count";
  captured[1]!.label = "select";
  return captured;
}

/** Node types in plan order, e.g. "Seq Scan on metric_points", with parallel workers noted. */
function planShape(node: PlanNode, out: string[] = []): string[] {
  const on = node["Relation Name"] ?? node["Index Name"];
  const workers = node["Workers Planned"] ? ` (${node["Workers Planned"]} workers)` : "";
  out.push(`${node["Node Type"]}${on ? ` on ${on}` : ""}${workers}`);
  for (const child of node.Plans ?? []) planShape(child, out);
  return out;
}

async function explain(db: Pool, query: Captured) {
  const executions: number[] = [];
  let shape: string[] = [];
  for (let i = 0; i < RUNS; i++) {
    const { rows } = await db.query<{ "QUERY PLAN": [{ Plan: PlanNode; "Execution Time": number }] }>(
      `EXPLAIN (ANALYZE, FORMAT JSON) ${query.sql}`,
      query.args,
    );
    const [result] = rows[0]!["QUERY PLAN"];
    executions.push(result["Execution Time"]);
    shape = planShape(result.Plan);
  }
  return { executions, median: percentile([...executions].sort((a, b) => a - b), 50), shape };
}

async function main(): Promise<void> {
  const admin = new Pool({ connectionString: SOURCE_URL });
  const ms = (value: number) => `${value.toFixed(1)} ms`;
  try {
    for (const scale of SCALES) {
      const db = await buildScaledDataset(admin, scale, COPIES);
      try {
        const { rows: [stats] } = await db.query<{ points: string }>("SELECT count(*)::text AS points FROM metric_points");
        const env = await describeEnvironment(db);
        const queries = await captureRouteQueries(db);
        console.log(`
GET /api/services?environment=${ENVIRONMENT} (${new Date().toISOString()})
  machine      ${env.machine}
  runtime      ${env.runtime}
  dataset      ${Number(stats!.points).toLocaleString("en-US")} metric_points (seed x ${scale}, copies: ${COPIES})`);
        for (const query of queries) {
          const result = await explain(db, query);
          console.log(`  ${query.label.padEnd(12)} median ${ms(result.median)}  runs ${result.executions.map(ms).join(", ")}
               plan: ${result.shape.join(" > ")}`);
        }
      } finally {
        await db.end();
      }
    }
  } finally {
    if (!KEEP) await dropDatabase(admin);
    await admin.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
