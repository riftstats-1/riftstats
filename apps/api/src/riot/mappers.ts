import { invalidResponse } from "./errors.js";
import type { Region } from "./routing.js";
import type { MatchSummary, PlayerProfile, RankEntry, RiotAccount, RiotLeagueEntry, RiotMatch, RiotSummoner } from "./types.js";

export function toPlayerProfile(
  account: RiotAccount, summoner: RiotSummoner, entries: RiotLeagueEntry[], region: Region,
  lastFetched = new Date().toISOString(),
): PlayerProfile {
  const ranks: RankEntry[] = [];
  for (const entry of entries) {
    if (entry.queueType !== "RANKED_SOLO_5x5" && entry.queueType !== "RANKED_FLEX_SR") continue;
    const rank = ["MASTER", "GRANDMASTER", "CHALLENGER"].includes(entry.tier) ? "" : entry.rank;
    ranks.push({ queueType: entry.queueType, tier: entry.tier, rank, lp: entry.leaguePoints, wins: entry.wins, losses: entry.losses });
  }
  return {
    puuid: account.puuid, gameName: account.gameName, tagLine: account.tagLine, region,
    profileIconId: summoner.profileIconId, summonerLevel: summoner.summonerLevel, ranks, lastFetched,
  };
}

export function toMatchSummary(match: RiotMatch, puuid: string): MatchSummary {
  const p = match.info.participants.find((participant) => participant.puuid === puuid);
  if (!p) return invalidResponse();
  return {
    matchId: match.metadata.matchId, queueId: match.info.queueId,
    gameStart: new Date(match.info.gameStartTimestamp).toISOString(), durationS: match.info.gameDuration,
    championName: p.championName, win: p.win, kills: p.kills, deaths: p.deaths, assists: p.assists,
    cs: p.totalMinionsKilled + p.neutralMinionsKilled,
    items: [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6],
  };
}
