-- Riot only returns the current LP, so we keep our own history for the LP graph.
-- One row per change, written by the fetcher in the same transaction as rank_entries.
CREATE TABLE rank_history (
  id bigserial PRIMARY KEY,
  puuid text NOT NULL REFERENCES players(puuid),
  queue_type text NOT NULL,
  tier text NOT NULL,
  rank text NOT NULL,
  lp int NOT NULL,
  wins int NOT NULL,
  losses int NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rank_history_puuid_queue_recorded_idx
  ON rank_history (puuid, queue_type, recorded_at DESC, id DESC);
