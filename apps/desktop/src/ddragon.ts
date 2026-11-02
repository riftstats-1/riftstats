// Images from Riot's Data Dragon (later via cdn.riftstats.se).
import { useEffect, useState } from "react";
import { ASSET_URL } from "./config";

const FALLBACK_VERSION = "15.21.1";

let versionPromise: Promise<string> | null = null;

function fetchVersion(): Promise<string> {
  versionPromise ??= fetch(`${ASSET_URL}/api/versions.json`)
    .then((res) => res.json() as Promise<string[]>)
    .then((versions) => versions[0] ?? FALLBACK_VERSION)
    .catch(() => FALLBACK_VERSION);
  return versionPromise;
}

export function useDdragonVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    fetchVersion().then((v) => active && setVersion(v));
    return () => {
      active = false;
    };
  }, []);
  return version;
}

export const championIcon = (version: string, championName: string) =>
  `${ASSET_URL}/cdn/${version}/img/champion/${championName}.png`;

export const itemIcon = (version: string, itemId: number) =>
  `${ASSET_URL}/cdn/${version}/img/item/${itemId}.png`;

export const profileIcon = (version: string, iconId: number) =>
  `${ASSET_URL}/cdn/${version}/img/profileicon/${iconId}.png`;
