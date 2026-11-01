import { useState } from "react";
import type { FormEvent } from "react";
import { parseRiotId } from "../format";
import type { Region } from "../types";

const REGIONS: { value: Region; label: string }[] = [
  { value: "euw1", label: "EUW" },
  { value: "eun1", label: "EUNE" },
  { value: "na1", label: "NA" },
  { value: "kr", label: "KR" },
];

const REGION_KEY = "riftstats.region";

function savedRegion(): Region {
  try {
    const value = localStorage.getItem(REGION_KEY);
    if (REGIONS.some((r) => r.value === value)) return value as Region;
  } catch {
    // localStorage may be unavailable, fall back to the default
  }
  return "euw1";
}

interface Props {
  busy: boolean;
  onSearch: (region: Region, gameName: string, tagLine: string) => void;
}

export function SearchBar({ busy, onSearch }: Props) {
  const [riotId, setRiotId] = useState("");
  const [region, setRegion] = useState<Region>(savedRegion);
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseRiotId(riotId);
    if (!parsed) {
      setError("Enter a Riot ID as Name#TAG, for example Faker#KR1.");
      return;
    }
    setError(null);
    try {
      localStorage.setItem(REGION_KEY, region);
    } catch {
      // ignore
    }
    onSearch(region, parsed.gameName, parsed.tagLine);
  }

  return (
    <form className="search" onSubmit={submit} noValidate>
      <div className="search-field">
        <label className="visually-hidden" htmlFor="riot-id">
          Riot ID
        </label>
        <input
          id="riot-id"
          className="search-input"
          placeholder="Search a Riot ID, e.g. Faker#KR1"
          value={riotId}
          onChange={(e) => setRiotId(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error !== null}
          aria-describedby={error ? "search-error" : undefined}
        />
        <label className="visually-hidden" htmlFor="region">
          Region
        </label>
        <select
          id="region"
          className="search-region"
          value={region}
          onChange={(e) => setRegion(e.target.value as Region)}
        >
          {REGIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <button className="button button-primary" type="submit" disabled={busy}>
        Search
      </button>
      {error && (
        <p id="search-error" className="search-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
