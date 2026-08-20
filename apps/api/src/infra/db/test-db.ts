import { Pool } from "pg";

/**
 * Real-Postgres connection for integration tests (*.integration.test.ts).
 * Requires `pnpm db:up && pnpm --filter @opslens/api migrate:up` first —
 * these tests don't run migrations themselves, the same assumption
 * seed.ts makes about the database already being migrated.
 */
export function createTestDatabase(): Pool {
  return new Pool({
    connectionString: process.env.DATABASE_URL ?? "postgres://opslens:opslens@localhost:5432/opslens",
  });
}

export async function truncateAll(db: Pool): Promise<void> {
  await db.query("TRUNCATE alerts, alert_rules, metric_points, deployments, metrics, environments, services CASCADE");
}
