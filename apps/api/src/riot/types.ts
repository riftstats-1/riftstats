import type { Region } from "./routing.js";

export interface RiotAccount { puuid: string; gameName: string; tagLine: string }
export interface RiotSummoner { profileIconId: number; summonerLevel: number }
export interface RiotLeagueEntry {
  queueType: string; tier: string; rank: string; leaguePoints: number; wins: number; losses: number;
}
export interface RiotParticipant extends Record<string, unknown> {
  puuid: string; championId: number; championName: string; teamId: number; win: boolean;
  kills: number; deaths: number; assists: number; totalMinionsKilled: number; neutralMinionsKilled: number;
  goldEarned: number; totalDamageDealtToChampions: number;
  item0: number; item1: number; item2: number; item3: number; item4: number; item5: number; item6: number;
}
export interface RiotMatch extends Record<string, unknown> {
  metadata: { matchId: string; [key: string]: unknown };
  info: {
    queueId: number; gameStartTimestamp: number; gameDuration: number; gameVersion: string;
    participants: RiotParticipant[]; [key: string]: unknown;
  };
}

// These output fields match apps/desktop/src/types.ts on branch desktop.
export interface RankEntry {
  queueType: "RANKED_SOLO_5x5" | "RANKED_FLEX_SR";
  tier: string; rank: string; lp: number; wins: number; losses: number;
}
export interface PlayerProfile extends RiotAccount {
  region: Region; profileIconId: number; summonerLevel: number; ranks: RankEntry[]; lastFetched: string;
}
export interface MatchSummary {
  matchId: string; queueId: number; gameStart: string; durationS: number; championName: string;
  win: boolean; kills: number; deaths: number; assists: number; cs: number; items: number[];
}
