import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("exits with code 1 instead of listening when Postgres is unavailable", async () => {
  const start = promisify(execFile)(process.execPath, ["--import", "tsx", "src/server.ts"], {
    timeout: 10_000,
    env: {
      ...process.env,
      PGHOST: "127.0.0.1",
      PGPORT: "1",
      PGUSER: "riftstats_test",
      PGPASSWORD: "test_only",
      PGDATABASE: "riftstats_test",
      PORT: "0",
      LOG_LEVEL: "silent",
    },
  });
  await expect(start).rejects.toMatchObject({ code: 1 });
}, 15_000);
