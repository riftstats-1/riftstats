import { RiotError, invalidResponse } from "./errors.js";
import { rateFromEnv, RiotLimiter, wait } from "./limiter.js";
import { parseAccount, parseLeagueEntries, parseMatch, parseMatchIds, parseSummoner } from "./parsers.js";
import { pathSegment, platformRoute, regionalRoute } from "./routing.js";

function retryAfter(value: string | null): number {
  if (value !== null && value.trim()) {
    const seconds = Number(value);
    if (Number.isFinite(seconds)) {
      return seconds >= 0 && Number.isSafeInteger(Math.ceil(seconds * 1000))
        ? Math.max(1, Math.ceil(seconds * 1000)) : 1000;
    }
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(1, date - Date.now());
  }
  return 1000;
}

// An AbortSignal also rejects immediately while this request is queued.
async function abortable<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return task;
  let listener: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    listener = () => reject(signal.reason);
    signal.addEventListener("abort", listener, { once: true });
    if (signal.aborted) listener();
  });
  try { return await Promise.race([task, aborted]); }
  finally { signal.removeEventListener("abort", listener); }
}

export class RiotClient {
  #apiKey: string;
  #limiter: RiotLimiter;
  #tail: Promise<void> = Promise.resolve();

  constructor(options: { apiKey?: string } = {}) {
    const key = options.apiKey ?? process.env.RIOT_API_KEY;
    if (!key?.trim() || /[\r\n]/.test(key)) throw new TypeError("RIOT_API_KEY saknas eller är ogiltig");
    this.#apiKey = key.trim();
    this.#limiter = new RiotLimiter(rateFromEnv("RIOT_RATE_PER_SEC", 18), rateFromEnv("RIOT_RATE_PER_2MIN", 90));
  }

  async getAccountByRiotId(region: string, gameName: string, tagLine: string, signal?: AbortSignal) {
    return this.request(regionalRoute(region), `/riot/account/v1/accounts/by-riot-id/${pathSegment(gameName)}/${pathSegment(tagLine)}`, parseAccount, signal);
  }
  async getSummonerByPuuid(region: string, puuid: string, signal?: AbortSignal) {
    return this.request(platformRoute(region), `/lol/summoner/v4/summoners/by-puuid/${pathSegment(puuid)}`, parseSummoner, signal);
  }
  async getLeagueEntries(region: string, puuid: string, signal?: AbortSignal) {
    return this.request(platformRoute(region), `/lol/league/v4/entries/by-puuid/${pathSegment(puuid)}`, parseLeagueEntries, signal);
  }
  async getMatchIds(region: string, puuid: string, count = 20, signal?: AbortSignal) {
    if (!Number.isInteger(count) || count < 1 || count > 100) throw new TypeError("count måste vara 1–100");
    return this.request(regionalRoute(region), `/lol/match/v5/matches/by-puuid/${pathSegment(puuid)}/ids?start=0&count=${count}`, parseMatchIds, signal);
  }
  async getMatch(region: string, matchId: string, signal?: AbortSignal) {
    return this.request(regionalRoute(region), `/lol/match/v5/matches/${pathSegment(matchId)}`, parseMatch, signal);
  }

  private request<T>(host: string, path: string, parse: (value: unknown) => T, signal?: AbortSignal): Promise<T> {
    const task = this.#tail.then(() => this.run(`https://${host}.api.riotgames.com${path}`, parse, signal));
    this.#tail = task.then(() => {}, () => {});
    return abortable(task, signal);
  }

  private async run<T>(url: string, parse: (value: unknown) => T, signal?: AbortSignal): Promise<T> {
    let retries = 0;
    for (;;) {
      await this.#limiter.acquire(signal);
      try {
        return await this.attempt(url, parse, signal);
      } catch (error) {
        signal?.throwIfAborted();
        if (!(error instanceof RiotError)) throw error;
        if (error.code === "RIOT_RATE_LIMITED") {
          this.#limiter.defer(error.retryAfterMs ?? 1000);
          continue;
        }
        if (!["RIOT_UNAVAILABLE", "RIOT_TIMEOUT", "RIOT_NETWORK_ERROR"].includes(error.code) || retries >= 3) throw error;
        await wait(1000 * 2 ** retries++, signal);
      }
    }
  }

  private async attempt<T>(url: string, parse: (value: unknown) => T, signal?: AbortSignal): Promise<T> {
    const timeout = new AbortController();
    const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
    const timer = setTimeout(() => timeout.abort(), 10_000);
    try {
      let response: Response;
      try {
        response = await fetch(url, {
          headers: { "X-Riot-Token": this.#apiKey, Accept: "application/json" },
          redirect: "error", signal: combined,
        });
      } catch {
        throw new RiotError("RIOT_NETWORK_ERROR", "Riot kunde inte nås");
      }
      if (response.status !== 200) {
        await response.body?.cancel();
        const status = response.status;
        if (status === 429) throw new RiotError("RIOT_RATE_LIMITED", "Riot begär en paus", status, retryAfter(response.headers.get("Retry-After")));
        if (status === 401 || status === 403) throw new RiotError("RIOT_AUTH_ERROR", "Riot-nyckeln nekades eller endpointen är inte tillåten", status);
        if (status === 404) throw new RiotError("RIOT_NOT_FOUND", "Resursen hittades inte hos Riot", status);
        if (status >= 500) throw new RiotError("RIOT_UNAVAILABLE", "Riot är tillfälligt otillgängligt", status);
        throw new RiotError("RIOT_BAD_REQUEST", "Riot avvisade anropet", status);
      }
      let data: unknown;
      try { data = await response.json(); }
      catch { return invalidResponse(); }
      return parse(data);
    } catch (error) {
      signal?.throwIfAborted();
      if (timeout.signal.aborted) throw new RiotError("RIOT_TIMEOUT", "Riot-anropet tog för lång tid");
      if (error instanceof RiotError) throw error;
      throw new RiotError("RIOT_NETWORK_ERROR", "Riot kunde inte nås");
    } finally {
      clearTimeout(timer);
    }
  }
}
