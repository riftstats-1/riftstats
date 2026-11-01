// The contract between the app and the API (see README: API).
// The backend must respond with exactly these fields.

export type Region = "euw1" | "eun1" | "na1" | "kr";

export type QueueType = "RANKED_SOLO_5x5" | "RANKED_FLEX_SR";

export interface RankEntry {
  queueType: QueueType;
  tier: string; // "GOLD", "MASTER" ...
  rank: string; // "I" to "IV", empty for Master and above
  lp: number;
  wins: number;
  losses: number;
}

export interface PlayerProfile {
  puuid: string;
  gameName: string;
  tagLine: string;
  region: Region;
  profileIconId: number;
  summonerLevel: number;
  ranks: RankEntry[];
  lastFetched: string; // ISO date
}

export interface MatchSummary {
  matchId: string;
  queueId: number;
  gameStart: string; // ISO date
  durationS: number;
  championName: string; // Data Dragon id, e.g. "LeeSin"
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  items: number[]; // item ids, 0 = empty slot
}

export type LookupResult =
  | { kind: "found"; profile: PlayerProfile }
  | { kind: "queued"; jobId: number };

export type JobStatus = "pending" | "running" | "done" | "failed";

export interface Job {
  id: number;
  status: JobStatus;
  error?: string;
}
