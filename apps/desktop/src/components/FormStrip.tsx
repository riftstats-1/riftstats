import type { CSSProperties } from "react";
import { winrate } from "../format";
import type { MatchSummary } from "../types";

interface Props {
  matches: MatchSummary[];
}

/** Recent form: one bar per match, oldest on the left, newest on the right. */
export function FormStrip({ matches }: Props) {
  if (matches.length === 0) return null;

  const wins = matches.filter((m) => m.win).length;
  const losses = matches.length - wins;
  const chronological = [...matches].reverse();

  return (
    <figure className="form">
      <figcaption className="form-caption">
        <span className="form-rate">{winrate(wins, losses)}%</span>
        <span className="muted">
          win rate in the last {matches.length} games ({wins}W {losses}L)
        </span>
      </figcaption>
      <div
        className="form-bars"
        role="img"
        aria-label={`Last ${matches.length} games: ${wins} wins and ${losses} losses`}
      >
        {chronological.map((m, i) => (
          <span
            key={m.matchId}
            style={{ "--i": i } as CSSProperties}
            className={m.win ? "form-bar form-bar-win" : "form-bar form-bar-loss"}
            title={`${m.win ? "Victory" : "Defeat"} as ${m.championName}`}
          />
        ))}
      </div>
    </figure>
  );
}
