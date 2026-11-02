import Fastify, { type FastifyServerOptions } from "fastify";
import cors from "@fastify/cors";
import { pool, type Database } from "./db.js";
import { HttpError } from "./errors.js";
import { registerLookupRoutes } from "./routes.js";

/**
 * Bygger Fastify-appen utan att starta den.
 * Separat från server.ts så att testerna kan använda app.inject()
 * utan att öppna en port.
 */
export function buildApp(
  opts: FastifyServerOptions = {},
  database: Database = pool,
  mode: "api" | "fetcher" = "api",
) {
  const app = Fastify(opts);

  app.setErrorHandler((error, _request, reply) => {
    if (error && typeof error === "object" && "validation" in error && error.validation) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR", message: "Ogiltiga parametrar" } });
    }
    if (error instanceof HttpError) return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    const unavailable = typeof code === "string" && /^(08|57P0|ECONN|ENOTFOUND|ETIMEDOUT)/.test(code);
    app.log.error({ code: unavailable ? "DATABASE_UNAVAILABLE" : "INTERNAL_ERROR" }, "API-anrop misslyckades");
    return reply.code(unavailable ? 503 : 500).send({ error: {
      code: unavailable ? "DATABASE_UNAVAILABLE" : "INTERNAL_ERROR",
      message: unavailable ? "Databasen kan inte nås" : "Ett internt fel inträffade",
    } });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: { code: "NOT_FOUND", message: "Resursen hittades inte" } }));

  if (mode === "api") {
    app.register(cors, {
      origin: ["tauri://localhost", "http://tauri.localhost", ...(process.env.NODE_ENV === "production" ? [] : ["http://localhost:1420"])],
      methods: ["GET", "POST", "OPTIONS"],
    });
    registerLookupRoutes(app, database);
  }

  // Liveness: processen lever. Kubernetes startar om podden om den här slutar svara.
  app.get("/health", async () => ({ status: "ok" }));

  // Readiness kräver en fungerande databas; liveness är oberoende av Postgres.
  app.get("/ready", async (_request, reply) => {
    try {
      await database.query("SELECT 1");
      return { status: "ready" };
    } catch {
      return reply.code(503).send({
        error: { code: "DATABASE_UNAVAILABLE", message: "Databasen kan inte nås" },
      });
    }
  });

  app.get("/", async () => ({
    name: "riftstats-api",
    version: process.env.APP_VERSION ?? "dev",
  }));

  return app;
}
