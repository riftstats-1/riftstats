import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
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
import { parseMatch } from "../src/riot/parsers.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/riot.json", import.meta.url), "utf8"));
const mockRiot = () => ({
  getAccountByRiotId: async () => fixture.account,
  getAccountByPuuid: async () => fixture.account,
  getSummonerByPuuid: async () => fixture.summoner,
  getLeagueEntries: async () => fixture.leagueEntries,
  getMatchIds: async () => fixture.matchIds,
  getMatch: async (_region: string, id: string) => sampleMatch(id),
});

function sampleMatch(id = fixture.match.metadata.matchId, timeOffset = 0) {
  const source = structuredClone(fixture.match);
  source.metadata.matchId = id;
  source.info.gameStartTimestamp += timeOffset;
  return parseMatch(source);
}

async function processQueued(riot = mockRiot()) {
  const client = await database.connect();
  try { return await processNextJob(client, riot, new AbortController().signal); }
  finally { client.release(); }
}

async function seedPlayer() {
  await enqueueLookup(database, { region: "euw1", gameName: "Example", tagLine: "EUW" });
  await processQueued();
}

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
  assert.equal(original.rowCount, 3);
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

test("migration checksums tolerate checkout line endings and legacy CRLF history", async () => {
  const lf = "CREATE TABLE line_endings(id int);\n-- unchanged SQL\n";
  const crlf = lf.replaceAll("\n", "\r\n");
  const file = join(directory, "001_lines.sql");
  await writeFile(file, lf);
  await runMigrations(database, directory);
  const original = (await database.query("SELECT * FROM schema_migrations")).rows;
  await writeFile(file, crlf);
  await runMigrations(database, directory);
  assert.deepEqual((await database.query("SELECT * FROM schema_migrations")).rows, original);

  // Simulate history created by the previous Windows runner, only in this test schema.
  const legacy = createHash("sha256").update(crlf).digest("hex");
  await database.query("UPDATE schema_migrations SET checksum=$1", [legacy]);
  await writeFile(file, lf);
  await runMigrations(database, directory);
  assert.equal((await database.query("SELECT checksum FROM schema_migrations")).rows[0].checksum, legacy);
  await writeFile(file, lf + "ALTER TABLE line_endings ADD COLUMN changed int;\n");
  await assert.rejects(runMigrations(database, directory), /checksum/i);
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

test("lookup saves raw matches and every participant, then serves the desktop match array", async () => {
  await runMigrations(database);
  await enqueueLookup(database, { region: "euw1", gameName: "Example", tagLine: "EUW" });
  const source = structuredClone(fixture.match);
  source.info.participants = Array.from({ length: 10 }, (_, i) => ({
    ...source.info.participants[0], puuid: i === 0 ? "fixture-puuid" : `other-${i}`,
    goldEarned: 12000, totalDamageDealtToChampions: 23000,
  }));
  source.metadata.participants = source.info.participants.map((p: { puuid: string }) => p.puuid);
  await processQueued({ ...mockRiot(), getMatch: async () => parseMatch(source) });
  assert.equal((await database.query("SELECT * FROM match_participants")).rowCount, 10);
  const stored = (await database.query("SELECT raw FROM matches")).rows[0].raw;
  assert.equal(stored.info.participants.length, 10);
  assert.deepEqual((await database.query("SELECT gold, damage FROM match_participants WHERE puuid='fixture-puuid'")).rows[0], { gold: 12000, damage: 23000 });
  const app = buildApp({}, database);
  try {
    const res = await app.inject({ url: "/v1/players/fixture-puuid/matches" });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), [{
      matchId: "EUW1_1234567890", queueId: 420,
      gameStart: new Date(source.info.gameStartTimestamp).toISOString(), durationS: 1800,
      championName: "Ahri", win: true, kills: 10, deaths: 2, assists: 8, cs: 200,
      items: [3031, 3006, 0, 0, 0, 0, 3340],
    }]);
  } finally { await app.close(); }
});

test("match history is newest first, bounded by limit and validates input", async () => {
  await runMigrations(database);
  await enqueueLookup(database, { region: "euw1", gameName: "Example", tagLine: "EUW" });
  await processQueued({
    ...mockRiot(), getMatchIds: async () => ["EUW1_1", "EUW1_2"],
    getMatch: async (_region, id) => sampleMatch(id, id === "EUW1_2" ? 60000 : 0),
  });
  const app = buildApp({}, database);
  try {
    const all = await app.inject({ url: "/v1/players/fixture-puuid/matches" });
    assert.deepEqual(all.json().map((m: { matchId: string }) => m.matchId), ["EUW1_2", "EUW1_1"]);
    const page = await app.inject({ url: "/v1/players/fixture-puuid/matches?limit=1" });
    assert.equal(page.json().length, 1);
    for (const query of ["limit=0", "limit=101", "limit=nope", "limit=1.5"]) {
      assert.equal((await app.inject({ url: `/v1/players/fixture-puuid/matches?${query}` })).statusCode, 400);
    }
    assert.equal((await app.inject({ url: "/v1/players/%20/matches" })).statusCode, 400);
    const absent = await app.inject({ url: "/v1/players/unknown/matches" });
    assert.equal(absent.statusCode, 404);
    assert.equal(absent.json().error.code, "PLAYER_NOT_FOUND");
  } finally { await app.close(); }
});

test("known player without matches gets an empty array", async () => {
  await runMigrations(database);
  await enqueueLookup(database, { region: "euw1", gameName: "Example", tagLine: "EUW" });
  await processQueued({ ...mockRiot(), getMatchIds: async () => [] });
  const app = buildApp({}, database);
  try { assert.deepEqual((await app.inject({ url: "/v1/players/fixture-puuid/matches" })).json(), []); }
  finally { await app.close(); }
});

test("match details expose saved metadata and all participants without raw upstream fields or Riot calls", async () => {
  await runMigrations(database);
  const match = sampleMatch();
  match.info.participants.push({ ...match.info.participants[0], puuid: "opponent-puuid", teamId: 200, win: false });
  match.info.privateUpstreamField = "must-not-leak";
  await enqueueLookup(database, { region: "euw1", gameName: "Example", tagLine: "EUW" });
  await processQueued({ ...mockRiot(), getMatch: async () => match });
  const app = buildApp({}, database);
  try {
    const res = await app.inject({ url: `/v1/matches/${match.metadata.matchId}` });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), {
      matchId: match.metadata.matchId, queueId: 420, gameStart: new Date(match.info.gameStartTimestamp).toISOString(),
      durationS: 1800, patch: "26.21.1",
      participants: match.info.participants.map((p) => ({
        puuid: p.puuid, championId: p.championId, championName: p.championName, teamId: p.teamId,
        win: p.win, kills: p.kills, deaths: p.deaths, assists: p.assists,
        cs: p.totalMinionsKilled + p.neutralMinionsKilled, gold: p.goldEarned,
        damage: p.totalDamageDealtToChampions,
        items: [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6],
      })),
    });
    assert.equal((await database.query("SELECT count(*)::int AS n FROM fetch_jobs")).rows[0].n, 1);
  } finally { await app.close(); }
});

test("match details validate IDs and return a structured 404 for an uncached match", async () => {
  await runMigrations(database);
  const app = buildApp({}, database);
  try {
    for (const id of ["%20", "EUW1_nope", "euw1_123", "EUW1_1%27", "A".repeat(50)]) {
      const res = await app.inject({ url: `/v1/matches/${id}` });
      assert.equal(res.statusCode, 400, id);
      assert.equal(res.json().error.code, "VALIDATION_ERROR");
    }
    const absent = await app.inject({ url: "/v1/matches/EUW1_999" });
    assert.equal(absent.statusCode, 404);
    assert.equal(absent.json().error.code, "MATCH_NOT_FOUND");
    assert.equal((await database.query("SELECT count(*)::int AS n FROM fetch_jobs")).rows[0].n, 0);
  } finally { await app.close(); }
});

test("champion stats aggregate only the requested player's saved matches and sort ties deterministically", async () => {
  await runMigrations(database);
  const samples = [
    ["Ahri", true, 10, 0, 8], ["Ahri", false, 2, 4, 3],
    ["Garen", true, 5, 1, 0], ["Zed", true, 3, 0, 0],
    ["Lux", false, 1, 2, 3],
  ] as const;
  await enqueueLookup(database, { region: "euw1", gameName: "Example", tagLine: "EUW" });
  await processQueued({
    ...mockRiot(),
    getMatchIds: async () => samples.map((_, i) => `EUW1_${i + 1}`),
    getMatch: async (_region, id) => {
      const match = sampleMatch(id);
      const [championName, win, kills, deaths, assists] = samples[Number(id.split("_")[1]) - 1];
      Object.assign(match.info.participants[0], { championName, win, kills, deaths, assists });
      match.info.participants.push({ ...match.info.participants[0], puuid: "other-player", kills: 99 });
      return match;
    },
  });
  const app = buildApp({}, database);
  try {
    const res = await app.inject({ url: "/v1/players/fixture-puuid/champions" });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), [
      { championName: "Ahri", games: 2, wins: 1, kills: 12, deaths: 4, assists: 11 },
      { championName: "Garen", games: 1, wins: 1, kills: 5, deaths: 1, assists: 0 },
      { championName: "Zed", games: 1, wins: 1, kills: 3, deaths: 0, assists: 0 },
      { championName: "Lux", games: 1, wins: 0, kills: 1, deaths: 2, assists: 3 },
    ]);
    const limited = await app.inject({ url: "/v1/players/fixture-puuid/champions?limit=1" });
    assert.deepEqual(limited.json(), res.json().slice(0, 1));
  } finally { await app.close(); }
});

test("champion stats distinguish empty history from an unknown player and reject invalid input", async () => {
  await runMigrations(database);
  await enqueueLookup(database, { region: "euw1", gameName: "Example", tagLine: "EUW" });
  await processQueued({ ...mockRiot(), getMatchIds: async () => [] });
  const app = buildApp({}, database);
  try {
    const empty = await app.inject({ url: "/v1/players/fixture-puuid/champions" });
    assert.equal(empty.statusCode, 200);
    assert.deepEqual(empty.json(), []);
    const absent = await app.inject({ url: "/v1/players/unknown/champions" });
    assert.equal(absent.statusCode, 404);
    assert.equal(absent.json().error.code, "PLAYER_NOT_FOUND");
    for (const query of ["limit=0", "limit=101", "limit=nope", "limit=1.5"]) {
      const res = await app.inject({ url: `/v1/players/fixture-puuid/champions?${query}` });
      assert.equal(res.statusCode, 400, query);
      assert.equal(res.json().error.code, "VALIDATION_ERROR");
    }
    assert.equal((await app.inject({ url: "/v1/players/%20/champions" })).statusCode, 400);
  } finally { await app.close(); }
});

test("concurrent refreshes reuse one numeric job ID and cannot bypass the cooldown", async () => {
  await runMigrations(database);
  await seedPlayer();
  const app = buildApp({}, database);
  try {
    const refresh = () => app.inject({ method: "POST", url: "/v1/players/fixture-puuid/refresh" });
    const responses = await Promise.all(Array.from({ length: 10 }, refresh));
    assert.ok(responses.every((r) => r.statusCode === 202));
    const id = responses[0].json().jobId;
    assert.equal(typeof id, "number");
    assert.ok(responses.every((r) => r.json().jobId === id));
    assert.equal((await database.query("SELECT * FROM fetch_jobs WHERE kind='refresh'")).rowCount, 1);
    await database.query("UPDATE fetch_jobs SET status='done' WHERE id=$1", [id]);
    const denied = await refresh();
    assert.equal(denied.statusCode, 429);
    assert.equal(denied.json().error.code, "REFRESH_RATE_LIMITED");
    assert.ok(Number(denied.headers["retry-after"]) >= 1 && Number(denied.headers["retry-after"]) <= 120);
    await database.query("UPDATE players SET refresh_requested_at=clock_timestamp()-interval '120 seconds'");
    const accepted = await refresh();
    assert.equal(accepted.statusCode, 202);
    assert.notEqual(accepted.json().jobId, id);
    // An active job is reused even when it lasts longer than the cooldown.
    await database.query("UPDATE players SET refresh_requested_at=clock_timestamp()-interval '121 seconds'");
    assert.equal((await refresh()).json().jobId, accepted.json().jobId);
  } finally { await app.close(); }
});

test("refresh updates renamed accounts by PUUID and fetches only missing matches", async () => {
  await runMigrations(database);
  await seedPlayer();
  const original = (await database.query("SELECT * FROM matches")).rows[0];
  const app = buildApp({}, database);
  try {
    const queued = await app.inject({ method: "POST", url: "/v1/players/fixture-puuid/refresh" });
    const fetched: string[] = [];
    await processQueued({
      ...mockRiot(),
      getAccountByRiotId: async () => { throw new Error("refresh must use PUUID"); },
      getAccountByPuuid: async () => ({ ...fixture.account, gameName: "Renamed", tagLine: "NEW" }),
      getSummonerByPuuid: async () => ({ ...fixture.summoner, summonerLevel: 101 }),
      getMatchIds: async () => ["EUW1_2", original.match_id, "EUW1_2"],
      getMatch: async (_region, id) => { fetched.push(id); return sampleMatch(id, 60000); },
    });
    assert.deepEqual(fetched, ["EUW1_2"]);
    const status = await app.inject({ url: `/v1/jobs/${queued.json().jobId}` });
    assert.equal(status.json().status, "done");
    const profile = await app.inject({ url: "/v1/players/euw1/Renamed/NEW" });
    assert.equal(profile.statusCode, 200);
    assert.equal(profile.json().summonerLevel, 101);
    const history = await app.inject({ url: "/v1/players/fixture-puuid/matches" });
    assert.deepEqual(history.json().map((m: { matchId: string }) => m.matchId), ["EUW1_2", original.match_id]);
    assert.deepEqual((await database.query("SELECT * FROM matches WHERE match_id=$1", [original.match_id])).rows[0], original);
  } finally { await app.close(); }
});

test("failed refresh keeps the previously cached profile and match history intact", async () => {
  await runMigrations(database);
  await seedPlayer();
  const before = (await database.query("SELECT * FROM players")).rows;
  const app = buildApp({}, database);
  try {
    const queued = await app.inject({ method: "POST", url: "/v1/players/fixture-puuid/refresh" });
    await processQueued({
      ...mockRiot(), getMatchIds: async () => ["EUW1_2", "EUW1_3"],
      getMatch: async (_region, id) => {
        if (id === "EUW1_3") throw new RiotError("RIOT_UNAVAILABLE", "Riot är tillfälligt otillgängligt", 503);
        return sampleMatch(id);
      },
    });
    assert.equal((await app.inject({ url: `/v1/jobs/${queued.json().jobId}` })).json().status, "failed");
    const after = (await database.query("SELECT * FROM players")).rows;
    assert.equal(after[0].last_fetched.getTime(), before[0].last_fetched.getTime());
    assert.equal((await database.query("SELECT * FROM matches")).rowCount, 1);
    assert.equal((await app.inject({ method: "POST", url: "/v1/players/fixture-puuid/refresh" })).statusCode, 429);
  } finally { await app.close(); }
});

test("a failed participant write rolls back new matches, profile and ranks together", async () => {
  await runMigrations(database);
  await enqueueLookup(database, { region: "euw1", gameName: "Example", tagLine: "EUW" });
  const broken = sampleMatch();
  broken.info.participants.push({ ...broken.info.participants[0] });
  await processQueued({ ...mockRiot(), getMatch: async () => broken });
  for (const table of ["players", "rank_entries", "matches", "match_participants"]) {
    assert.equal((await database.query(`SELECT * FROM ${table}`)).rowCount, 0);
  }
  assert.equal((await database.query("SELECT status FROM fetch_jobs")).rows[0].status, "failed");
});

test("mismatched match identity is rejected without persisting incorrect data", async () => {
  await runMigrations(database);
  await enqueueLookup(database, { region: "euw1", gameName: "Example", tagLine: "EUW" });
  await processQueued({ ...mockRiot(), getMatch: async () => sampleMatch("EUW1_wrong") });
  assert.equal((await database.query("SELECT * FROM matches")).rowCount, 0);
  assert.equal((await database.query("SELECT status FROM fetch_jobs")).rows[0].status, "failed");
});

test("refresh rejects unknown players, invalid identifiers and request bodies", async () => {
  await runMigrations(database);
  const app = buildApp({}, database);
  try {
    const missing = await app.inject({ method: "POST", url: "/v1/players/unknown/refresh" });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().error.code, "PLAYER_NOT_FOUND");
    assert.equal((await app.inject({ method: "POST", url: "/v1/players/%20/refresh" })).statusCode, 400);
    assert.equal((await app.inject({ method: "POST", url: "/v1/players/unknown/refresh", payload: {} })).statusCode, 400);
    assert.equal((await database.query("SELECT * FROM fetch_jobs")).rowCount, 0);
  } finally { await app.close(); }
});
