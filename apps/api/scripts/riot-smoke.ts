// Explicit manual check only. Not imported by the API server or automated tests.
import { RiotClient } from "../src/riot/client.js";
import { RiotError } from "../src/riot/errors.js";

const [region, riotId] = process.argv.slice(2);
const separator = riotId?.lastIndexOf("#") ?? -1;
if (!region || separator < 1 || separator === riotId.length - 1) {
  console.error('Usage: npm run riot:smoke -- euw1 "Name#TAG"');
  process.exitCode = 1;
} else {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 20_000);
  try {
    const account = await new RiotClient().getAccountByRiotId(
      region, riotId.slice(0, separator), riotId.slice(separator + 1), controller.signal,
    );
    // Report only success and public Riot ID, never key or encrypted account ID.
    console.log(JSON.stringify({ ok: true, region, gameName: account.gameName, tagLine: account.tagLine }));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      code: error instanceof RiotError ? error.code : controller.signal.aborted ? "ABORTED" : "CONFIGURATION_ERROR",
      ...(error instanceof RiotError ? { status: error.status, message: error.message } : {}),
    }));
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
  }
}
