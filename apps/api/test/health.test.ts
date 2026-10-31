import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const app = buildApp();

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
