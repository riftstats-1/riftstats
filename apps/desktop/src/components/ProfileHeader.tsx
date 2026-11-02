import type { CSSProperties } from "react";
import { championSplash, profileIcon } from "../ddragon";
import { timeAgo } from "../format";
import type { PlayerProfile } from "../types";

interface Props {
  profile: PlayerProfile;
  mainChampion: string | null; // most played champion, used as backdrop
  version: string | null;
  refreshing: boolean;
  onRefresh: () => void;
}

export function ProfileHeader({ profile, mainChampion, version, refreshing, onRefresh }: Props) {
  // The solo/duo rank sets the color of the whole profile (avatar ring and accent line).
  const solo = profile.ranks.find((r) => r.queueType === "RANKED_SOLO_5x5");
  const profileTier = solo?.tier.toLowerCase() ?? "unranked";

  const style = mainChampion
    ? ({ "--splash": `url("${championSplash(mainChampion)}")` } as CSSProperties)
    : undefined;

  return (
    <section
      className={mainChampion ? "hero hero-splash" : "hero"}
      data-tier={profileTier}
      style={style}
      aria-labelledby="player-name"
    >
      <div className="hero-content">
        <div className="profile-avatar">
          {version && (
            <img
              className="profile-icon"
              src={profileIcon(version, profile.profileIconId)}
              alt=""
              width={88}
              height={88}
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
          <p className="profile-meta">
            Updated {timeAgo(profile.lastFetched)}
            {mainChampion && <span className="hero-main"> Main: {mainChampion}</span>}
          </p>
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
    </section>
  );
}
