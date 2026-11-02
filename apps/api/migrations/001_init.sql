CREATE TABLE players (
  puuid text PRIMARY KEY,
  game_name text NOT NULL,
  tag_line text NOT NULL,
  region text NOT NULL,
  profile_icon int,
  summoner_level int,
  last_fetched timestamptz
);
CREATE UNIQUE INDEX players_riot_id_region_idx
  ON players (lower(game_name), lower(tag_line), region);

CREATE TABLE rank_entries (
  puuid text REFERENCES players(puuid),
  queue_type text,
  tier text,
  rank text,
  lp int,
  wins int,
  losses int,
  PRIMARY KEY (puuid, queue_type)
);

CREATE TABLE matches (
  match_id text PRIMARY KEY,
  queue_id int,
  game_start timestamptz,
  duration_s int,
  patch text,
  raw jsonb
);

-- Other match participants need not have been looked up as players.
CREATE TABLE match_participants (
  match_id text REFERENCES matches(match_id),
  puuid text,
  champion_id int,
  team_id int,
  win boolean,
  kills int,
  deaths int,
  assists int,
  cs int,
  gold int,
  damage int,
  items int[],
  PRIMARY KEY (match_id, puuid)
);
CREATE INDEX match_participants_puuid_idx ON match_participants(puuid);

CREATE TABLE fetch_jobs (
  id bigserial PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('lookup', 'refresh')),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'failed')),
  attempts int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fetch_jobs_status_created_at_idx ON fetch_jobs(status, created_at);
