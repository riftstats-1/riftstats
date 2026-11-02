import type { Pool, PoolClient } from "pg";
import { claimJob, lookupPayload } from "./jobs.js";
import { savePlayer } from "./players.js";
import type { RiotClient } from "./riot/client.js";
import { RiotError } from "./riot/errors.js";
import { wait } from "./riot/limiter.js";
import { toPlayerProfile } from "./riot/mappers.js";

type LookupRiot = Pick<RiotClient, "getAccountByRiotId" | "getSummonerByPuuid" | "getLeagueEntries">;
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
    if (job.kind !== "lookup") throw new Error("Unsupported job kind");
    const payload = lookupPayload(job.payload);
    const account = await riot.getAccountByRiotId(payload.region, payload.gameName, payload.tagLine, signal);
    const summoner = await riot.getSummonerByPuuid(payload.region, account.puuid, signal);
    const entries = await riot.getLeagueEntries(payload.region, account.puuid, signal);
    const profile = toPlayerProfile(account, summoner, entries, payload.region);
    signal.throwIfAborted();
    await client.query("BEGIN");
    try {
      await savePlayer(client, profile);
      await client.query("UPDATE fetch_jobs SET status='done', error=NULL, updated_at=now() WHERE id=$1", [job.id]);
      signal.throwIfAborted();
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    log.info({ jobId: job.id }, "Spelarprofil sparad och jobb klart");
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
