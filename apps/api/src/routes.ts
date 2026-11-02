import type { FastifyInstance } from "fastify";
import type { Database } from "./db.js";
import { HttpError } from "./errors.js";
import { enqueueLookup, getJob, lookupPayload, publicJobId } from "./jobs.js";
import { getPlayer } from "./players.js";

export function registerLookupRoutes(app: FastifyInstance, database: Database) {
  app.get<{ Params: { region: string; gameName: string; tagLine: string } }>(
    "/v1/players/:region/:gameName/:tagLine", {
      schema: { params: {
        type: "object", additionalProperties: false, required: ["region", "gameName", "tagLine"],
        properties: {
          region: { type: "string", enum: ["euw1", "eun1", "na1", "kr"] },
          gameName: { type: "string", minLength: 1, maxLength: 100 },
          tagLine: { type: "string", minLength: 1, maxLength: 100 },
        },
      } },
    }, async (request, reply) => {
      const lookup = lookupPayload(request.params);
      const profile = await getPlayer(database, lookup);
      if (profile) return profile;
      const jobId = await enqueueLookup(database, lookup);
      return reply.code(202).send({ jobId });
    },
  );

  app.get<{ Params: { jobId: string } }>("/v1/jobs/:jobId", {
    schema: { params: {
      type: "object", additionalProperties: false, required: ["jobId"],
      properties: { jobId: { type: "string", pattern: "^[1-9][0-9]{0,15}$" } },
    } },
  }, async (request) => {
    const job = await getJob(database, publicJobId(request.params.jobId));
    if (!job) throw new HttpError(404, "JOB_NOT_FOUND", "Jobbet hittades inte");
    return job;
  });
}
