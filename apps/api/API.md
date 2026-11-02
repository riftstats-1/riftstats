# API v1

Bas-URL: `https://api.riftstats.se`. JSON med camelCase-fält och ISO 8601-tider i UTC. Jobb-ID:n är positiva heltal av typen number, högst `Number.MAX_SAFE_INTEGER`.

Svarsformaten följer [desktop-klientens typer](https://github.com/riftstats-1/riftstats/blob/desktop/apps/desktop/src/types.ts).

| Metod | Endpoint | Status |
|---|---|---|
| GET | `/health` | Implementerad: processen lever |
| GET | `/ready` | Implementerad: 200 vid databaskontakt, annars 503 |
| GET | `/v1/players/:region/:gameName/:tagLine` | Implementerad |
| GET | `/v1/jobs/:jobId` | Implementerad |
| GET | `/v1/players/:puuid/matches?limit=20` | Implementerad |
| POST | `/v1/players/:puuid/refresh` | Implementerad |

## Spelaruppslag

`region`: `euw1`, `eun1`, `na1` eller `kr`. Namn och tagg är separata URL-kodade segment utan separatorn `#`, vardera 1–100 Unicode-kodpunkter, utan kontrolltecken eller enbart blanksteg. Uppslag är skiftlägesokänsliga inom samma region.

**200:** sparad profil och rank.

```json
{
  "puuid": "example-puuid", "gameName": "Example", "tagLine": "EUW", "region": "euw1",
  "profileIconId": 123, "summonerLevel": 100,
  "ranks": [
    { "queueType": "RANKED_SOLO_5x5", "tier": "GOLD", "rank": "II", "lp": 50, "wins": 30, "losses": 20 }
  ],
  "lastFetched": "2026-11-01T12:00:00.000Z"
}
```

Alla profilfält krävs och är utan null. `ranks` innehåller Solo/Duo och Flex; orankad spelare ger `[]`. `rank` är tom för Master och högre. Winrate beräknas av klienten från wins/losses.

**202:** `{ "jobId": 42 }`. Ett identiskt aktivt uppslag återanvänds. Polla jobbstatus och gör om spelaruppslaget när jobbet är `done`.

## Jobbstatus

**200:** `{ "id": 42, "status": "pending" }`.

Status är `pending`, `running`, `done` eller `failed`. Vid failed kan en felsträng ingå:

```json
{ "id": 42, "status": "failed", "error": "Riot ID hittades inte" }
```

Avsluta polling vid `done` eller `failed`. Okänt jobb ger 404 `JOB_NOT_FOUND`.

## Matchhistorik

`puuid`: 1–128 tecken utan blanksteg eller kontrolltecken. `limit`: heltal 1–100, standard 20. Sortering: `gameStart` fallande, sedan `matchId` fallande. Ingen paginering i första versionen.

**200:** direkt array, utan omslutande objekt.

```json
[
  {
    "matchId": "EUW1_1234567890", "queueId": 420,
    "gameStart": "2026-11-01T11:00:00.000Z", "durationS": 1800,
    "championName": "Ahri", "win": true, "kills": 10, "deaths": 2, "assists": 8,
    "cs": 200, "items": [3031, 3006, 0, 0, 0, 0, 3340]
  }
]
```

Alla matchfält krävs och är utan null. `championName` är Data Dragons ID, exempelvis `LeeSin`. `cs` inkluderar neutrala minions. `items` har sju positioner inklusive trinket; 0 betyder tom plats. Tom historik ger `[]`; okänd spelare ger 404 `PLAYER_NOT_FOUND`.

## Refresh

Ingen request-body. Samma puuid-regler som för matchhistorik.

**202:** `{ "jobId": 43 }`. Aktivt uppdateringsjobb återanvänds. Högst ett nytt jobb per spelare och 120 sekunder; annars 429 `REFRESH_RATE_LIMITED` med `Retry-After` i hela sekunder, avrundat uppåt. Okänd spelare ger 404 `PLAYER_NOT_FOUND`.

## HTTP-fel

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Ogiltiga parametrar" } }
```

| HTTP | Kod |
|---|---|
| 400 | VALIDATION_ERROR |
| 404 | JOB_NOT_FOUND / NOT_FOUND / PLAYER_NOT_FOUND |
| 429 | REFRESH_RATE_LIMITED |
| 503 | DATABASE_UNAVAILABLE |
| 500 | INTERNAL_ERROR |

Jobbets `error` är en sträng; HTTP-felets `error` är ett objekt. Styr klientlogik på status och code, inte meddelandetext.

## CORS

Tillåtna origins: `tauri://localhost`, `http://tauri.localhost` och, utanför produktion, `http://localhost:1420`. Metoder: GET, POST och OPTIONS. Ingen cookieautentisering krävs.
