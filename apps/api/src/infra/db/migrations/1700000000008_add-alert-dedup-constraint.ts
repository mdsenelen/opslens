import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  // "One open alert per rule/environment" was application-only (a
  // read-then-insert in alert-evaluation-job.ts with no locking between the
  // two). Partial, not a full unique constraint on (alert_rule_id,
  // environment_id): resolved alerts must be allowed to accumulate — only
  // the currently-open state (firing/acknowledged) needs to be unique.
  // node-pg-migrate's typed createConstraint()/createIndex() don't expose a
  // WHERE clause on a unique index, so this is raw SQL, same as the BRIN
  // index in 1700000000004_create-metric-points.ts.
  pgm.sql(
    `CREATE UNIQUE INDEX alerts_open_per_rule_environment_idx
       ON alerts (alert_rule_id, environment_id)
       WHERE status IN ('firing', 'acknowledged')`,
  );
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("DROP INDEX IF EXISTS alerts_open_per_rule_environment_idx");
}
