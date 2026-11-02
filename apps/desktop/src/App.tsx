import { useRef, useState } from "react";
import { ApiError, getMatches, loadPlayer, refreshPlayer, waitForJob } from "./api";
import { Logo } from "./components/Logo";
import { MatchList } from "./components/MatchList";
import { ProfileHeader } from "./components/ProfileHeader";
import { SearchBar } from "./components/SearchBar";
import { USE_MOCK } from "./config";
import { useDdragonVersion } from "./ddragon";
import type { MatchSummary, PlayerProfile, Region } from "./types";
import "./App.css";

type View =
  | { kind: "idle" }
  | { kind: "loading"; message: string }
  | { kind: "error"; message: string }
  | { kind: "loaded"; profile: PlayerProfile; matches: MatchSummary[] };

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "PLAYER_NOT_FOUND") {
      return "Riot ID not found. Check the spelling, the tag and the region.";
    }
    return error.message;
  }
  return "Something went wrong. Try again.";
}

const isAbort = (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError";

export default function App() {
  const [view, setView] = useState<View>({ kind: "idle" });
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const version = useDdragonVersion();
  const controller = useRef<AbortController | null>(null);

  async function search(region: Region, gameName: string, tagLine: string) {
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;

    setRefreshError(null);
    setView({ kind: "loading", message: "Searching…" });
    try {
      const profile = await loadPlayer(
        region,
        gameName,
        tagLine,
        () =>
          setView({
            kind: "loading",
            message: "Fetching matches from Riot. The first lookup takes a few seconds.",
          }),
        ctrl.signal,
      );
      const matches = await getMatches(profile.puuid);
      if (!ctrl.signal.aborted) setView({ kind: "loaded", profile, matches });
    } catch (error) {
      if (!isAbort(error)) setView({ kind: "error", message: errorMessage(error) });
    }
  }

  async function refresh() {
    if (view.kind !== "loaded") return;
    const { profile } = view;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const jobId = await refreshPlayer(profile.puuid);
      await waitForJob(jobId, controller.current?.signal);
      const updated = await loadPlayer(profile.region, profile.gameName, profile.tagLine, () => {});
      const matches = await getMatches(updated.puuid);
      setView({ kind: "loaded", profile: updated, matches });
    } catch (error) {
      if (!isAbort(error)) setRefreshError(errorMessage(error));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          <Logo />
          RiftStats
        </span>
        <SearchBar busy={view.kind === "loading"} onSearch={search} />
        {USE_MOCK && <p className="mock-note">Sample data</p>}
      </header>

      <main className="content">
        {view.kind === "idle" && (
          <div className="empty">
            <h1 className="empty-title">Find a player</h1>
            <p className="muted">
              Search a Riot ID to see their rank, recent form and match history.
            </p>
          </div>
        )}

        {view.kind === "loading" && (
          <p className="status" role="status">
            <span className="spinner" aria-hidden="true" />
            {view.message}
          </p>
        )}

        {view.kind === "error" && (
          <p className="status status-error" role="alert">
            {view.message}
          </p>
        )}

        {view.kind === "loaded" && (
          <>
            <ProfileHeader
              profile={view.profile}
              matches={view.matches}
              version={version}
              refreshing={refreshing}
              onRefresh={refresh}
            />
            {refreshError && (
              <p className="status status-error" role="alert">
                {refreshError}
              </p>
            )}
            <MatchList matches={view.matches} version={version} />
          </>
        )}
      </main>
    </div>
  );
}
