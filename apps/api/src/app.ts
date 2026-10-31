import Fastify, { type FastifyServerOptions } from "fastify";

/**
 * Bygger Fastify-appen utan att starta den.
 * Separat från server.ts så att testerna kan använda app.inject()
 * utan att öppna en port.
 */
export function buildApp(opts: FastifyServerOptions = {}) {
  const app = Fastify(opts);

  // Liveness: processen lever. Kubernetes startar om podden om den här slutar svara.
  app.get("/health", async () => ({ status: "ok" }));

  // Readiness: podden kan ta emot trafik. Kontrollerar databasen när Postgres finns på plats.
  app.get("/ready", async () => ({ status: "ready" }));

  app.get("/", async () => ({
    name: "riftstats-api",
    version: process.env.APP_VERSION ?? "dev",
  }));

  return app;
}
