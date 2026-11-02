export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** 4xx (except 408/429) will not succeed on retry. */
  get retryable() {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

export function errorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (err instanceof ApiError) {
    if (err.status === 502 || err.status === 504 || err.status === 0) {
      return "The cluster API is unreachable.";
    }
    return err.message;
  }
  return err instanceof Error ? err.message : fallback;
}
