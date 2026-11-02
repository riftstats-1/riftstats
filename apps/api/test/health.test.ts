import { afterAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";

const database = { query: vi.fn(async (_sql: string) => ({})) };
const app = buildApp({}, database);

afterAll(async () => {
  await app.close();
});

describe("health endpoints", () => {
  it("GET /health svarar 200", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("GET /ready svarar 200", async () => {
    const res = await app.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ready" });
    expect(database.query).toHaveBeenCalledWith("SELECT 1");
  });

  it("GET /ready ger 503 vid databasfel medan /health fortfarande ger 200", async () => {
    database.query.mockRejectedValueOnce(new Error("private connection details"));
    const res = await app.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      error: { code: "DATABASE_UNAVAILABLE", message: "Databasen kan inte nås" },
    });
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
  });

  it("GET / visar namn och version", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: "riftstats-api" });
  });

  it("okänd route svarar 404", async () => {
    const res = await app.inject({ method: "GET", url: "/finns-inte" });
    expect(res.statusCode).toBe(404);
  });
});
