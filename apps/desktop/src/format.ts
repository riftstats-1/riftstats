import type { MatchSummary, QueueType, RankEntry } from "./types";

const QUEUE_NAMES: Record<number, string> = {
  400: "Normal Draft",
  420: "Ranked Solo/Duo",
  430: "Normal Blind",
  440: "Ranked Flex",
  450: "ARAM",
  490: "Quickplay",
  1700: "Arena",
  1900: "URF",
};

export function queueName(queueId: number): string {
  return QUEUE_NAMES[queueId] ?? "Other";
}

export function rankQueueName(queueType: QueueType): string {
  return queueType === "RANKED_SOLO_5x5" ? "Solo/Duo" : "Flex";
}

const APEX_TIERS = new Set(["MASTER", "GRANDMASTER", "CHALLENGER"]);

/** "GOLD", "II" → "Gold II". Master and above have no division. */
export function tierLabel(entry: Pick<RankEntry, "tier" | "rank">): string {
  const tier = entry.tier.charAt(0) + entry.tier.slice(1).toLowerCase();
  return APEX_TIERS.has(entry.tier) ? tier : `${tier} ${entry.rank}`;
}

export function winrate(wins: number, losses: number): number {
  const total = wins + losses;
  return total === 0 ? 0 : Math.round((wins / total) * 100);
}

/** (K + A) / D with one decimal. Zero deaths is shown as "Perfect". */
export function kdaRatio(m: Pick<MatchSummary, "kills" | "deaths" | "assists">): string {
  if (m.deaths === 0) return "Perfect";
  return ((m.kills + m.assists) / m.deaths).toFixed(2);
}

export type Quality = "poor" | "common" | "uncommon" | "rare" | "epic" | "legendary";

export const QUALITY_LABELS: Record<Quality, string> = {
  poor: "Poor",
  common: "Common",
  uncommon: "Uncommon",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};

/** A match performance as loot quality, based on KDA. */
export function kdaQuality(m: Pick<MatchSummary, "kills" | "deaths" | "assists">): Quality {
  if (m.deaths === 0) return m.kills + m.assists >= 5 ? "legendary" : "epic";
  const ratio = (m.kills + m.assists) / m.deaths;
  if (ratio >= 8) return "legendary";
  if (ratio >= 5) return "epic";
  if (ratio >= 3.5) return "rare";
  if (ratio >= 2.5) return "uncommon";
  if (ratio >= 1.5) return "common";
  return "poor";
}

export function csPerMinute(cs: number, durationS: number): string {
  if (durationS <= 0) return "0.0";
  return (cs / (durationS / 60)).toFixed(1);
}

/** 1934 → "32:14" */
export function formatDuration(durationS: number): string {
  const minutes = Math.floor(durationS / 60);
  const seconds = Math.floor(durationS % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "3 hours ago", "yesterday" ... */
export function timeAgo(iso: string, now = Date.now()): string {
  const diffS = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(diffS);
  if (abs < 60) return "just now";
  if (abs < 3600) return relative.format(Math.round(diffS / 60), "minute");
  if (abs < 86400) return relative.format(Math.round(diffS / 3600), "hour");
  if (abs < 86400 * 30) return relative.format(Math.round(diffS / 86400), "day");
  return relative.format(Math.round(diffS / (86400 * 30)), "month");
}

/** "Name#TAG" → { gameName, tagLine }, or null if the format is wrong. */
export function parseRiotId(input: string): { gameName: string; tagLine: string } | null {
  const trimmed = input.trim();
  const hash = trimmed.lastIndexOf("#");
  if (hash <= 0 || hash === trimmed.length - 1) return null;
  const gameName = trimmed.slice(0, hash).trim();
  const tagLine = trimmed.slice(hash + 1).trim();
  if (!gameName || !tagLine) return null;
  return { gameName, tagLine };
}
