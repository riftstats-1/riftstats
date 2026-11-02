import type { PoolClient } from "pg";
import { queryRows, type Database } from "./db.js";
import { HttpError } from "./errors.js";
import type { MatchSummary, RiotMatch } from "./riot/types.js";

export async function missingMatchIds(database: Database, ids: string[]): Promise<string[]> {
  const saved = await queryRows<{ match_id: string }>(database,
    "SELECT match_id FROM matches WHERE match_id = ANY($1::text[])", [ids]);
  const known = new Set(saved.map((row) => row.match_id));
  return [...new Set(ids)].filter((id) => !known.has(id));
}

// Runs inside the profile/job transaction. Completed matches are immutable.
export async function saveMatches(client: PoolClient, matches: RiotMatch[]): Promise<void> {
  for (const match of matches) {
    const info = match.info;
    const inserted = await client.query(`INSERT INTO matches(match_id, queue_id, game_start, duration_s, patch, raw)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(match_id) DO NOTHING RETURNING match_id`, [
      match.metadata.matchId, info.queueId, new Date(info.gameStartTimestamp), info.gameDuration,
      info.gameVersion, JSON.stringify(match),
    ]);
    if (inserted.rowCount === 0) continue;
    for (const p of info.participants) {
      await client.query(`INSERT INTO match_participants(
        match_id,puuid,champion_id,champion_name,team_id,win,kills,deaths,assists,cs,gold,damage,items
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [
        match.metadata.matchId, p.puuid, p.championId, p.championName, p.teamId, p.win,
        p.kills, p.deaths, p.assists, p.totalMinionsKilled + p.neutralMinionsKilled,
        p.goldEarned, p.totalDamageDealtToChampions,
        [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6],
      ]);
    }
  }
}

export async function getMatches(database: Database, puuid: string, limit: number): Promise<MatchSummary[]> {
  const exists = await queryRows(database, "SELECT 1 FROM players WHERE puuid=$1", [puuid]);
  if (exists.length === 0) throw new HttpError(404, "PLAYER_NOT_FOUND", "Spelaren hittades inte");
  const rows = await queryRows<Omit<MatchSummary, "gameStart"> & { gameStart: Date }>(database, `
    SELECT m.match_id AS "matchId", m.queue_id AS "queueId", m.game_start AS "gameStart",
      m.duration_s AS "durationS", p.champion_name AS "championName", p.win, p.kills,
      p.deaths, p.assists, p.cs, p.items
    FROM match_participants p JOIN matches m ON m.match_id=p.match_id
    WHERE p.puuid=$1 AND p.champion_name IS NOT NULL AND m.game_start IS NOT NULL
    ORDER BY m.game_start DESC, m.match_id DESC LIMIT $2`, [puuid, limit]);
  return rows.map((row) => ({ ...row, gameStart: row.gameStart.toISOString() }));
}
