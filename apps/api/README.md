# RiftStats API

Backend i Fastify och TypeScript med Postgres. Samma kod körs i två roller:

- **api:** läser spelarprofiler och rank från databasen och skapar hämtningsjobb.
- **fetcher:** bearbetar jobben och hämtar data från Riot. Endast en fetcher får köras per databas.

Spelaruppslag och jobbstatus är implementerade. Matchhistorik och refresh återstår. Endpoints och svarsformat finns i [API.md](API.md).

## Lokal körning

Krav: Node 22+ och en tillgänglig Postgres-databas. Kör kommandona från `apps/api`.

```powershell
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Fyll i databasanslutningen (`PG*`) i `.env`. Fetchern behöver även `RIOT_API_KEY`. Filen är ignorerad av Git och Docker. `npm run dev` läser `.env`; befintliga miljövariabler har företräde.

API:

```powershell
$env:MODE = 'api'
$env:PORT = '3000'
npm run dev
```

Fetcher, i en separat terminal:

```powershell
$env:MODE = 'fetcher'
$env:PORT = '3001'
npm run dev
```

`/health` kontrollerar processen. `/ready` kontrollerar databasanslutningen. Fetchern exponerar endast hälsoroutes.

## Databas och drift

SQL-migrationer i `migrations/` körs automatiskt före HTTP-start, med databaslås, en transaktion per fil och checksummehistorik. Ändra aldrig en redan körd migration; lägg till en ny numrerad SQL-fil.

Bygg med `npm run build` och starta med `npm start`. Produktionsstarten läser ingen `.env`; miljövariabler och secrets injiceras av körmiljön. Docker-imagen innehåller kompilerad kod och migrationer.

## Tester

```powershell
npm test
npm run typecheck
npm run build
npm run test:integration
```

Vanliga tester behöver ingen databas och mockar Riot. Integrationstester kräver `TEST_DATABASE_URL` till en separat Postgres-databas vars namn slutar med `_test`. Testanvändaren behöver skapa och ta bort scheman. Använd aldrig produktionsdatabasen för tester.

Manuell kontroll av Riot-nyckeln, som gör ett riktigt API-anrop:

```powershell
npm run riot:smoke -- euw1 "Name#TAG"
```
