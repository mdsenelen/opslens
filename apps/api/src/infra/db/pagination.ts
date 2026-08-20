import type { Database, DbRow } from "./pool";

/**
 * The count-then-select-with-limit/offset shape every list route repeated
 * by hand. Callers build countSql/selectSql (their own WHERE predicates,
 * their own joins) against `args`; this runs both and appends limit/offset
 * as the last two params on the select, matching the placeholder numbering
 * `$${args.length + 1}` / `$${args.length + 2}` each route already used.
 */
export async function paginate<Row extends DbRow, T>(
  db: Database,
  opts: {
    countSql: string;
    selectSql: string;
    args: unknown[];
    page: number;
    limit: number;
    map: (row: Row) => T;
  },
): Promise<{ items: T[]; page: number; limit: number; total: number }> {
  const { countSql, selectSql, args, page, limit, map } = opts;
  const count = await db.query<{ total: string }>(countSql, args);
  const rows = await db.query<Row>(selectSql, [...args, limit, (page - 1) * limit]);
  return {
    items: rows.rows.map(map),
    page,
    limit,
    total: Number(count.rows[0]?.total ?? 0),
  };
}
