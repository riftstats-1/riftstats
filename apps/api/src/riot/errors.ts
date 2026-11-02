export type RiotErrorCode =
  | "RIOT_AUTH_ERROR" | "RIOT_NOT_FOUND" | "RIOT_BAD_REQUEST"
  | "RIOT_UNAVAILABLE" | "RIOT_RATE_LIMITED" | "RIOT_INVALID_RESPONSE"
  | "RIOT_TIMEOUT" | "RIOT_NETWORK_ERROR";

export class RiotError extends Error {
  constructor(
    public readonly code: RiotErrorCode,
    message: string,
    public readonly status?: number,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "RiotError";
  }
}

export function invalidResponse(): never {
  throw new RiotError("RIOT_INVALID_RESPONSE", "Riot returnerade ett ogiltigt svar");
}
