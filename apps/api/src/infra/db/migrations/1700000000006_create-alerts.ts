import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createType("alert_status", ["firing", "acknowledged", "resolved"]);

  pgm.createTable("alerts", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    alert_rule_id: {
      type: "uuid",
      notNull: true,
      references: '"alert_rules"',
      onDelete: "CASCADE",
    },
    service_id: {
      type: "uuid",
      notNull: true,
      references: '"services"',
      onDelete: "CASCADE",
    },
    environment_id: {
      type: "uuid",
      notNull: true,
      references: '"environments"',
      onDelete: "CASCADE",
    },
    status: { type: "alert_status", notNull: true, default: "firing" },
    fired_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
    acknowledged_at: { type: "timestamptz" },
    resolved_at: { type: "timestamptz" },
  });

  // The Alerts screen's default view: "show me firing alerts for this
  // service" — see the fleet-overview and alerts-list journeys.
  pgm.createIndex("alerts", ["status", "service_id"]);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("alerts");
  pgm.dropType("alert_status");
}
