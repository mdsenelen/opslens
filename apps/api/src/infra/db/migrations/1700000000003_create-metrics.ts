import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createType("metric_kind", ["gauge", "counter", "histogram"]);

  pgm.createTable(
    "metrics",
    {
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
      name: { type: "varchar(200)", notNull: true },
      unit: { type: "varchar(50)", notNull: true },
      kind: { type: "metric_kind", notNull: true },
      created_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("now()"),
      },
    },
    {
      // A service should never define the same metric name twice — this is
      // the constraint the seed script (and later, the metrics module) relies
      // on for idempotent upserts.
      constraints: { unique: [["service_id", "name"]] },
    },
  );
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("metrics");
  pgm.dropType("metric_kind");
}
