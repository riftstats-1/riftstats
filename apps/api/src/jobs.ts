import { queryRows, type Database } from "./db.js";
import { validationError } from "./errors.js";
import { platformRoute, type Region } from "./riot/routing.js";

export interface LookupPayload { region: Region; gameName: string; tagLine: string }
export type JobStatus = "pending" | "running" | "done" | "failed";
export interface JobRecord { id: string; kind: string; payload: unknown; status: JobStatus; attempts: number; error: string | null }

export function publicJobId(id: string): number {
  const value = Number(id);
  if (!Number.isSafeInteger(value) || value <= 0) return validationError();
  return value;
}

export function lookupPayload(input: unknown): LookupPayload {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return validationError();
  const p = input as Record<string, unknown>;
  for (const key of ["gameName", "tagLine"]) {
    const value = p[key];
    if (typeof value !== "string" || !value.trim() || [...value].length > 100 || /[\u0000-\u001f\u007f]/u.test(value)) return validationError();
  }
  if (typeof p.region !== "string") return validationError();
  let region: Region;
  try { region = platformRoute(p.region); } catch { return validationError(); }
  return { region, gameName: p.gameName as string, tagLine: p.tagLine as string };
}

export async function enqueueLookup(database: Database, payload: LookupPayload): Promise<number> {
  const rows = await queryRows<{ id: string }>(database, `
    INSERT INTO fetch_jobs(kind, payload) VALUES ('lookup', $1::jsonb)
    ON CONFLICT ((payload->>'region'), lower(payload->>'gameName'), lower(payload->>'tagLine'))
      WHERE kind = 'lookup' AND status IN ('pending', 'running')
    DO UPDATE SET updated_at = fetch_jobs.updated_at
    RETURNING id`, [JSON.stringify(payload)]);
  return publicJobId(rows[0].id);
}

export async function claimJob(database: Database): Promise<JobRecord | undefined> {
  const rows = await queryRows<JobRecord>(database, `
    UPDATE fetch_jobs SET status = 'running', attempts = attempts + 1, updated_at = now()
    WHERE id = (
      SELECT id FROM fetch_jobs WHERE status = 'pending'
      ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1
    ) RETURNING *`);
  return rows[0];
}

export async function getJob(database: Database, id: number) {
  const [job] = await queryRows<JobRecord>(database, "SELECT id, status, error FROM fetch_jobs WHERE id = $1", [id]);
  if (!job) return undefined;
  return {
    id: publicJobId(job.id), status: job.status,
    ...(job.status === "failed" && job.error ? { error: job.error } : {}),
  };
}
