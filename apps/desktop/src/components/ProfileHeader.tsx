import { profileIcon } from "../ddragon";
import { rankQueueName, tierLabel, timeAgo, winrate } from "../format";
import type { MatchSummary, PlayerProfile, QueueType } from "../types";
import { FormStrip } from "./FormStrip";
import { RankEmblem } from "./RankEmblem";

interface Props {
  profile: PlayerProfile;
  matches: MatchSummary[];
  version: string | null;
  refreshing: boolean;
  onRefresh: () => void;
}

const QUEUES: QueueType[] = ["RANKED_SOLO_5x5", "RANKED_FLEX_SR"];

export function ProfileHeader({ profile, matches, version, refreshing, onRefresh }: Props) {
  // The solo/duo rank sets the color of the whole profile (avatar ring and accent line).
  const solo = profile.ranks.find((r) => r.queueType === "RANKED_SOLO_5x5");
  const profileTier = solo?.tier.toLowerCase() ?? "unranked";

  return (
    <section className="profile panel" data-tier={profileTier} aria-labelledby="player-name">
      <div className="profile-identity">
        <div className="profile-avatar">
          {version && (
            <img
              className="profile-icon"
              src={profileIcon(version, profile.profileIconId)}
              alt=""
              width={80}
              height={80}
              onError={(e) => {
                e.currentTarget.style.visibility = "hidden";
              }}
            />
          )}
          <span className="profile-level">{profile.summonerLevel}</span>
        </div>
        <div className="profile-text">
          <h1 id="player-name" className="player-name">
            {profile.gameName}
            <span className="player-tag">#{profile.tagLine}</span>
          </h1>
          <p className="profile-meta">Updated {timeAgo(profile.lastFetched)}</p>
        </div>
        <button
          className="button profile-refresh"
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
        >
          {refreshing ? "Updating…" : "Update"}
        </button>
      </div>

      <div className="profile-stats">
        <div className="ranks">
          {QUEUES.map((queue) => {
            const entry = profile.ranks.find((r) => r.queueType === queue);
            return (
              <div
                key={queue}
                className="rank"
                data-tier={entry ? entry.tier.toLowerCase() : "unranked"}
              >
                {entry ? (
                  <RankEmblem tier={entry.tier} />
                ) : (
                  <span className="rank-emblem rank-emblem-empty" aria-hidden="true" />
                )}
                <div className="rank-info">
                  <h2 className="rank-queue">{rankQueueName(queue)}</h2>
                  {entry ? (
                    <>
                      <p className="rank-tier">{tierLabel(entry)}</p>
                      <div className="lp-bar" role="img" aria-label={`${entry.lp} LP`}>
                        <span style={{ width: `${Math.min(entry.lp, 100)}%` }} />
                      </div>
                      <p className="rank-detail">
                        <span className="rank-lp">{entry.lp} LP</span>
                        <span className="muted">
                          {" "}
                          {entry.wins}W {entry.losses}L, {winrate(entry.wins, entry.losses)}%
                        </span>
                      </p>
                    </>
                  ) : (
                    <p className="rank-tier">Unranked</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <FormStrip matches={matches} />
      </div>
    </section>
  );
}
