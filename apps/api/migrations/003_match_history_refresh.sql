ALTER TABLE match_participants ADD COLUMN champion_name text;
ALTER TABLE players ADD COLUMN refresh_requested_at timestamptz;

CREATE UNIQUE INDEX fetch_jobs_active_refresh_idx ON fetch_jobs ((payload->>'puuid'))
  WHERE kind = 'refresh' AND status IN ('pending', 'running');
