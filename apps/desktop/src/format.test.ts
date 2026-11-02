import { describe, expect, it } from "vitest";
import {
  csPerMinute,
  formatDuration,
  kdaQuality,
  kdaRatio,
  ladderScore,
  parseRiotId,
  queueName,
  rankFromScore,
  tierLabel,
  topChampions,
  winrate,
} from "./format";

describe("parseRiotId", () => {
  it("splits name and tag", () => {
    expect(parseRiotId("Faker#KR1")).toEqual({ gameName: "Faker", tagLine: "KR1" });
  });
  it("allows spaces and # in the name", () => {
    expect(parseRiotId("  My Name#EUW ")).toEqual({ gameName: "My Name", tagLine: "EUW" });
    expect(parseRiotId("a#b#EUW")).toEqual({ gameName: "a#b", tagLine: "EUW" });
  });
  it("returns null without a name or tag", () => {
    expect(parseRiotId("Faker")).toBeNull();
    expect(parseRiotId("#EUW")).toBeNull();
    expect(parseRiotId("Faker#")).toBeNull();
  });
});

describe("kda", () => {
  it("computes (K + A) / D", () => {
    expect(kdaRatio({ kills: 8, deaths: 2, assists: 4 })).toBe("6.00");
  });
  it("shows Perfect with zero deaths", () => {
    expect(kdaRatio({ kills: 3, deaths: 0, assists: 5 })).toBe("Perfect");
  });
  it("maps KDA to loot quality", () => {
    expect(kdaQuality({ kills: 1, deaths: 5, assists: 2 })).toBe("poor");
    expect(kdaQuality({ kills: 4, deaths: 3, assists: 2 })).toBe("common");
    expect(kdaQuality({ kills: 5, deaths: 2, assists: 3 })).toBe("rare");
    expect(kdaQuality({ kills: 10, deaths: 1, assists: 8 })).toBe("legendary");
    expect(kdaQuality({ kills: 1, deaths: 0, assists: 1 })).toBe("epic");
  });
});

describe("formatting", () => {
  it("formats game duration", () => {
    expect(formatDuration(1934)).toBe("32:14");
    expect(formatDuration(65)).toBe("1:05");
  });
  it("computes CS per minute", () => {
    expect(csPerMinute(240, 1800)).toBe("8.0");
    expect(csPerMinute(10, 0)).toBe("0.0");
  });
  it("computes win rate", () => {
    expect(winrate(7, 3)).toBe(70);
    expect(winrate(0, 0)).toBe(0);
  });
  it("drops the division for Master and above", () => {
    expect(tierLabel({ tier: "GOLD", rank: "II" })).toBe("Gold II");
    expect(tierLabel({ tier: "MASTER", rank: "I" })).toBe("Master");
  });
  it("maps queue ids", () => {
    expect(queueName(420)).toBe("Ranked Solo/Duo");
    expect(queueName(99999)).toBe("Other");
  });
});

describe("topChampions", () => {
  const match = (championName: string, win: boolean) => ({
    matchId: `${championName}-${Math.random()}`,
    queueId: 420,
    gameStart: "2026-11-01T12:00:00Z",
    durationS: 1800,
    championName,
    win,
    kills: 5,
    deaths: 2,
    assists: 7,
    cs: 200,
    items: [],
  });

  it("groups by champion, most played first", () => {
    const result = topChampions([
      match("Ahri", true),
      match("Jinx", false),
      match("Ahri", false),
      match("Ahri", true),
    ]);
    expect(result.map((c) => [c.championName, c.games, c.wins])).toEqual([
      ["Ahri", 3, 2],
      ["Jinx", 1, 0],
    ]);
    expect(result[0].kills).toBe(15);
  });

  it("returns an empty list without matches", () => {
    expect(topChampions([])).toEqual([]);
  });
});

describe("ladderScore", () => {
  it("keeps going up across a promotion", () => {
    const before = ladderScore({ tier: "GOLD", rank: "IV", lp: 90 });
    const after = ladderScore({ tier: "GOLD", rank: "III", lp: 10 });
    expect(after - before).toBe(20);
  });
  it("puts Master above Diamond I", () => {
    expect(ladderScore({ tier: "MASTER", rank: "I", lp: 0 })).toBeGreaterThan(
      ladderScore({ tier: "DIAMOND", rank: "I", lp: 99 }),
    );
  });
  it("round-trips with rankFromScore", () => {
    const p = { tier: "EMERALD", rank: "II", lp: 35 };
    expect(rankFromScore(ladderScore(p))).toEqual(p);
  });
});
