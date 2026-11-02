-- The same identity may have many historical jobs, but only one active lookup.
CREATE UNIQUE INDEX fetch_jobs_active_lookup_idx ON fetch_jobs (
  (payload->>'region'), lower(payload->>'gameName'), lower(payload->>'tagLine')
) WHERE kind = 'lookup' AND status IN ('pending', 'running');
