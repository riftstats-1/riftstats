export class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly retryAfter?: number) {
    super(message);
  }
}

export function validationError(): never {
  throw new HttpError(400, "VALIDATION_ERROR", "Ogiltiga parametrar");
}
