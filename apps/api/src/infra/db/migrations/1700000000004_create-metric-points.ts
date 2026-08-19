import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable("metric_points", {
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
    environment_id: {
      type: "uuid",
      notNull: true,
      references: '"environments"',
      onDelete: "CASCADE",
    },
    ts: { type: "timestamptz", notNull: true },
    value: { type: "double precision", notNull: true },
  });

  // Range-scan index for "give me this metric's points in this environment,
  // most recent first" — exactly the Service Detail chart query.
  pgm.createIndex("metric_points", [
    "metric_id",
    "environment_id",
    { name: "ts", sort: "DESC" },
  ]);

  // BRIN is the deliberate choice here (see the blueprint's database
  // section): metric_points is append-mostly and physically time-ordered,
  // which is exactly BRIN's best case — a few KB of index for a
  // multi-million-row table, versus a much larger B-tree. node-pg-migrate's
  // typed createIndex() doesn't expose "brin" as a method option, so this
  // one index is raw SQL; every other index in this schema uses the
  // typed helper.
  pgm.sql(
    "CREATE INDEX metric_points_ts_brin_idx ON metric_points USING BRIN (ts)",
  );
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql("DROP INDEX IF EXISTS metric_points_ts_brin_idx");
  pgm.dropTable("metric_points");
}
