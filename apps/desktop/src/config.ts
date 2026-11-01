// Settings from the .env files (Vite exposes variables prefixed with VITE_).

export const API_URL: string =
  import.meta.env.VITE_API_URL ?? "https://api.riftstats.se";

// Mock data until the backend has real endpoints. Set VITE_USE_MOCK=false to use the API.
export const USE_MOCK: boolean = import.meta.env.VITE_USE_MOCK !== "false";

// Champion, item and profile icons. Will move to https://cdn.riftstats.se
export const ASSET_URL: string =
  import.meta.env.VITE_ASSET_URL ?? "https://ddragon.leagueoflegends.com";
