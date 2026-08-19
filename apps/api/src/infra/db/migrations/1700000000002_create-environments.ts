import type { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createType("environment_name", [
    "production",
    "staging",
    "development",
  ]);

  pgm.createTable("environments", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    name: { type: "environment_name", notNull: true, unique: true },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable("environments");
  pgm.dropType("environment_name");
}
