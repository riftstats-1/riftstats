import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RiotClient } from "../src/riot/client.js";
import { regionalRoute } from "../src/riot/routing.js";
import { toMatchSummary, toPlayerProfile } from "../src/riot/mappers.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/riot.json", import.meta.url), "utf8"));
const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
const fetchMock = vi.fn<typeof fetch>();
const client = () => new RiotClient({ apiKey: "test-key-not-real" });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset().mockImplementation(async () => json(fixture.account));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Riot endpoints and desktop mapping", () => {
  it.each([["euw1", "europe"], ["eun1", "europe"], ["na1", "americas"], ["kr", "asia"]])(
    "%s routes to %s", (region, expected) => { expect(regionalRoute(region)).toBe(expected); },
  );

  it("encodes Riot ID segments and sends the key only in the header", async () => {
    await client().getAccountByRiotId("euw1", "Name / å", "#EUW");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/Name%20%2F%20%C3%A5/%23EUW");
    expect(init?.headers).toMatchObject({ "X-Riot-Token": "test-key-not-real" });
    expect(init?.redirect).toBe("error");
    expect(JSON.stringify(client())).not.toContain("test-key-not-real");
  });

  it("uses platform routing for summoner/league and regional routing for matches", async () => {
    const riot = client();
    fetchMock.mockResolvedValueOnce(json(fixture.summoner))
      .mockResolvedValueOnce(json(fixture.leagueEntries))
      .mockResolvedValueOnce(json(fixture.matchIds))
      .mockResolvedValueOnce(json(fixture.match));
    const requests = (async () => {
      await riot.getSummonerByPuuid("na1", "fixture-puuid");
      await riot.getLeagueEntries("na1", "fixture-puuid");
      await riot.getMatchIds("na1", "fixture-puuid", 20);
      await riot.getMatch("na1", "NA1_123");
    })();
    await vi.runAllTimersAsync();
    await requests;
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://na1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/fixture-puuid",
      "https://na1.api.riotgames.com/lol/league/v4/entries/by-puuid/fixture-puuid",
      "https://americas.api.riotgames.com/lol/match/v5/matches/by-puuid/fixture-puuid/ids?start=0&count=20",
      "https://americas.api.riotgames.com/lol/match/v5/matches/NA1_123",
    ]);
  });

  it("looks up renamed Riot accounts by PUUID on regional routing", async () => {
    const result = await client().getAccountByPuuid("eun1", "id/with+symbols");
    expect(result).toEqual(fixture.account);
    expect(fetchMock.mock.calls[0][0]).toBe("https://europe.api.riotgames.com/riot/account/v1/accounts/by-puuid/id%2Fwith%2Bsymbols");
  });

  it("maps Riot data to the exact desktop profile and match fields", async () => {
    const riot = client();
    fetchMock.mockResolvedValueOnce(json(fixture.account)).mockResolvedValueOnce(json(fixture.summoner))
      .mockResolvedValueOnce(json(fixture.leagueEntries)).mockResolvedValueOnce(json(fixture.match));
    const result = (async () => {
      const account = await riot.getAccountByRiotId("euw1", "Example", "EUW");
      const summoner = await riot.getSummonerByPuuid("euw1", account.puuid);
      const ranks = await riot.getLeagueEntries("euw1", account.puuid);
      const match = await riot.getMatch("euw1", fixture.match.metadata.matchId);
      return { profile: toPlayerProfile(account, summoner, ranks, "euw1", "2026-11-01T12:00:00.000Z"), match: toMatchSummary(match, account.puuid) };
    })();
    await vi.runAllTimersAsync();
    const mapped = await result;
    expect(mapped.profile).toEqual({
      puuid: "fixture-puuid", gameName: "Example", tagLine: "EUW", region: "euw1", profileIconId: 123,
      summonerLevel: 100, ranks: [{ queueType: "RANKED_SOLO_5x5", tier: "GOLD", rank: "II", lp: 50, wins: 30, losses: 20 }],
      lastFetched: "2026-11-01T12:00:00.000Z",
    });
    expect(mapped.match).toEqual({
      matchId: "EUW1_1234567890", queueId: 420, gameStart: new Date(fixture.match.info.gameStartTimestamp).toISOString(),
      durationS: 1800, championName: "Ahri", win: true, kills: 10, deaths: 2, assists: 8, cs: 200,
      items: [3031, 3006, 0, 0, 0, 0, 3340],
    });
  });

  it("rejects bad regions, empty path segments and invalid counts before fetching", async () => {
    expect(() => regionalRoute("http://localhost")).toThrow();
    const riot = client();
    await expect(riot.getAccountByRiotId("euw1", "", "EUW")).rejects.toThrow();
    await expect(riot.getMatchIds("euw1", "id", 101)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed upstream JSON without exposing its content", async () => {
    fetchMock.mockResolvedValue(json({ puuid: 123, secret: "private-value" }));
    await expect(client().getAccountByRiotId("euw1", "Example", "EUW")).rejects.toMatchObject({ code: "RIOT_INVALID_RESPONSE" });
  });

  it("maps omitted zero stats and Master ranks to desktop expectations", async () => {
    fetchMock.mockResolvedValue(json([{ queueType: "RANKED_SOLO_5x5", tier: "MASTER", rank: "I" }]));
    const entries = await client().getLeagueEntries("euw1", "fixture-puuid");
    const profile = toPlayerProfile(fixture.account, fixture.summoner, entries, "euw1");
    expect(profile.ranks).toEqual([{ queueType: "RANKED_SOLO_5x5", tier: "MASTER", rank: "", lp: 0, wins: 0, losses: 0 }]);
    expect(toPlayerProfile(fixture.account, fixture.summoner, [], "euw1").ranks).toEqual([]);
  });

  it("preserves raw match data but emits only desktop match fields", async () => {
    const source = structuredClone(fixture.match);
    source.info.extraField = { preserved: true };
    delete source.info.participants[0].kills;
    delete source.info.participants[0].item2;
    fetchMock.mockResolvedValue(json(source));
    const match = await client().getMatch("euw1", "EUW1_1234567890");
    expect(match.info.extraField).toEqual({ preserved: true });
    expect(toMatchSummary(match, "fixture-puuid").kills).toBe(0);
    expect(toMatchSummary(match, "fixture-puuid").items[2]).toBe(0);
    expect(() => toMatchSummary(match, "not-in-match")).toThrow();
  });

  it.each([null, { puuid: null }, ["bad"], { puuid: "x", gameName: "x", tagLine: 1 }])(
    "validates untrusted account response %j", async (body) => {
      fetchMock.mockResolvedValue(json(body));
      await expect(client().getAccountByRiotId("euw1", "Example", "EUW")).rejects.toMatchObject({ code: "RIOT_INVALID_RESPONSE" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
});

describe("rate limits with a controlled clock", () => {
  it("limits concurrent callers to 18 requests in every second", async () => {
    const times: number[] = [];
    fetchMock.mockImplementation(async () => { times.push(Date.now()); return json(fixture.account); });
    const riot = client();
    const pending = Promise.all(Array.from({ length: 19 }, () => riot.getAccountByRiotId("euw1", "Example", "EUW")));
    await vi.advanceTimersByTimeAsync(999);
    expect(times).toHaveLength(18);
    await vi.runAllTimersAsync();
    await pending;
    expect(times[18] - times[0]).toBeGreaterThanOrEqual(1000);
  });

  it("limits the 91st request across all hosts until the two-minute window allows it", async () => {
    const times: number[] = [];
    fetchMock.mockImplementation(async () => { times.push(Date.now()); return json(fixture.account); });
    const riot = client();
    const pending = Promise.all(Array.from({ length: 91 }, (_, i) => riot.getAccountByRiotId(i % 2 ? "euw1" : "kr", "Example", "TAG")));
    await vi.advanceTimersByTimeAsync(119999);
    expect(times).toHaveLength(90);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(times[90]).toBe(120000);
  });

  it("honors lower configured limits and rejects unsafe configuration", async () => {
    vi.stubEnv("RIOT_RATE_PER_SEC", "1");
    vi.stubEnv("RIOT_RATE_PER_2MIN", "2");
    const riot = client();
    const pending = Promise.all(Array.from({ length: 3 }, () => riot.getAccountByRiotId("euw1", "Example", "EUW")));
    await vi.advanceTimersByTimeAsync(119999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.runAllTimersAsync();
    await pending;
    vi.stubEnv("RIOT_RATE_PER_SEC", "19");
    expect(client).toThrow();
  });
});

describe("retry, timeout and cancellation", () => {
  it("pauses repeated 429 responses and queued callers according to Retry-After", async () => {
    const times: number[] = [];
    fetchMock.mockImplementation(async () => {
      times.push(Date.now());
      return times.length < 3 ? new Response("not JSON", { status: 429, headers: { "Retry-After": "2" } }) : json(fixture.account);
    });
    const riot = client();
    const pending = Promise.all([riot.getAccountByRiotId("euw1", "Example", "EUW"), riot.getAccountByRiotId("euw1", "Other", "EUW")]);
    await vi.advanceTimersByTimeAsync(1999);
    expect(times).toEqual([0]);
    await vi.advanceTimersByTimeAsync(2001);
    expect(times).toEqual([0, 2000, 4000]);
    await vi.runAllTimersAsync();
    await pending;
    expect(times[3]).toBeGreaterThanOrEqual(4056);
  });

  it.each(["invalid", "-1", null])("uses a safe wait for Retry-After=%s", async (header) => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 429, headers: header === null ? {} : { "Retry-After": header } }));
    const pending = client().getAccountByRiotId("euw1", "Example", "EUW");
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("accepts an HTTP-date Retry-After header", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": new Date(5000).toUTCString() } }));
    const pending = client().getAccountByRiotId("euw1", "Example", "EUW");
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
  });

  it("retries 5xx only three times with exponential backoff", async () => {
    const times: number[] = [];
    fetchMock.mockImplementation(async () => { times.push(Date.now()); return new Response(null, { status: 503 }); });
    const result = expect(client().getAccountByRiotId("euw1", "Example", "EUW")).rejects.toMatchObject({ code: "RIOT_UNAVAILABLE", status: 503 });
    await vi.runAllTimersAsync();
    await result;
    expect(times).toEqual([0, 1000, 3000, 7000]);
  });

  it.each([401, 403, 404, 400])("does not retry permanent HTTP %s errors or expose response text", async (status) => {
    fetchMock.mockResolvedValue(new Response("test-key-not-real private-upstream-text", { status }));
    const error = await client().getAccountByRiotId("euw1", "Example", "EUW").catch((e: Error) => e);
    expect(error).toMatchObject({ status });
    expect(String(error)).not.toMatch(/test-key-not-real|private-upstream-text/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries network errors with a bounded attempt count", async () => {
    fetchMock.mockRejectedValue(new TypeError("sensitive network details"));
    const result = expect(client().getAccountByRiotId("euw1", "Example", "EUW")).rejects.toMatchObject({ code: "RIOT_NETWORK_ERROR" });
    await vi.runAllTimersAsync();
    await result;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("times out stalled fetches including their body and can be aborted", async () => {
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    const result = expect(client().getAccountByRiotId("euw1", "Example", "EUW")).rejects.toMatchObject({ code: "RIOT_TIMEOUT" });
    await vi.runAllTimersAsync();
    await result;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("also times out when headers arrive but the response body stalls", async () => {
    fetchMock.mockImplementation(async (_url, init) => new Response(new ReadableStream({
      start(controller) {
        init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), { once: true });
      },
    })));
    const result = expect(client().getAccountByRiotId("euw1", "Example", "EUW")).rejects.toMatchObject({ code: "RIOT_TIMEOUT" });
    await vi.runAllTimersAsync();
    await result;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("aborts a queued request promptly without sending it or poisoning the queue", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "60" } }));
    const riot = client();
    const firstController = new AbortController();
    const queuedController = new AbortController();
    const first = expect(riot.getAccountByRiotId("euw1", "Example", "EUW", firstController.signal)).rejects.toMatchObject({ name: "AbortError" });
    const queued = expect(riot.getAccountByRiotId("euw1", "Other", "EUW", queuedController.signal)).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(1);
    queuedController.abort();
    await queued;
    firstController.abort();
    await first;
    const after = riot.getAccountByRiotId("euw1", "After", "EUW");
    await vi.runAllTimersAsync();
    await after;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
