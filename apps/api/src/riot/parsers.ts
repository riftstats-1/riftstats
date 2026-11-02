import { invalidResponse } from "./errors.js";
import type { RiotAccount, RiotLeagueEntry, RiotMatch, RiotParticipant, RiotSummoner } from "./types.js";

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalidResponse();
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : invalidResponse();
}
function integer(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : invalidResponse();
}
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : invalidResponse(); }
// Riot documents that zero numeric fields may be omitted. Explicit null is invalid.
const zero = (value: unknown) => integer(value === undefined ? 0 : value);

export function parseAccount(value: unknown): RiotAccount {
  const data = record(value);
  return { puuid: text(data.puuid), gameName: text(data.gameName), tagLine: text(data.tagLine) };
}
export function parseSummoner(value: unknown): RiotSummoner {
  const data = record(value);
  return { profileIconId: zero(data.profileIconId), summonerLevel: zero(data.summonerLevel) };
}
export function parseLeagueEntries(value: unknown): RiotLeagueEntry[] {
  return array(value).map((entry) => {
    const data = record(entry);
    if (data.rank !== undefined && typeof data.rank !== "string") return invalidResponse();
    return {
      queueType: text(data.queueType), tier: text(data.tier), rank: data.rank ?? "",
      leaguePoints: zero(data.leaguePoints), wins: zero(data.wins), losses: zero(data.losses),
    };
  });
}
export function parseMatchIds(value: unknown): string[] { return array(value).map(text); }

export function parseMatch(value: unknown): RiotMatch {
  const data = record(value);
  const metadata = record(data.metadata);
  const info = record(data.info);
  const participants = array(info.participants).map((value): RiotParticipant => {
    const p = record(value);
    if (p.win !== undefined && typeof p.win !== "boolean") return invalidResponse();
    return {
      ...p, puuid: text(p.puuid), championId: integer(p.championId), championName: text(p.championName),
      teamId: integer(p.teamId), win: p.win === true,
      kills: zero(p.kills), deaths: zero(p.deaths), assists: zero(p.assists),
      totalMinionsKilled: zero(p.totalMinionsKilled), neutralMinionsKilled: zero(p.neutralMinionsKilled),
      item0: zero(p.item0), item1: zero(p.item1), item2: zero(p.item2), item3: zero(p.item3),
      item4: zero(p.item4), item5: zero(p.item5), item6: zero(p.item6),
    };
  });
  const gameStartTimestamp = integer(info.gameStartTimestamp ?? info.gameCreation);
  if (gameStartTimestamp > 8_640_000_000_000_000) return invalidResponse();
  return {
    ...data, metadata: { ...metadata, matchId: text(metadata.matchId) },
    info: {
      ...info, queueId: integer(info.queueId), gameStartTimestamp,
      gameDuration: integer(info.gameDuration), gameVersion: text(info.gameVersion), participants,
    },
  };
}
