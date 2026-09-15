import { NextResponse } from "next/server";

/**
 * A refusal the package write path can explain to the user. `status` is the
 * HTTP status the route should answer with; `code` is stable for clients,
 * `message` is the Hebrew text shown as-is.
 */
export class PackageError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "PackageError";
    this.code = code;
    this.status = status;
  }
}

/** Shared tail for the package routes: PackageError → its status, anything
 *  else → 500 with the message (same shape the legacy routes answered with). */
export function packageErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof PackageError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  console.error(fallback, error);
  const message = error instanceof Error && error.message ? error.message : fallback;
  return NextResponse.json({ error: message }, { status: 500 });
}
