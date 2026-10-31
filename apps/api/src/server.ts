import closeWithGrace from "close-with-grace";
import { buildApp } from "./app.js";

const app = buildApp({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
});

const port = Number(process.env.PORT ?? 3000);

// Graceful shutdown: vid SIGTERM (t.ex. under en rolling update) slutar Fastify ta emot
// nya anslutningar och avslutar pågående requests innan processen stängs.
closeWithGrace({ delay: 10_000 }, async ({ signal, err }) => {
  if (err) {
    app.log.error(err, "stänger ner efter fel");
  } else {
    app.log.info({ signal }, "stänger ner");
  }
  await app.close();
});

await app.listen({ host: "0.0.0.0", port });
