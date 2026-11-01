import { API_URL, USE_MOCK } from "./config";
import { ApiError } from "./errors";
import * as mock from "./mock";
import type { Job, LookupResult, MatchSummary, PlayerProfile, Region } from "./types";

export { ApiError };

interface ErrorBody {
  error?: { code?: string; message?: string };
}

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: T }> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { Accept: "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiError(
      "NETWORK",
      "Could not reach the server. Check your internet connection and try again.",
      0,
    );
  }

  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const err = (body as ErrorBody | null)?.error;
    throw new ApiError(
      err?.code ?? `HTTP_${res.status}`,
      err?.message ?? `The server responded with error ${res.status}.`,
      res.status,
    );
  }

  return { status: res.status, body: body as T };
}

const enc = encodeURIComponent;

export async function lookupPlayer(
  region: Region,
  gameName: string,
  tagLine: string,
): Promise<LookupResult> {
  if (USE_MOCK) return mock.lookupPlayer(region, gameName, tagLine);

  const { status, body } = await request<PlayerProfile | { jobId: number }>(
    `/v1/players/${region}/${enc(gameName)}/${enc(tagLine)}`,
  );
  if (status === 202) {
    return { kind: "queued", jobId: (body as { jobId: number }).jobId };
  }
  return { kind: "found", profile: body as PlayerProfile };
}

export async function getJob(jobId: number): Promise<Job> {
  if (USE_MOCK) return mock.getJob(jobId);
  const { body } = await request<Job>(`/v1/jobs/${jobId}`);
  return body;
}

export async function getMatches(
  puuid: string,
  limit = 20,
): Promise<MatchSummary[]> {
  if (USE_MOCK) return mock.getMatches(puuid, limit);
  const { body } = await request<MatchSummary[]>(
    `/v1/players/${enc(puuid)}/matches?limit=${limit}`,
  );
  return body;
}

export async function refreshPlayer(puuid: string): Promise<number> {
  if (USE_MOCK) return mock.refreshPlayer(puuid);
  const { body } = await request<{ jobId: number }>(
    `/v1/players/${enc(puuid)}/refresh`,
    { method: "POST" },
  );
  return body.jobId;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

/** Waits until the fetcher has finished fetching from Riot. */
export async function waitForJob(
  jobId: number,
  signal?: AbortSignal,
  timeoutMs = 90_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await getJob(jobId);
    if (job.status === "done") return;
    if (job.status === "failed") {
      throw new ApiError(
        "JOB_FAILED",
        job.error ?? "Fetching data from Riot failed.",
        500,
      );
    }
    await sleep(1500, signal);
  }
  throw new ApiError(
    "JOB_TIMEOUT",
    "Fetching from Riot is taking unusually long. Try again in a moment.",
    504,
  );
}

/** Looks up a player, waiting for the fetch if the player is not in the database yet. */
export async function loadPlayer(
  region: Region,
  gameName: string,
  tagLine: string,
  onQueued: () => void,
  signal?: AbortSignal,
): Promise<PlayerProfile> {
  const first = await lookupPlayer(region, gameName, tagLine);
  if (first.kind === "found") return first.profile;

  onQueued();
  await waitForJob(first.jobId, signal);

  const second = await lookupPlayer(region, gameName, tagLine);
  if (second.kind === "found") return second.profile;
  throw new ApiError(
    "NOT_READY",
    "The player is not ready yet. Try again in a moment.",
    503,
  );
}
