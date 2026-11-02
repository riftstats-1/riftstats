import pg from "pg";

export interface Database {
  query: (sql: string, values?: unknown[]) => Promise<unknown>;
}

// Results come from our own pg driver, not an external JSON boundary.
export async function queryRows<T>(database: Database, sql: string, values?: unknown[]): Promise<T[]> {
  const result = await database.query(sql, values) as { rows: T[] };
  return result.rows;
}

// pg reads PGHOST, PGPORT, PGUSER, PGDATABASE and PGPASSWORD from the environment.
// https://node-postgres.com/apis/pool
export const pool = new pg.Pool({
  max: 10,
  connectionTimeoutMillis: 2_000,
  statement_timeout: 5_000,
});
