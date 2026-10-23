import { execFileSync } from "node:child_process";
import os from "node:os";
import { Pool } from "pg";

/**
 * The scaled dataset every benchmark in this folder measures against, so
 * their numbers describe the same rows.
 *
 * DATABASE_URL is only used to create and later drop a throwaway database
 * (BENCH_DATABASE, default opslens_bench) on the same server; the database
 * it points at is never written to. That needs a role with CREATEDB.
 *
 * buildScaledDataset migrates and seeds the throwaway database with the
 * normal scripts, then copies every metric point scale - 1 more times. In
 * "history" mode (the default) each copy is shifted further into the past
 * by the seed's own time span, so trailing windows hold exactly the seeded
 * points and the extra rows are pure history. "same-ts" keeps every copy at
 * its original timestamp instead: a heavier and less realistic shape (no
 * real service reports the same instant 100 times) that exists to bracket
 * how much the copy method moves a result. Ends with VACUUM ANALYZE.
 */

export type CopyMode = "history" | "same-ts";

export const SOURCE_URL = process.env.DATABASE_URL ?? "postgres://opslens:opslens@localhost:5432/opslens";
export const BENCH_DATABASE = process.env.BENCH_DATABASE ?? "opslens_bench";
export const KEEP = process.env.BENCH_KEEP === "1";

if (!/^[a-z_][a-z0-9_]*$/.test(BENCH_DATABASE)) throw new Error(`BENCH_DATABASE must be a plain identifier, got ${BENCH_DATABASE}`);

export function parseCopyMode(value: string | undefined): CopyMode {
  const mode = value ?? "history";
  if (mode !== "history" && mode !== "same-ts") throw new Error(`BENCH_COPIES must be history or same-ts, got ${mode}`);
  return mode;
}

export function parseScale(value: string | undefined, fallback: number): number {
  const scale = Number(value ?? fallback);
  if (!Number.isInteger(scale) || scale < 1) throw new Error("BENCH_SCALE must be a positive integer");
  return scale;
}

export function benchUrl(): string {
  const url = new URL(SOURCE_URL);
  url.pathname = `/${BENCH_DATABASE}`;
  return url.toString();
}

/** Nearest-rank percentile of an ascending array. */
export function percentile(sorted: number[], p: number): number {
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

export async function recreateDatabase(admin: Pool): Promise<void> {
  await admin.query(`DROP DATABASE IF EXISTS ${BENCH_DATABASE}`);
  await admin.query(`CREATE DATABASE ${BENCH_DATABASE}`);
}

export async function dropDatabase(admin: Pool): Promise<void> {
  await admin.query(`DROP DATABASE IF EXISTS ${BENCH_DATABASE}`);
}

function migrateAndSeed(url: string): void {
  const env = { ...process.env, DATABASE_URL: url };
  execFileSync("pnpm", ["run", "--silent", "migrate:up"], { env, stdio: "ignore" });
  execFileSync("pnpm", ["run", "--silent", "seed"], { env, stdio: "inherit" });
}

async function scaleMetricPoints(db: Pool, scale: number, copies: CopyMode): Promise<void> {
  if (scale > 1) {
    // In history mode each copy moves back by the seed's whole span plus a
    // minute, so no copy overlaps the seeded window or another copy.
    const shift = copies === "history" ? "g * span.width" : "interval '0'";
    await db.query(
      `INSERT INTO metric_points (metric_id, environment_id, ts, value)
       SELECT mp.metric_id, mp.environment_id, mp.ts - ${shift}, mp.value
       FROM metric_points mp,
            generate_series(1, $1::int - 1) AS g,
            (SELECT max(ts) - min(ts) + interval '1 minute' AS width FROM metric_points) AS span`,
      [scale],
    );
  }
  await db.query("VACUUM ANALYZE metric_points");
}

/** Recreates BENCH_DATABASE, seeds it, scales it, and returns a pool on it. */
export async function buildScaledDataset(admin: Pool, scale: number, copies: CopyMode): Promise<Pool> {
  await recreateDatabase(admin);
  migrateAndSeed(benchUrl());
  const db = new Pool({ connectionString: benchUrl() });
  await scaleMetricPoints(db, scale, copies);
  return db;
}

export async function describeEnvironment(db: Pool): Promise<{ machine: string; runtime: string }> {
  const { rows: [pg] } = await db.query<{ version: string }>("SELECT version()");
  return {
    machine: `${os.cpus()[0]?.model ?? "unknown CPU"}, ${os.cpus().length} cores, ${(os.totalmem() / 2 ** 30).toFixed(0)} GB, ${os.type()} ${os.release()}`,
    runtime: `Node ${process.version}, ${pg!.version.split(",")[0]}`,
  };
}
