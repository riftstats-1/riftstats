export class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

export function validationError(): never {
  throw new HttpError(400, "VALIDATION_ERROR", "Ogiltiga parametrar");
}
