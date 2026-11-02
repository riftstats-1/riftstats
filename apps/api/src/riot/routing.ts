const routes = { euw1: "europe", eun1: "europe", na1: "americas", kr: "asia" } as const;
export type Region = keyof typeof routes;

export function platformRoute(region: string): Region {
  if (!Object.hasOwn(routes, region)) throw new TypeError("Regionen stöds inte");
  return region as Region;
}

export function regionalRoute(region: string) {
  return routes[platformRoute(region)];
}

export function pathSegment(value: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError("Ogiltig Riot-parameter");
  }
  return encodeURIComponent(value);
}
