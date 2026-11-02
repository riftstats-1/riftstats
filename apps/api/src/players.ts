import type { PoolClient } from "pg";
import { queryRows, type Database } from "./db.js";
import type { LookupPayload } from "./jobs.js";
import type { PlayerProfile } from "./riot/types.js";

export async function getPlayer(database: Database, lookup: LookupPayload): Promise<PlayerProfile | undefined> {
  const [row] = await queryRows<Omit<PlayerProfile, "lastFetched"> & { lastFetched: Date }>(database, `
    SELECT p.puuid, p.game_name AS "gameName", p.tag_line AS "tagLine", p.region,
      p.profile_icon AS "profileIconId", p.summoner_level AS "summonerLevel", p.last_fetched AS "lastFetched",
      COALESCE(jsonb_agg(jsonb_build_object(
        'queueType', r.queue_type, 'tier', r.tier, 'rank', r.rank,
        'lp', r.lp, 'wins', r.wins, 'losses', r.losses
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
    await client.query(`INSERT INTO rank_entries(puuid,queue_type,tier,rank,lp,wins,losses)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`, [profile.puuid, rank.queueType, rank.tier, rank.rank, rank.lp, rank.wins, rank.losses]);
  }
}
