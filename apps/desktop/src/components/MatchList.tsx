import type { SyntheticEvent } from "react";
import { championIcon, itemIcon } from "../ddragon";
import {
  QUALITY_LABELS,
  csPerMinute,
  formatDuration,
  kdaQuality,
  kdaRatio,
  queueName,
  timeAgo,
} from "../format";
import type { MatchSummary } from "../types";

interface Props {
  matches: MatchSummary[];
  version: string | null;
}

// Hides images that do not exist, e.g. items removed from the game.
function hideBroken(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.style.visibility = "hidden";
}

export function MatchList({ matches, version }: Props) {
  if (matches.length === 0) {
    return (
      <p className="empty">No matches found. Play a game and press Update.</p>
    );
  }

  return (
    <section aria-labelledby="matches-heading">
      <h2 id="matches-heading" className="section-heading">
        Match history
      </h2>
      <ol className="matches">
        {matches.map((m) => {
          const quality = kdaQuality(m);
          return (
            <li key={m.matchId} className={m.win ? "match match-win" : "match match-loss"}>
              <div className="match-champion">
                {version && (
                  <img
                    src={championIcon(version, m.championName)}
                    alt={m.championName}
                    width={48}
                    height={48}
                    onError={hideBroken}
                  />
                )}
              </div>

              <div className="match-result">
                <p className="match-outcome">{m.win ? "Victory" : "Defeat"}</p>
                <p className="match-queue">
                  {queueName(m.queueId)}, {formatDuration(m.durationS)}
                </p>
                <p className="match-queue">
                  <time dateTime={m.gameStart}>{timeAgo(m.gameStart)}</time>
                </p>
              </div>

              <div className="match-kda" data-quality={quality}>
                <p className="match-score">
                  {m.kills}
                  <span className="slash">/</span>
                  {m.deaths}
                  <span className="slash">/</span>
                  {m.assists}
                </p>
                <p className="match-sub">
                  {kdaRatio(m)} KDA
                  <span className="quality-badge">{QUALITY_LABELS[quality]}</span>
                </p>
              </div>

              <div className="match-cs">
                <p className="match-stat">{m.cs} CS</p>
                <p className="match-sub">{csPerMinute(m.cs, m.durationS)}/min</p>
              </div>

              <ul className="match-items" aria-label="Items">
                {m.items.map((item, slot) => (
                  <li key={slot} className="item-slot">
                    {item !== 0 && version && (
                      <img
                        src={itemIcon(version, item)}
                        alt=""
                        width={24}
                        height={24}
                        onError={hideBroken}
                      />
                    )}
                  </li>
                ))}
              </ul>

            </li>
          );
        })}
      </ol>
    </section>
  );
}
