import type { SyntheticEvent } from "react";
import { championIcon } from "../ddragon";
import { kdaRatio, rankQueueName, tierLabel, winrate } from "../format";
import type { ChampionStats } from "../format";
import type { MatchSummary, PlayerProfile, QueueType } from "../types";
import { FormStrip } from "./FormStrip";
import { LpGraph } from "./LpGraph";
import { RankEmblem } from "./RankEmblem";

interface Props {
  profile: PlayerProfile;
  matches: MatchSummary[];
  champions: ChampionStats[];
  version: string | null;
}

const QUEUES: QueueType[] = ["RANKED_SOLO_5x5", "RANKED_FLEX_SR"];

function hideBroken(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.style.visibility = "hidden";
}

export function Sidebar({ profile, matches, champions, version }: Props) {
  return (
    <aside className="sidebar">
      <section className="card" aria-label="Ranked">
        {QUEUES.map((queue) => {
          const entry = profile.ranks.find((r) => r.queueType === queue);
          const tier = entry ? entry.tier.toLowerCase() : "unranked";
          return (
            <div key={queue} className="rank-block" data-tier={tier}>
            <div className="rank">
              {entry ? (
                <RankEmblem tier={entry.tier} size={56} />
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
            {entry && queue === "RANKED_SOLO_5x5" && <LpGraph points={entry.history ?? []} />}
            </div>
          );
        })}
      </section>

      <section className="card" aria-label="Recent form">
        <FormStrip matches={matches} />
      </section>

      {champions.length > 0 && (
        <section className="card" aria-labelledby="champions-heading">
          <h2 id="champions-heading" className="card-heading">
            Top champions
          </h2>
          <ul className="champions">
            {champions.map((c) => {
              const rate = winrate(c.wins, c.games - c.wins);
              return (
                <li key={c.championName} className="champion">
                  {version && (
                    <img
                      src={championIcon(version, c.championName)}
                      alt=""
                      width={36}
                      height={36}
                      onError={hideBroken}
                    />
                  )}
                  <div className="champion-name">
                    <p>{c.championName}</p>
                    <p className="muted">
                      {kdaRatio({
                        kills: c.kills / c.games,
                        deaths: c.deaths / c.games,
                        assists: c.assists / c.games,
                      })}{" "}
                      KDA
                    </p>
                  </div>
                  <div className="champion-rate">
                    <p className={rate >= 50 ? "rate-good" : "rate-bad"}>{rate}%</p>
                    <p className="muted">
                      {c.games} {c.games === 1 ? "game" : "games"}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </aside>
  );
}
