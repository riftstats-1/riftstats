import type { FastifyInstance } from "fastify";
import type { Database } from "./db.js";
import { HttpError } from "./errors.js";
import { enqueueLookup, enqueueRefresh, getJob, lookupPayload, publicJobId } from "./jobs.js";
import { getPlayer } from "./players.js";
import { getMatches } from "./matches.js";

const playerParams = {
  type: "object", additionalProperties: false, required: ["puuid"],
  properties: { puuid: { type: "string", minLength: 1, maxLength: 128, pattern: "^[^\\s\\u0000-\\u001f\\u007f]+$" } },
};

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

  app.get<{ Params: { puuid: string }; Querystring: { limit?: number } }>("/v1/players/:puuid/matches", {
    schema: {
      params: playerParams,
      querystring: { type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 1, maximum: 100, default: 20 } } },
    },
  }, async (request) => getMatches(database, request.params.puuid, request.query.limit ?? 20));

  app.post<{ Params: { puuid: string } }>("/v1/players/:puuid/refresh", {
    schema: { params: playerParams, body: { type: "null" } },
  }, async (request, reply) => {
    const jobId = await enqueueRefresh(database, request.params.puuid);
    return reply.code(202).send({ jobId });
  });
}
