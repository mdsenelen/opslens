import { Pool, type QueryResultRow } from "pg";

export type Database = Pick<Pool, "query">;

export function createDatabase(): Pool {
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ?? "postgres://opslens:opslens@localhost:5432/opslens",
  });
  // An idle client can emit 'error' (e.g. the connection drops) outside of
  // any query call; without a listener that's an unhandled event and pg
  // lets it crash the process. Log and let the pool recover the connection.
  pool.on("error", (err) => {
    console.error("unexpected error on idle database client", err);
  });
  return pool;
}

export type DbRow = QueryResultRow;
