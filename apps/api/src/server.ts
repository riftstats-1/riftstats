import closeWithGrace from "close-with-grace";
import { buildApp } from "./app.js";
import { pool } from "./db.js";
import { runMigrations } from "./migrate.js";

const mode = process.env.MODE ?? "api";
if (mode !== "api" && mode !== "fetcher") throw new Error("MODE måste vara api eller fetcher");

const app = buildApp({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
}, pool, mode);

const port = Number(process.env.PORT ?? 3000);
const controller = new AbortController();
let worker: Promise<void> | undefined;
let workerFailed = false;

pool.on("error", () => {
  app.log.error("En inaktiv Postgres-anslutning avbröts");
});
app.addHook("onClose", async () => { await pool.end(); });

// Graceful shutdown: vid SIGTERM (t.ex. under en rolling update) slutar Fastify ta emot
// nya anslutningar och avslutar pågående requests innan processen stängs.
const shutdown = closeWithGrace({ delay: 10_000 }, async ({ signal, err }) => {
  if (err) {
    app.log.error(err, "stänger ner efter fel");
  } else {
    app.log.info({ signal }, "stänger ner");
  }
  controller.abort();
  await worker?.catch(() => {});
  await app.close();
  if (workerFailed) throw new Error("Fetcher avslutades oväntat");
});

try {
  await runMigrations();
  if (mode === "fetcher") {
    const { RiotClient } = await import("./riot/client.js");
    const { runFetcher } = await import("./fetcher.js");
    worker = runFetcher(pool, new RiotClient(), controller.signal, app.log);
    worker.catch(() => {
      workerFailed = true;
      app.log.error("Fetcher avslutades oväntat");
      shutdown.close();
    });
  }
  await app.listen({ host: "0.0.0.0", port });
} catch (err) {
  app.log.error({ err }, "API:t kunde inte starta");
  // Otherwise close-with-grace handles beforeExit as a successful exit (code 0).
  shutdown.uninstall();
  controller.abort();
  await worker?.catch(() => {});
  await app.close();
  process.exitCode = 1;
}
