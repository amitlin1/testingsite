import type { Field, RouteFieldsConfig, StepConfig, Tone } from "@/app/lib/station-fields/schema";
import type { ContextLineJson, FieldsContextJson, RouteFieldsJson, SharedKitJson } from "@/app/lib/station-fields/admin-types";

/**
 * Test data for the admin screen's models: the kit of artboard 1 ("מארז עמדת עבודה · מסלול 1") and
 * the kit of artboard 11 ("מארז ציוד היקפי · מסלול 1"), built so their maps come out with the
 * artboards' numbers. Station type ids are made up (11–15); the names are the repo's demo names.
 */

export const OPEN = 11;   // פתיחת מארז — package level
export const ELEC = 12;   // חשמל
export const MECH = 13;   // מכניקה
export const VISU = 14;   // בדיקה ויזואלית
export const CLOSE = 15;  // סגירת מארז — package level

export const STATIONS: FieldsContextJson["stations"] = {
  [OPEN]: { label: "פתיחת מארז", package_level: true },
  [ELEC]: { label: "חשמל", package_level: false },
  [MECH]: { label: "מכניקה", package_level: false },
  [VISU]: { label: "בדיקה ויזואלית", package_level: false },
  [CLOSE]: { label: "סגירת מארז", package_level: true },
};

export const KIT_A = { package_type_id: 50, desc: "מארז עמדת עבודה" } satisfies SharedKitJson;
export const KIT_B = { package_type_id: 60, desc: "מארז ציוד היקפי" } satisfies SharedKitJson;

let seq = 0;
/** An 8-char [a-z0-9] suffix, unique per call. */
function suffix(): string {
  seq += 1;
  return seq.toString(36).padStart(8, "0");
}

/** A choice_row field whose options carry `tones` (labels unique within the field). */
export function choice(label: string, tones: Tone[], extra: Partial<Field> = {}): Field {
  return {
    id: "f_" + suffix(),
    type: "choice_row",
    label,
    required: false,
    notes: "optional",
    options: tones.map((tone, i) => ({ id: "o_" + suffix(), label: label + " " + (i + 1), tone })),
    ...extra,
  } as Field;
}

/** n choice fields with these tones between them (the first gets them all, the rest pass / fail). */
export function fields(n: number, tones: Tone[], prefix = "שדה"): Field[] {
  return Array.from({ length: n }, (_, i) => choice(prefix + " " + (i + 1), i === 0 ? tones : ["pass", "fail"]));
}

export function step(uid: string, typeId: number, scope: "package" | "item", groups: StepConfig["groups"]): StepConfig {
  return { uid, station_type_id: typeId, station_label: STATIONS[typeId]?.label ?? "", scope, groups };
}

export function config(...steps: StepConfig[]): RouteFieldsConfig {
  return { schema: 1, steps: Object.fromEntries(steps.map((s) => [s.uid, s])) };
}

export function route(
  id: number,
  itemTypeId: number,
  routeNumber: number,
  steps: [number, string][],
  opts: { published?: RouteFieldsConfig | null; draft?: RouteFieldsConfig | null; rev?: number; version?: number; shared?: SharedKitJson[] } = {},
): RouteFieldsJson {
  const draft = opts.draft ?? null;
  return {
    route: { test_route_id: id, item_type_id: itemTypeId, route_number: routeNumber, route_steps: steps.map((s) => s[0]), step_uids: steps.map((s) => s[1]) },
    draft,
    draft_rev: opts.rev ?? 0,
    draft_updated_at: draft ? "2026-10-14T08:00:00.000Z" : null,
    draft_updated_by: draft ? "admin" : null,
    published_version: opts.version ?? (opts.published ? 1 : 0),
    published: opts.published ?? null,
    issues: [],
    shared_with: opts.shared ?? [],
  };
}

export function line(lineId: number, itemTypeId: number, desc: string, quantity: number, sortOrder: number, seqFrom: number, r: RouteFieldsJson | null): ContextLineJson {
  return {
    line_id: lineId, item_type_id: itemTypeId, item_type_desc: desc, quantity, sort_order: sortOrder,
    seq_from: seqFrom, seq_to: seqFrom + Math.max(1, quantity) - 1, route_number: r?.route.route_number ?? 1, route: r,
    ...(r ? {} : { missing: "ROUTE_MISSING" }),
  };
}

export const PC = 3;
export const MON = 4;
export const KB = 5;
export const MS = 6;

/** Artboard 1: 5 stations × (box, each item, 4 lines). Coverage 15/20, 37 fields, 5 empty cells,
 *  one error cell (מכניקה · מסך), one unpublished cell (חשמל · מחשב), a field set (id 7) on the
 *  visual-check column, outdated for the mouse. */
export function artboard1(): FieldsContextJson {
  const kitPublished = config(
    step("s_kitopen1", OPEN, "package", [
      { target: "box", fields: fields(3, ["pass", "warn", "fail"], "קופסה") },
      { target: "each_item", fields: fields(2, ["pass", "warn", "fail"], "פריט") },
      { target: { item_type_id: PC }, fields: fields(2, ["pass", "fail"], "מחשב") },
      { target: { item_type_id: MON }, fields: fields(2, ["pass", "fail"], "מסך") },
      { target: { item_type_id: KB }, fields: fields(1, ["pass", "fail"], "מקלדת") },
    ]),
    step("s_kitclos1", CLOSE, "package", [
      { target: "box", fields: fields(2, ["pass", "fail"], "אריזה") },
      { target: "each_item", fields: fields(1, ["pass", "fail"], "סגירה") },
    ]),
  );
  const visual = (prefix: string, ver: number) =>
    fields(3, ["pass", "warn", "fail"], prefix).map((f) => ({ ...f, from_set: { id: 7, ver } }) as Field);

  const pcElecPublished = fields(4, ["pass", "warn", "fail", "neutral"], "הפעלה");
  const pcPublished = config(
    step("s_pcelec00", ELEC, "item", [{ target: "item", fields: pcElecPublished }]),
    step("s_pcvisu00", VISU, "item", [{ target: "item", fields: visual("חזותי", 2) }]),
  );
  // The draft adds a fifth field at the electrical station: the one unpublished cell.
  const pcDraft: RouteFieldsConfig = JSON.parse(JSON.stringify(pcPublished));
  pcDraft.steps.s_pcelec00.groups[0].fields.push(choice("בדיקת בידוד", ["pass", "fail"]));

  const vesa = choice("ברגי VESA", ["pass", "fail"]);
  if (vesa.type === "choice_row") vesa.options[1].label = "";   // an empty option: the one error
  const monPublished = config(
    step("s_moelec00", ELEC, "item", [{ target: "item", fields: fields(3, ["pass", "warn", "fail"], "מסך חשמל") }]),
    step("s_momech00", MECH, "item", [{ target: "item", fields: [choice("מעמד", ["pass", "fail"]), vesa] }]),
    step("s_movisu00", VISU, "item", [{ target: "item", fields: visual("מסך חזותי", 2) }]),
  );
  const kbPublished = config(
    step("s_kbmech00", MECH, "item", [{ target: "item", fields: fields(2, ["pass", "fail"], "מקשים") }]),
    step("s_kbvisu00", VISU, "item", [{ target: "item", fields: visual("מקלדת חזותי", 2) }]),
  );
  const msPublished = config(
    step("s_msvisu00", VISU, "item", [{ target: "item", fields: visual("עכבר חזותי", 1) }]),
  );

  const kit = route(100, KIT_A.package_type_id, 1, [[OPEN, "s_kitopen1"], [CLOSE, "s_kitclos1"]], { published: kitPublished, version: 3 });
  const pc = route(101, PC, 1, [[OPEN, "s_pcopen00"], [ELEC, "s_pcelec00"], [VISU, "s_pcvisu00"], [CLOSE, "s_pcclos00"]],
    { published: pcPublished, draft: pcDraft, rev: 4, version: 2, shared: [KIT_A] });
  const mon = route(102, MON, 1, [[OPEN, "s_moopen00"], [ELEC, "s_moelec00"], [MECH, "s_momech00"], [VISU, "s_movisu00"], [CLOSE, "s_moclos00"]],
    { published: monPublished, version: 2, shared: [KIT_A, KIT_B] });
  const kb = route(103, KB, 1, [[OPEN, "s_kbopen00"], [MECH, "s_kbmech00"], [VISU, "s_kbvisu00"], [CLOSE, "s_kbclos00"]],
    { published: kbPublished, version: 1, shared: [KIT_A] });
  const ms = route(104, MS, 1, [[OPEN, "s_msopen00"], [VISU, "s_msvisu00"], [CLOSE, "s_msclos00"]],
    { published: msPublished, version: 1, shared: [KIT_A] });

  return {
    kind: "package",
    subject: { item_type_id: KIT_A.package_type_id, desc: KIT_A.desc, is_package: true, route_number: 1 },
    stations: STATIONS,
    kit,
    item: null,
    lines: [
      line(1, PC, "מחשב", 1, 1, 1, pc),
      line(2, MON, "מסך", 2, 2, 2, mon),
      line(3, KB, "מקלדת", 1, 3, 4, kb),
      line(4, MS, "עכבר", 1, 4, 5, ms),
    ],
  };
}

/** Artboard 11: the kit has no fields of its own; its screen runs route 1 of the screen, which the
 *  kit of artboard 1 also runs and has filled at three stations (8 fields). Coverage 3/16. */
export function artboard11(): FieldsContextJson {
  const monPublished = config(
    step("s_moelec00", ELEC, "item", [{ target: "item", fields: fields(3, ["pass", "warn", "fail"], "חשמל מסך") }]),
    step("s_momech00", MECH, "item", [{ target: "item", fields: fields(2, ["pass", "warn", "fail"], "מכניקה מסך") }]),
    step("s_movisu00", VISU, "item", [{ target: "item", fields: fields(3, ["pass", "warn", "fail"], "חזותי מסך") }]),
  );
  const kit = route(200, KIT_B.package_type_id, 1, [[OPEN, "s_kbopen01"], [CLOSE, "s_kbclos01"]]);
  const mon = route(102, MON, 1, [[OPEN, "s_moopen00"], [ELEC, "s_moelec00"], [MECH, "s_momech00"], [VISU, "s_movisu00"], [CLOSE, "s_moclos00"]],
    { published: monPublished, version: 2, shared: [KIT_A, KIT_B] });
  const kb = route(203, KB, 2, [[OPEN, "s_kb2open0"], [MECH, "s_kb2mech0"], [VISU, "s_kb2visu0"], [CLOSE, "s_kb2clos0"]], { shared: [KIT_B] });
  const ms = route(204, MS, 2, [[OPEN, "s_ms2open0"], [VISU, "s_ms2visu0"], [CLOSE, "s_ms2clos0"]], { shared: [KIT_B] });
  return {
    kind: "package",
    subject: { item_type_id: KIT_B.package_type_id, desc: KIT_B.desc, is_package: true, route_number: 1 },
    stations: STATIONS,
    kit,
    item: null,
    lines: [
      line(11, MON, "מסך", 1, 1, 1, mon),
      line(12, KB, "מקלדת", 1, 2, 2, kb),
      line(13, MS, "עכבר", 1, 3, 3, ms),
    ],
  };
}

/** A context through JSON — what the wire carries. */
export const wire = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
