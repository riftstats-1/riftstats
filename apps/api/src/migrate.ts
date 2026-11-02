import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { pool } from "./db.js";

const defaultDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));

export async function runMigrations(database: Pool = pool, directory = defaultDirectory) {
  const files = (await readdir(directory)).filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
  if (files.length === 0) throw new Error("No SQL migrations found");

  // Session locks and transactions must stay on one dedicated client.
  // https://node-postgres.com/features/transactions
  // https://www.postgresql.org/docs/17/explicit-locking.html#ADVISORY-LOCKS
  const client = await database.connect();
  try {
    await client.query("SET statement_timeout = '60s'");
    await client.query("SELECT pg_advisory_lock(8241, 1)");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const applied = await client.query<{ filename: string; checksum: string }>(
      "SELECT filename, checksum FROM schema_migrations",
    );
    const checksums = new Map(applied.rows.map((row) => [row.filename, row.checksum]));

    for (const filename of files) {
      const sql = await readFile(join(directory, filename), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      if (checksums.has(filename)) {
        if (checksums.get(filename) !== checksum) {
          throw new Error(`Migration checksum mismatch: ${filename}; create a new migration instead`);
        }
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations(filename, checksum) VALUES ($1, $2)", [filename, checksum]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    // Destroy this session even if unlock fails, so no lock or session settings
    // leak back into the application pool. Disconnect also releases advisory locks.
    try {
      await client.query("SELECT pg_advisory_unlock(8241, 1)");
    } finally {
      client.release(true);
    }
  }
}
