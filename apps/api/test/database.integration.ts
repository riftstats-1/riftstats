import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { after, afterEach, beforeEach, test } from "node:test";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { runMigrations } from "../src/migrate.js";
import { processNextJob, runFetcher } from "../src/fetcher.js";
import { claimJob, enqueueLookup } from "../src/jobs.js";
import { RiotError } from "../src/riot/errors.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/riot.json", import.meta.url), "utf8"));
const mockRiot = () => ({
  getAccountByRiotId: async () => fixture.account,
  getSummonerByPuuid: async () => fixture.summoner,
  getLeagueEntries: async () => fixture.leagueEntries,
});

const connectionString = process.env.TEST_DATABASE_URL;
assert.ok(connectionString, "Set TEST_DATABASE_URL to a dedicated PostgreSQL test database");
assert.ok(new URL(connectionString).pathname.endsWith("_test"), "Test database name must end with _test");
const admin = new pg.Pool({ connectionString, connectionTimeoutMillis: 2_000 });
let database: pg.Pool;
let schema: string;
let directory: string;

beforeEach(async () => {
  schema = `test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  database = new pg.Pool({
    connectionString,
    options: `-c search_path=${schema}`,
    connectionTimeoutMillis: 2_000,
    statement_timeout: 5_000,
  });
  directory = await mkdtemp(join(tmpdir(), "riftstats-migrations-"));
});

afterEach(async () => {
  await database.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  assert.equal(dirname(directory), tmpdir());
  assert.ok(basename(directory).startsWith("riftstats-migrations-"));
  await rm(directory, { recursive: true, force: true });
});
after(async () => { await admin.end(); });

test("initial schema is created once across concurrent starts and a restart", async () => {
  await Promise.all([runMigrations(database), runMigrations(database)]);
  const tables = await database.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename", [schema],
  );
  assert.deepEqual(tables.rows.map((r) => r.tablename), [
    "fetch_jobs", "match_participants", "matches", "players", "rank_entries", "schema_migrations",
  ]);
  const original = await database.query("SELECT * FROM schema_migrations");
  assert.equal(original.rowCount, 2);
  await database.end();
  database = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, connectionTimeoutMillis: 2_000 });
  await runMigrations(database);
  assert.deepEqual((await database.query("SELECT * FROM schema_migrations")).rows, original.rows);
});

test("schema enforces case-insensitive player identity and preserves non-player participants", async () => {
  await runMigrations(database);
  await database.query("INSERT INTO players(puuid, game_name, tag_line, region) VALUES ('a', 'Example', 'EUW', 'euw1')");
  await assert.rejects(
    database.query("INSERT INTO players(puuid, game_name, tag_line, region) VALUES ('b', 'example', 'euw', 'euw1')"),
    { code: "23505" },
  );
  await database.query("INSERT INTO matches(match_id) VALUES ('EUW1_1')");
  await database.query("INSERT INTO match_participants(match_id, puuid) VALUES ('EUW1_1', 'not-looked-up')");
  const job = await database.query("INSERT INTO fetch_jobs(kind, payload) VALUES ('lookup', '{}') RETURNING status, attempts");
  assert.deepEqual(job.rows[0], { status: "pending", attempts: 0 });
});

test("concurrent runners serialize a slow migration", async () => {
  await writeFile(join(directory, "001_slow.sql"), "SELECT pg_sleep(0.2); CREATE TABLE once_only(id int);");
  await Promise.all([runMigrations(database, directory), runMigrations(database, directory)]);
  assert.equal((await database.query("SELECT * FROM schema_migrations")).rowCount, 1);
});

test("failed SQL rolls back its file and releases the lock for a successful retry", async () => {
  await writeFile(join(directory, "001_good.sql"), "CREATE TABLE retained(id int);");
  await writeFile(join(directory, "002_bad.sql"), "CREATE TABLE rolled_back(id int); SELECT 1/0;");
  await assert.rejects(runMigrations(database, directory));
  assert.equal((await database.query("SELECT to_regclass('rolled_back') AS name")).rows[0].name, null);
  assert.equal((await database.query("SELECT * FROM schema_migrations")).rowCount, 1);
  await writeFile(join(directory, "002_bad.sql"), "CREATE TABLE rolled_back(id int);");
  await runMigrations(database, directory);
  assert.equal((await database.query("SELECT * FROM schema_migrations")).rowCount, 2);
});

test("an applied migration cannot be silently edited", async () => {
  const file = join(directory, "001_example.sql");
  await writeFile(file, "CREATE TABLE original(id int);");
  await runMigrations(database, directory);
  await writeFile(file, "CREATE TABLE changed(id int);");
  await assert.rejects(runMigrations(database, directory), /checksum/i);
  assert.equal((await database.query("SELECT to_regclass('changed') AS name")).rows[0].name, null);
});

test("readiness queries real Postgres and reports unavailable connections without breaking liveness", async () => {
  const app = buildApp({}, database);
  try {
    assert.equal((await app.inject({ url: "/ready" })).statusCode, 200);
    // End this test pool to simulate an unavailable database dependency.
    await database.end();
    database = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, connectionTimeoutMillis: 2_000 });
    const unavailable = await app.inject({ url: "/ready" });
    assert.equal(unavailable.statusCode, 503);
    assert.equal(unavailable.json().error.code, "DATABASE_UNAVAILABLE");
    assert.equal((await app.inject({ url: "/health" })).statusCode, 200);
  } finally {
    await app.close();
  }
});

test("concurrent case-insensitive lookups share one active numeric job ID", async () => {
  await runMigrations(database);
  const app = buildApp({}, database);
  try {
    const responses = await Promise.all(Array.from({ length: 8 }, (_, i) => app.inject({
      url: `/v1/players/euw1/${i % 2 ? "Example" : "example"}/EUW`,
    })));
    assert.ok(responses.every((r) => r.statusCode === 202));
    const id = responses[0].json().jobId;
    assert.equal(typeof id, "number");
    assert.ok(responses.every((r) => r.json().jobId === id));
    assert.equal((await database.query("SELECT * FROM fetch_jobs")).rowCount, 1);
  } finally { await app.close(); }
});

test("lookup proceeds from 202 through done to the desktop profile shape", async () => {
  await runMigrations(database);
  const app = buildApp({}, database);
  try {
    const initial = await app.inject({ url: "/v1/players/euw1/Example/EUW" });
    const id = initial.json().jobId;
    assert.equal(initial.statusCode, 202);
    assert.deepEqual((await app.inject({ url: `/v1/jobs/${id}` })).json(), { id, status: "pending" });
    const client = await database.connect();
    try { assert.equal(await processNextJob(client, mockRiot(), new AbortController().signal), true); }
    finally { client.release(); }
    assert.deepEqual((await app.inject({ url: `/v1/jobs/${id}` })).json(), { id, status: "done" });
    const profile = await app.inject({ url: "/v1/players/euw1/example/euw" });
    assert.equal(profile.statusCode, 200);
    const body = profile.json();
    assert.deepEqual(Object.keys(body).sort(), ["puuid", "gameName", "tagLine", "region", "profileIconId", "summonerLevel", "ranks", "lastFetched"].sort());
    assert.equal(body.profileIconId, 123);
    assert.deepEqual(body.ranks, [{ queueType: "RANKED_SOLO_5x5", tier: "GOLD", rank: "II", lp: 50, wins: 30, losses: 20 }]);
    assert.ok(Number.isFinite(Date.parse(body.lastFetched)));
  } finally { await app.close(); }
});

test("two claimers cannot run the same pending job", async () => {
  await runMigrations(database);
  await enqueueLookup(database, { region: "euw1", gameName: "Example", tagLine: "EUW" });
  const [a, b] = await Promise.all([claimJob(database), claimJob(database)]);
  assert.equal([a, b].filter(Boolean).length, 1);
  assert.equal((a ?? b)?.attempts, 1);
});

test("Riot errors become safe string job errors and do not create partial profiles", async () => {
  await runMigrations(database);
  const id = await enqueueLookup(database, { region: "euw1", gameName: "Example", tagLine: "EUW" });
  const client = await database.connect();
  try {
    await processNextJob(client, {
      ...mockRiot(), getLeagueEntries: async () => { throw new Error("private-password-or-token"); },
    }, new AbortController().signal);
  } finally { client.release(); }
  const app = buildApp({}, database);
  try {
    const job = (await app.inject({ url: `/v1/jobs/${id}` })).json();
    assert.equal(job.status, "failed");
    assert.equal(typeof job.error, "string");
    assert.ok(!job.error.includes("private-password-or-token"));
    assert.equal((await database.query("SELECT * FROM players")).rowCount, 0);
  } finally { await app.close(); }
});

test("a missing Riot player becomes a readable failed job", async () => {
  await runMigrations(database);
  const id = await enqueueLookup(database, { region: "euw1", gameName: "Missing", tagLine: "EUW" });
  const client = await database.connect();
  try {
    await processNextJob(client, {
      ...mockRiot(), getAccountByRiotId: async () => { throw new RiotError("RIOT_NOT_FOUND", "safe", 404); },
    }, new AbortController().signal);
  } finally { client.release(); }
  assert.equal((await database.query("SELECT error FROM fetch_jobs WHERE id=$1", [id])).rows[0].error, "Riot ID hittades inte");
});

test("aborting an in-flight job returns it to pending for recovery", async () => {
  await runMigrations(database);
  const id = await enqueueLookup(database, { region: "euw1", gameName: "Example", tagLine: "EUW" });
  const controller = new AbortController();
  const client = await database.connect();
  try {
    await assert.rejects(processNextJob(client, {
      ...mockRiot(), getAccountByRiotId: async () => { controller.abort(); throw controller.signal.reason; },
    }, controller.signal), { name: "AbortError" });
    assert.equal((await database.query("SELECT status FROM fetch_jobs WHERE id=$1", [id])).rows[0].status, "pending");
  } finally { client.release(); }
});

test("fetcher startup recovers interrupted jobs and stops gracefully", async () => {
  await runMigrations(database);
  const id = await enqueueLookup(database, { region: "euw1", gameName: "Example", tagLine: "EUW" });
  await database.query("UPDATE fetch_jobs SET status='running', attempts=1 WHERE id=$1", [id]);
  const exhausted = await enqueueLookup(database, { region: "euw1", gameName: "Exhausted", tagLine: "EUW" });
  await database.query("UPDATE fetch_jobs SET status='running', attempts=3 WHERE id=$1", [exhausted]);
  const controller = new AbortController();
  const loop = runFetcher(database, mockRiot(), controller.signal);
  try {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const row = (await database.query("SELECT status FROM fetch_jobs WHERE id=$1", [id])).rows[0];
      if (row.status === "done") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await assert.rejects(runFetcher(database, mockRiot(), new AbortController().signal), /annan fetcher/);
  } finally { controller.abort(); await loop; }
  const job = (await database.query("SELECT status, attempts FROM fetch_jobs WHERE id=$1", [id])).rows[0];
  assert.deepEqual(job, { status: "done", attempts: 2 });
  assert.deepEqual((await database.query("SELECT status, attempts FROM fetch_jobs WHERE id=$1", [exhausted])).rows[0], { status: "failed", attempts: 3 });
  const probe = await database.connect();
  try { assert.equal((await probe.query("SELECT pg_try_advisory_lock(8241, 2) AS acquired")).rows[0].acquired, true); }
  finally { probe.release(true); }
});

test("failed profile writes roll back both profile and rank data", async () => {
  await runMigrations(database);
  const id = await enqueueLookup(database, { region: "euw1", gameName: "Example", tagLine: "EUW" });
  const client = await database.connect();
  try {
    await processNextJob(client, {
      ...mockRiot(), getLeagueEntries: async () => [fixture.leagueEntries[0], fixture.leagueEntries[0]],
    }, new AbortController().signal);
  } finally { client.release(); }
  assert.equal((await database.query("SELECT * FROM players")).rowCount, 0);
  assert.equal((await database.query("SELECT * FROM rank_entries")).rowCount, 0);
  assert.equal((await database.query("SELECT status FROM fetch_jobs WHERE id=$1", [id])).rows[0].status, "failed");
});

test("lookup endpoints validate parameters and keep the common error shape", async () => {
  await runMigrations(database);
  const app = buildApp({}, database);
  try {
    for (const url of ["/v1/players/invalid/Example/EUW", "/v1/jobs/nope", "/v1/jobs/9007199254740992", "/v1/players/euw1/%20/EUW"]) {
      const res = await app.inject({ url });
      assert.equal(res.statusCode, 400, url);
      assert.equal(res.json().error.code, "VALIDATION_ERROR");
    }
    const absent = await app.inject({ url: "/v1/jobs/999999" });
    assert.equal(absent.statusCode, 404);
    assert.equal(absent.json().error.code, "JOB_NOT_FOUND");
  } finally { await app.close(); }
});
