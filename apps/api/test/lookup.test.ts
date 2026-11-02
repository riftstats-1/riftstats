import { afterEach, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("queues a lookup without calling Riot from the API", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const database = { query: vi.fn(async (sql: string) => ({ rows: sql.includes("INSERT INTO fetch_jobs") ? [{ id: "42" }] : [] })) };
  const app = buildApp({}, database);
  try {
    const res = await app.inject({ url: "/v1/players/euw1/Example/EUW" });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ jobId: 42 });
    expect(fetch).not.toHaveBeenCalled();
  } finally { await app.close(); }
});

it("permits desktop CORS preflight and excludes unapproved origins", async () => {
  vi.stubEnv("NODE_ENV", "development");
  const app = buildApp();
  try {
    for (const origin of ["tauri://localhost", "http://tauri.localhost", "http://localhost:1420"]) {
      const res = await app.inject({ method: "OPTIONS", url: "/v1/players/euw1/Example/EUW", headers: {
        origin, "access-control-request-method": "GET",
      } });
      expect(res.statusCode).toBe(204);
      expect(res.headers["access-control-allow-origin"]).toBe(origin);
    }
    const denied = await app.inject({ url: "/health", headers: { origin: "https://unapproved.example" } });
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  } finally { await app.close(); }
});

it("omits the development origin in production", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const app = buildApp();
  try {
    const res = await app.inject({ url: "/health", headers: { origin: "http://localhost:1420" } });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  } finally { await app.close(); }
});

it("exposes health probes but not player endpoints in fetcher mode", async () => {
  const app = buildApp({}, { query: async () => ({ rows: [] }) }, "fetcher");
  try {
    expect((await app.inject({ url: "/health" })).statusCode).toBe(200);
    expect((await app.inject({ url: "/ready" })).statusCode).toBe(200);
    expect((await app.inject({ url: "/v1/players/euw1/Example/EUW" })).statusCode).toBe(404);
  } finally { await app.close(); }
});

it("hides internal database details and returns the documented unavailable error", async () => {
  const app = buildApp({}, { query: async () => { throw Object.assign(new Error("private-password"), { code: "ECONNREFUSED" }); } });
  try {
    const res = await app.inject({ url: "/v1/players/euw1/Example/EUW" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: { code: "DATABASE_UNAVAILABLE", message: "Databasen kan inte nås" } });
  } finally { await app.close(); }
});
