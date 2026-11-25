/**
 * The server's error contract. A route (or the module it calls) throws an HttpError; one responder
 * turns it into `{ error, code?, ...extra }` with its status. Anything else is a bug or an outage:
 * it is logged and answered `{ error: fallback }` 500, so no raw database text reaches the browser.
 *
 * No imports: client modules may share a domain error class (step uids, for one).
 */

export type HttpErrorOptions = { code?: string; extra?: Record<string, unknown> };

export class HttpError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly extra: Record<string, unknown>;

  constructor(status: number, message: string, { code, extra = {} }: HttpErrorOptions = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }

  /** The JSON body to answer with. */
  get body(): Record<string, unknown> {
    return { error: this.message, ...(this.code ? { code: this.code } : {}), ...this.extra };
  }
}

/** HttpError → its body and status (logged when ≥ 500); anything else → logged, `{ error: fallback }` 500. */
export function errorResponse(error: unknown, fallback: string): Response {
  if (error instanceof HttpError) {
    if (error.status >= 500) console.error(fallback, error);
    return Response.json(error.body, { status: error.status });
  }
  console.error(fallback, error);
  return Response.json({ error: fallback }, { status: 500 });
}
