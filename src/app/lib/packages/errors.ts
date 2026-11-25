import { HttpError } from "@/lib/http/errors";

/**
 * A refusal the package write path can explain to the user: `status` is the
 * HTTP status, `code` is stable for clients, `message` is the Hebrew text
 * shown as-is. `itemIndex` names the item of the request the refusal is
 * about, so the intake and the opening can mark that row.
 */
export class PackageError extends HttpError {
  declare readonly code: string;
  readonly itemIndex?: number;

  constructor(code: string, message: string, status = 400, itemIndex?: number) {
    super(status, message, { code });
    this.name = "PackageError";
    this.itemIndex = itemIndex;
  }

  /** error / code / itemIndex (itemIndex is dropped when unset). */
  override get body(): Record<string, unknown> {
    return { ...super.body, itemIndex: this.itemIndex };
  }
}
