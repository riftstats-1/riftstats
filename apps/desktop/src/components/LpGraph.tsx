import { useId } from "react";
import { ladderScore, tierLabel } from "../format";
import type { LpPoint } from "../types";

interface Props {
  points: LpPoint[];
}

const W = 260;
const H = 74;
const PAD_X = 6;
const PAD_Y = 10;

const dateFormat = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

/** LP over time. Points are placed by ladder score, so promotions keep the line going up. */
export function LpGraph({ points }: Props) {
  const gradientId = useId();

  if (points.length < 2) {
    return (
      <p className="lp-graph-empty">
        LP history builds up as RiftStats follows this player. Check back after a few games.
      </p>
    );
  }

  const scores = points.map(ladderScore);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const span = Math.max(max - min, 20);
  const x = (i: number) => PAD_X + (i / (points.length - 1)) * (W - PAD_X * 2);
  const y = (s: number) => H - PAD_Y - ((s - min) / span) * (H - PAD_Y * 2);

  const line = scores.map((s, i) => `${x(i).toFixed(1)},${y(s).toFixed(1)}`).join(" ");
  const area = `${x(0)},${H} ${line} ${x(points.length - 1)},${H}`;
  const delta = scores[scores.length - 1] - scores[0];
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <figure className="lp-graph">
      <figcaption className="lp-graph-caption">
        <span>LP history</span>
        <span className={delta >= 0 ? "rate-good" : "rate-bad"}>
          {delta >= 0 ? "+" : "−"}
          {Math.abs(delta)} LP
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="lp-graph-svg"
        role="img"
        aria-label={`From ${tierLabel(first)} ${first.lp} LP to ${tierLabel(last)} ${last.lp} LP`}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--tier)" stopOpacity="0.32" />
            <stop offset="1" stopColor="var(--tier)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={area} fill={`url(#${gradientId})`} />
        <polyline
          points={line}
          fill="none"
          stroke="var(--tier)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {points.map((p, i) => (
          <circle
            key={p.recordedAt}
            cx={x(i)}
            cy={y(scores[i])}
            r={i === points.length - 1 ? 3.5 : 2.2}
            className={i === points.length - 1 ? "lp-dot lp-dot-last" : "lp-dot"}
          >
            <title>
              {dateFormat.format(new Date(p.recordedAt))}: {tierLabel(p)} {p.lp} LP
            </title>
          </circle>
        ))}
      </svg>
      <div className="lp-graph-axis">
        <span>{dateFormat.format(new Date(first.recordedAt))}</span>
        <span>{dateFormat.format(new Date(last.recordedAt))}</span>
      </div>
    </figure>
  );
}
