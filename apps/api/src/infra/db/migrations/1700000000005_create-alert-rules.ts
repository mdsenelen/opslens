import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createType("alert_comparator", ["gt", "gte", "lt", "lte"]);
  pgm.createType("alert_severity", ["info", "warning", "critical"]);

  pgm.createTable("alert_rules", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    metric_id: {
      type: "uuid",
      notNull: true,
      references: '"metrics"',
      onDelete: "CASCADE",
    },
    comparator: { type: "alert_comparator", notNull: true },
    threshold: { type: "double precision", notNull: true },
    duration_seconds: { type: "integer", notNull: true },
    severity: { type: "alert_severity", notNull: true },
    enabled: { type: "boolean", notNull: true, default: true },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("alert_rules");
  pgm.dropType("alert_severity");
  pgm.dropType("alert_comparator");
}
