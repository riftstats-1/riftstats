import type { Pool, PoolClient } from "pg";
import { claimJob, lookupPayload } from "./jobs.js";
import { playerIdentity, savePlayer } from "./players.js";
import { missingMatchIds, saveMatches } from "./matches.js";
import type { RiotClient } from "./riot/client.js";
import { invalidResponse, RiotError } from "./riot/errors.js";
import { wait } from "./riot/limiter.js";
import { toPlayerProfile } from "./riot/mappers.js";
import type { RiotAccount, RiotMatch } from "./riot/types.js";
import type { Region } from "./riot/routing.js";

type LookupRiot = Pick<RiotClient, "getAccountByRiotId" | "getAccountByPuuid" | "getSummonerByPuuid" | "getLeagueEntries" | "getMatchIds" | "getMatch">;
interface FetchLogger {
  info: (fields: Record<string, unknown>, message: string) => void;
  error: (fields: Record<string, unknown>, message: string) => void;
}
const quiet: FetchLogger = { info() {}, error() {} };

function safeJobError(error: unknown): string {
  if (error instanceof RiotError) {
    if (error.code === "RIOT_NOT_FOUND") return "Riot ID hittades inte";
    return error.message;
  }
  return "Jobbet kunde inte slutföras";
}

export async function processNextJob(client: PoolClient, riot: LookupRiot, signal: AbortSignal, log: FetchLogger = quiet): Promise<boolean> {
  signal.throwIfAborted();
  const job = await claimJob(client);
  if (!job) return false;
  log.info({ jobId: job.id, attempts: job.attempts }, "Hämtar spelarprofil från Riot");
  try {
    signal.throwIfAborted();
    let identity: RiotAccount & { region: Region };
    if (job.kind === "lookup") {
      const payload = lookupPayload(job.payload);
      const account = await riot.getAccountByRiotId(payload.region, payload.gameName, payload.tagLine, signal);
      identity = { ...account, region: payload.region };
    } else if (job.kind === "refresh") {
      const payload = job.payload;
      if (typeof payload !== "object" || payload === null || !("puuid" in payload) || typeof payload.puuid !== "string") return invalidResponse();
      const player = await playerIdentity(client, payload.puuid);
      if (!player) throw new RiotError("RIOT_NOT_FOUND", "Spelaren hittades inte", 404);
      const account = await riot.getAccountByPuuid(player.region, player.puuid, signal);
      if (account.puuid !== player.puuid) return invalidResponse();
      identity = { ...account, region: player.region };
    } else { throw new Error("Unsupported job kind"); }
    const summoner = await riot.getSummonerByPuuid(identity.region, identity.puuid, signal);
    const entries = await riot.getLeagueEntries(identity.region, identity.puuid, signal);
    const profile = toPlayerProfile(identity, summoner, entries, identity.region);
    const ids = await riot.getMatchIds(identity.region, identity.puuid, 20, signal);
    const missing = await missingMatchIds(client, ids);
    const matches: RiotMatch[] = [];
    for (const id of missing) {
      signal.throwIfAborted();
      const match = await riot.getMatch(identity.region, id, signal);
      if (match.metadata.matchId !== id || !match.info.participants.some((p) => p.puuid === identity.puuid)) return invalidResponse();
      matches.push(match);
    }
    signal.throwIfAborted();
    await client.query("BEGIN");
    try {
      await savePlayer(client, profile);
      await saveMatches(client, matches);
      await client.query("UPDATE fetch_jobs SET status='done', error=NULL, updated_at=now() WHERE id=$1", [job.id]);
      signal.throwIfAborted();
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    log.info({ jobId: job.id, newMatches: matches.length }, "Spelarprofil och matchhistorik sparade");
  } catch (error) {
    if (signal.aborted) {
      await client.query(`UPDATE fetch_jobs SET status=CASE WHEN attempts < 3 THEN 'pending' ELSE 'failed' END,
        error=CASE WHEN attempts < 3 THEN NULL ELSE 'Jobbet avbröts upprepade gånger' END, updated_at=now() WHERE id=$1 AND status='running'`, [job.id]);
      throw signal.reason;
    }
    await client.query("UPDATE fetch_jobs SET status='failed', error=$2, updated_at=now() WHERE id=$1", [job.id, safeJobError(error)]);
    log.error({ jobId: job.id, code: error instanceof RiotError ? error.code : "JOB_FAILED" }, "Fetch-jobb misslyckades");
  }
  return true;
}

export async function runFetcher(database: Pool, riot: LookupRiot, signal: AbortSignal, log: FetchLogger = quiet): Promise<void> {
  if (signal.aborted) return;
  const client = await database.connect();
  const connectionLost = new AbortController();
  const onError = () => connectionLost.abort();
  client.on("error", onError);
  const combined = AbortSignal.any([signal, connectionLost.signal]);
  try {
    const lock = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock(8241, 2) AS acquired");
    if (!lock.rows[0].acquired) throw new Error("En annan fetcher kör redan mot databasen");
    await client.query(`UPDATE fetch_jobs SET
      status=CASE WHEN attempts < 3 THEN 'pending' ELSE 'failed' END,
      error=CASE WHEN attempts < 3 THEN NULL ELSE 'Jobbet avbröts upprepade gånger' END,
      updated_at=now() WHERE status='running'`);
    log.info({}, "Fetcher startad");
    while (!combined.aborted) {
      const processed = await processNextJob(client, riot, combined, log);
      if (!processed) await wait(1000, combined);
    }
  } catch (error) {
    if (!signal.aborted || connectionLost.signal.aborted) throw error;
  } finally {
    client.removeListener("error", onError);
    // Destroying the dedicated session also releases the singleton advisory lock.
    client.release(true);
  }
}
