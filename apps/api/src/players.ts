import type { PoolClient } from "pg";
import { queryRows, type Database } from "./db.js";
import type { LookupPayload } from "./jobs.js";
import type { PlayerProfile } from "./riot/types.js";

// The latest LP snapshots for one rank entry, oldest first, as the desktop LP graph expects.
const HISTORY_LIMIT = 20;
const HISTORY_SQL = `
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'recordedAt', to_char(h.recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'tier', h.tier, 'rank', h.rank, 'lp', h.lp
  ) ORDER BY h.recorded_at, h.id), '[]'::jsonb)
  FROM (
    SELECT id, tier, rank, lp, recorded_at FROM rank_history
    WHERE puuid = r.puuid AND queue_type = r.queue_type
    ORDER BY recorded_at DESC, id DESC
    LIMIT ${HISTORY_LIMIT}
  ) h`;

export async function getPlayer(database: Database, lookup: LookupPayload): Promise<PlayerProfile | undefined> {
  const [row] = await queryRows<Omit<PlayerProfile, "lastFetched"> & { lastFetched: Date }>(database, `
    SELECT p.puuid, p.game_name AS "gameName", p.tag_line AS "tagLine", p.region,
      p.profile_icon AS "profileIconId", p.summoner_level AS "summonerLevel", p.last_fetched AS "lastFetched",
      COALESCE(jsonb_agg(jsonb_build_object(
        'queueType', r.queue_type, 'tier', r.tier, 'rank', r.rank,
        'lp', r.lp, 'wins', r.wins, 'losses', r.losses,
        'history', (${HISTORY_SQL})
      ) ORDER BY r.queue_type) FILTER (WHERE r.puuid IS NOT NULL), '[]'::jsonb) AS ranks
    FROM players p LEFT JOIN rank_entries r ON r.puuid = p.puuid
    WHERE lower(p.game_name) = lower($1) AND lower(p.tag_line) = lower($2) AND p.region = $3
      AND p.profile_icon IS NOT NULL AND p.summoner_level IS NOT NULL AND p.last_fetched IS NOT NULL
    GROUP BY p.puuid`, [lookup.gameName, lookup.tagLine, lookup.region]);
  return row ? { ...row, lastFetched: row.lastFetched.toISOString() } : undefined;
}

export async function playerIdentity(database: Database, puuid: string) {
  const [player] = await queryRows<LookupPayload & { puuid: string }>(database,
    'SELECT puuid, game_name AS "gameName", tag_line AS "tagLine", region FROM players WHERE puuid=$1', [puuid]);
  return player;
}

// Called inside the same transaction that marks the job done.
export async function savePlayer(client: PoolClient, profile: PlayerProfile): Promise<void> {
  await client.query(`INSERT INTO players(puuid, game_name, tag_line, region, profile_icon, summoner_level, last_fetched)
    VALUES ($1,$2,$3,$4,$5,$6,now()) ON CONFLICT(puuid) DO UPDATE SET
      game_name=EXCLUDED.game_name, tag_line=EXCLUDED.tag_line, region=EXCLUDED.region,
      profile_icon=EXCLUDED.profile_icon, summoner_level=EXCLUDED.summoner_level, last_fetched=EXCLUDED.last_fetched`,
  [profile.puuid, profile.gameName, profile.tagLine, profile.region, profile.profileIconId, profile.summonerLevel]);
  await client.query("DELETE FROM rank_entries WHERE puuid = $1", [profile.puuid]);
  for (const rank of profile.ranks) {
    const values = [profile.puuid, rank.queueType, rank.tier, rank.rank, rank.lp, rank.wins, rank.losses];
    await client.query(`INSERT INTO rank_entries(puuid,queue_type,tier,rank,lp,wins,losses)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`, values);
    // Snapshot for the LP graph, only when something changed since the latest snapshot.
    await client.query(`INSERT INTO rank_history(puuid,queue_type,tier,rank,lp,wins,losses)
      SELECT $1,$2,$3,$4,$5,$6,$7
      WHERE NOT EXISTS (
        SELECT 1 FROM (
          SELECT tier, rank, lp, wins, losses FROM rank_history
          WHERE puuid = $1 AND queue_type = $2
          ORDER BY recorded_at DESC, id DESC LIMIT 1
        ) latest
        WHERE latest.tier = $3 AND latest.rank = $4 AND latest.lp = $5
          AND latest.wins = $6 AND latest.losses = $7
      )`, values);
  }
}
