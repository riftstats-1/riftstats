// Made-up data in the same shape as the API, so the app can be built before the backend is ready.
import { ApiError } from "./errors";
import { ladderScore, rankFromScore } from "./format";
import type { Job, LookupResult, LpPoint, MatchSummary, PlayerProfile, RankEntry, Region } from "./types";

const CHAMPIONS = [
  "Ahri", "Jinx", "LeeSin", "Thresh", "Yasuo", "Lux",
  "Ezreal", "Darius", "Akali", "Viego", "Orianna", "Garen",
];
const ITEMS = [
  3031, 3006, 3094, 3046, 3036, 3157, 3089, 3020, 3135, 3071, 3053, 3047, 6333,
];
const QUEUES = [420, 420, 420, 440, 450];

// Deterministic randomness, so the same player always gets the same data.
function seeded(seedText: string) {
  let seed = 0;
  for (const ch of seedText) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fetched = new Set<string>();
const jobs = new Map<number, { key: string; readyAt: number }>();
let nextJobId = 1;

export async function lookupPlayer(
  region: Region,
  gameName: string,
  tagLine: string,
): Promise<LookupResult> {
  await delay(300);
  if (gameName.toLowerCase() === "notfound") {
    throw new ApiError("PLAYER_NOT_FOUND", "Riot ID not found.", 404);
  }

  const key = `${region}/${gameName}/${tagLine}`.toLowerCase();
  if (!fetched.has(key)) {
    const id = nextJobId++;
    jobs.set(id, { key, readyAt: Date.now() + 2500 });
    return { kind: "queued", jobId: id };
  }

  const rand = seeded(key);
  const soloWins = 40 + Math.floor(rand() * 80);
  const soloLosses = 40 + Math.floor(rand() * 70);
  const profile: PlayerProfile = {
    puuid: `mock-${key}`,
    gameName,
    tagLine,
    region,
    profileIconId: 4000 + Math.floor(rand() * 900),
    summonerLevel: 30 + Math.floor(rand() * 500),
    ranks: [
      {
        queueType: "RANKED_SOLO_5x5",
        tier: ["SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND"][Math.floor(rand() * 5)],
        rank: ["I", "II", "III", "IV"][Math.floor(rand() * 4)],
        lp: Math.floor(rand() * 100),
        wins: soloWins,
        losses: soloLosses,
      },
      {
        queueType: "RANKED_FLEX_SR",
        tier: "GOLD",
        rank: "II",
        lp: Math.floor(rand() * 100),
        wins: 12,
        losses: 9,
      },
    ],
    lastFetched: new Date().toISOString(),
  };
  profile.ranks[0].history = mockHistory(profile.ranks[0], rand);
  return { kind: "found", profile };
}

export async function getJob(jobId: number): Promise<Job> {
  await delay(150);
  const job = jobs.get(jobId);
  if (!job) throw new ApiError("JOB_NOT_FOUND", "Job not found.", 404);
  if (Date.now() >= job.readyAt) {
    fetched.add(job.key);
    return { id: jobId, status: "done" };
  }
  return { id: jobId, status: "running" };
}

export async function getMatches(
  puuid: string,
  limit: number,
): Promise<MatchSummary[]> {
  await delay(250);
  const rand = seeded(puuid);
  let time = Date.now() - 40 * 60_000;

  return Array.from({ length: limit }, (_, i) => {
    const durationS = 1200 + Math.floor(rand() * 1100);
    const win = rand() > 0.45;
    const items = Array.from({ length: 7 }, (_, slot) =>
      slot < 5 + Math.floor(rand() * 2) ? ITEMS[Math.floor(rand() * ITEMS.length)] : 0,
    );
    const match: MatchSummary = {
      matchId: `EUW1_${7000000000 + i}`,
      queueId: QUEUES[Math.floor(rand() * QUEUES.length)],
      gameStart: new Date(time - durationS * 1000).toISOString(),
      durationS,
      championName: CHAMPIONS[Math.floor(rand() * CHAMPIONS.length)],
      win,
      kills: Math.floor(rand() * (win ? 14 : 8)),
      deaths: Math.floor(rand() * (win ? 6 : 11)),
      assists: Math.floor(rand() * 16),
      cs: Math.floor((durationS / 60) * (4 + rand() * 5)),
      items,
    };
    time -= durationS * 1000 + Math.floor(rand() * 3) * 3_600_000;
    return match;
  });
}

export async function refreshPlayer(puuid: string): Promise<number> {
  await delay(200);
  const id = nextJobId++;
  jobs.set(id, { key: puuid.replace(/^mock-/, ""), readyAt: Date.now() + 1500 });
  return id;
}

// A random walk of LP that ends at the player's current rank, one point per ranked game.
function mockHistory(entry: RankEntry, rand: () => number): LpPoint[] {
  const points: LpPoint[] = [];
  let score = ladderScore(entry);
  let time = Date.now();
  for (let i = 0; i < 16; i++) {
    points.unshift({ recordedAt: new Date(time).toISOString(), ...rankFromScore(score) });
    score -= rand() > 0.45 ? 18 + Math.floor(rand() * 8) : -(16 + Math.floor(rand() * 8));
    time -= (3 + Math.floor(rand() * 20)) * 3_600_000;
  }
  return points;
}
