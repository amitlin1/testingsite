import { HttpError } from "@/lib/http/errors";
import { idOfLabel } from "./ids";

/** The box a /api/packages/[id] segment names (an id, or a label "id-source"); a 400 otherwise. */
export function packageIdParam(raw: string): bigint {
  const id = idOfLabel(raw);
  if (id == null) throw new HttpError(400, "מזהה מארז לא תקין");
  return id;
}
