import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createType("deployment_status", ["pending", "success", "failed"]);

  pgm.createTable("deployments", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
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
    version: { type: "varchar(100)", notNull: true },
    status: { type: "deployment_status", notNull: true },
    deployed_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  // Powers both the Deployments table and "find the deploy just before this
  // spike" on a Service Detail chart.
  pgm.createIndex("deployments", [
    "service_id",
    "environment_id",
    { name: "deployed_at", sort: "DESC" },
  ]);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("deployments");
  pgm.dropType("deployment_status");
}
