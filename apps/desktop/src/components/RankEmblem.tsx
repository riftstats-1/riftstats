import { useState } from "react";

interface Props {
  tier: string; // "EMERALD", "GOLD" ...
  size?: number;
}

/**
 * Official rank emblem from public/ranks/<tier>.png (Riot's ranked emblems for developers).
 * Falls back to a simple badge in the tier color if the image is missing.
 */
export function RankEmblem({ tier, size = 64 }: Props) {
  const [failed, setFailed] = useState(false);
  const name = tier.toLowerCase();
  const label = tier.charAt(0) + tier.slice(1).toLowerCase();

  if (failed) {
    return (
      <span
        className="rank-emblem rank-emblem-fallback"
        style={{ width: size, height: size }}
        role="img"
        aria-label={`${label} emblem`}
      >
        {label.charAt(0)}
      </span>
    );
  }

  return (
    <img
      className="rank-emblem"
      src={`/ranks/${name}.png`}
      alt={`${label} emblem`}
      width={size}
      height={size}
      onError={() => setFailed(true)}
    />
  );
}
