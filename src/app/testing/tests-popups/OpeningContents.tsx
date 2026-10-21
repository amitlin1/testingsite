"use client";
import React from "react";
import { CircleAlert, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { PackageItemView, PackageView } from "@/app/lib/packages/read";
import { apiFetch } from "@/lib/api/client";
import SearchableCombobox from "@/app/components/common/SearchableCombobox";
import { AMBER_BG, AMBER_BORDER, AMBER_INK, HAIR, HAIR_2, INK_2, MUTED, RED, RED_BG, seq2 } from "@/app/components/packages/packageUi";
import { playCue } from "@/app/components/packages/scanSound";
import { serialKey, type SerialMatch } from "@/app/lib/packages/serial-key";
import { typeAsUsKeyboard } from "@/app/lib/scannerKeys";
import { parseItemQr } from "@/app/lib/itemQrParser";
import { isValidShipmentQr } from "@/app/lib/qrParser";
import type { RefMember } from "./packageReference";

/**
 * "תכולה וסריאליים" — the opening station's record of what is really in the
 * box (PUT /api/packages/[id]/contents). The rows start from the items the
 * intake created from the template; the worker opens the box, marks what did
 * not come, adds what the template did not foresee, and gives every item its
 * serial — the only thing typed here. The details (makat, model,
 * manufacturer) are the shipment's — the box's certificate row — and open
 * under "פרטים" to be read, not changed. Scanning the certificate's
 * equipment-row barcode into a serial field fills the serial. No serial, no
 * going on.
 */

export type ContentRow = {
  key: string;
  /** null = added here, not yet in the box. */
  itemId: string | null;
  itemType: number | "";
  typeDesc: string;
  seq: number | null;
  serial: string;
  makat: string;
  model: string;
  manufacturer: string;
  manufacturerNo: string;
  /** Did not come: removed when the contents are saved. */
  gone: boolean;
  open: boolean;
  fromQr?: boolean;
};

type ItemTypeOption = { item_type_id: number; item_type_desc: string; is_package: boolean };

/** The details the box's items take from the shipment: the box's. */
export type BoxDetails = Pick<ContentRow, "makat" | "model" | "manufacturer" | "manufacturerNo">;

export function boxDetailsOf(pkg: Pick<PackageView, "makat" | "model" | "manufacturer_name" | "manufacturer_no">): BoxDetails {
  return { makat: pkg.makat?.trim() ?? "", model: pkg.model?.trim() ?? "", manufacturer: pkg.manufacturer_name?.trim() ?? "", manufacturerNo: pkg.manufacturer_no?.trim() ?? "" };
}

let addedKey = 1;

/** An item without any details (taken in before items inherited them) shows
 *  the box's; without `box`, the items exactly as saved. */
export function rowsFromItems(items: PackageItemView[], box?: BoxDetails): ContentRow[] {
  return items.map((it) => {
    const own: BoxDetails = { makat: it.makat ?? "", model: it.model ?? "", manufacturer: it.manufacturer_name ?? "", manufacturerNo: it.manufacturer_no ?? "" };
    const blank = !Object.values(own).some((v) => v.trim());
    return {
      key: it.item_id, itemId: it.item_id, itemType: it.item_type_id, typeDesc: it.item_type_desc, seq: it.package_seq,
      serial: it.serial_no ?? "", ...(blank && box ? box : own), gone: false, open: false,
    };
  });
}

/** The first thing that keeps the contents from being saved, or null. */
export function contentsProblem(rows: ContentRow[]): string | null {
  const live = rows.filter((r) => !r.gone);
  if (live.length === 0) return "מארז חייב להכיל לפחות פריט אחד";
  const seen = new Map<string, number>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.gone) continue;
    const label = `שורה ${i + 1}`;
    if (r.itemType === "") return `${label} · יש לבחור סוג פריט`;
    if (!r.serial.trim()) return `${label} · חסר מספר סריאלי`;
    const key = serialKey(r.serial);
    if (seen.has(key)) return `${label} · הסריאלי ${r.serial.trim()} כבר הוזן בשורה ${seen.get(key)! + 1}`;
    seen.set(key, i);
  }
  return null;
}

/** Saves the contents; answers the box's items as they now are, or the error (on its row when the server names one). */
export async function saveContents(packageId: string | number, rows: ContentRow[]): Promise<{ items: PackageItemView[] } | { error: string; rowIndex: number | null }> {
  const kept = rows.filter((r) => !r.gone && r.itemId != null);
  const added = rows.filter((r) => !r.gone && r.itemId == null);
  try {
    const res = await apiFetch(`/api/packages/${packageId}/contents`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: kept.map((r) => ({ itemId: r.itemId, serialNumber: r.serial.trim() })),
        remove: rows.filter((r) => r.gone && r.itemId != null).map((r) => r.itemId),
        add: added.map((r) => ({ itemType: r.itemType, serialNumber: r.serial.trim() })),
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      // itemIndex runs over kept, then added — back to the row on screen.
      const order = [...kept, ...added];
      const row = typeof d?.itemIndex === "number" ? order[d.itemIndex] : undefined;
      const rowIndex = row ? rows.indexOf(row) : null;
      const text: string = d?.error || "שמירת תכולת המארז נכשלה";
      return { error: rowIndex != null ? `שורה ${rowIndex + 1} · ${text.includes(":") ? text.split(":").slice(1).join(":").trim() : text}` : text, rowIndex };
    }
    return { items: Array.isArray(d?.package?.items) ? d.package.items : [] };
  } catch {
    return { error: "שגיאה בתקשורת", rowIndex: null };
  }
}

export function OpeningContents({
  rows, onRows, memberTypes, templateCount, shipmentId, packageId, box, error, onDone, expectedOf,
}: {
  rows: ContentRow[];
  onRows: (next: ContentRow[] | ((rs: ContentRow[]) => ContentRow[])) => void;
  memberTypes: ItemTypeOption[];
  templateCount: number;
  shipmentId: number;
  packageId: string;
  /** What an added item starts with. */
  box: BoxDetails;
  /** The save's refusal, on its row. */
  error: { text: string; rowIndex: number | null } | null;
  /** Enter in the last serial with everything filled: go on, as "המשך". */
  onDone: () => void;
  /** With a package reference found: the reference item expected for a type, shown under it. */
  expectedOf?: (itemTypeId: number) => RefMember | null;
}) {
  const uid = React.useId();
  const serialRefs = React.useRef<(HTMLInputElement | null)[]>([]);
  const focusSerial = React.useRef<number | null>(null);
  // serialKey → items already carrying it. No entry = not asked yet.
  const [known, setKnown] = React.useState<Record<string, SerialMatch[]>>({});
  const [note, setNote] = React.useState<{ rowIndex: number; text: string } | null>(null);

  React.useEffect(() => {
    if (focusSerial.current == null) return;
    serialRefs.current[focusSerial.current]?.focus();
    focusSerial.current = null;
  }, [rows]);

  // Ask about the serials once the typing pauses (amber elsewhere, red in this shipment).
  React.useEffect(() => {
    const keys = [...new Set(rows.map((r) => serialKey(r.serial)).filter((k) => k && !(k in known)))];
    if (keys.length === 0) return;
    const t = setTimeout(() => {
      apiFetch("/api/items/serials", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ serials: keys }) })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d) return;
          const matches: SerialMatch[] = Array.isArray(d.matches) ? d.matches : [];
          setKnown((k) => {
            const out = { ...k };
            // This box's own items carry these serials once saved: not a clash.
            for (const key of keys) out[key] = matches.filter((m) => m.serial === key && String(m.package_id) !== packageId);
            return out;
          });
        })
        .catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [rows, known, packageId]);

  const patch = (i: number, p: Partial<ContentRow>) => onRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));

  const flagOf = (i: number): { tone: "error" | "warn"; text: string } | null => {
    const r = rows[i];
    const key = serialKey(r.serial);
    if (!key || r.gone) return null;
    const first = rows.findIndex((x) => !x.gone && serialKey(x.serial) === key);
    if (first < i) return { tone: "error", text: `כבר הוזן בשורה ${first + 1}` };
    const ms = known[key] ?? [];
    if (ms.some((m) => m.shipment_id === shipmentId && m.item_type_id === r.itemType)) return { tone: "error", text: "כבר נקלט במשלוח הזה" };
    const m = ms[0];
    return m ? { tone: "warn", text: `קיים במערכת · ${m.item_type_desc}${m.shipment_code ? ` · משלוח ${m.shipment_code}` : ""}` } : null;
  };

  // The certificate's equipment-row barcode in serial field i fills its
  // serial (a batch row has none — it is typed after). Details stay the box's.
  const applyBarcode = (i: number, text: string): boolean => {
    const value = text.trim();
    const refuse = (msg: string) => { setNote({ rowIndex: i, text: msg }); playCue("error"); serialRefs.current[i]?.select(); return true; };
    if (isValidShipmentQr(value)) return refuse("זה הברקוד של המשלוח — סרוק את ברקוד השורה של הפריט בתעודה");
    if (!value.startsWith("2^")) return false;
    const parsed = parseItemQr(value);
    if (!parsed) return refuse("ברקוד הפריט לא נקרא במלואו — סרוק שוב");
    const it = parsed[0];
    const filled: ContentRow = { ...rows[i], serial: it.serialNumber ?? "", fromQr: true };
    setNote(null);
    onRows((rs) => rs.map((x, j) => (j === i ? filled : x)));
    focusSerial.current = filled.serial ? nextOpen(i) : i;
    return true;
  };
  const nextOpen = (i: number) => {
    const j = rows.findIndex((r, k) => k > i && !r.gone);
    return j >= 0 ? j : i;
  };

  const addRow = () => {
    focusSerial.current = rows.length;
    onRows((rs) => rs.concat([{
      key: `new-${addedKey++}`, itemId: null, itemType: "", typeDesc: "", seq: null, serial: "", ...box, gone: false, open: false,
    }]));
  };

  const live = rows.filter((r) => !r.gone).length;
  const mismatch = live !== templateCount;

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: 13.5 }}>
        <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>בקופסה: {live}</span>
        <span style={{ color: MUTED, fontVariantNumeric: "tabular-nums" }}>· בתבנית: {templateCount}</span>
      </div>
      {mismatch && (
        <div role="status" style={{ marginTop: 10, fontSize: 13, color: AMBER_INK, background: AMBER_BG, border: `1px solid ${AMBER_BORDER}`, borderRadius: 10, padding: "9px 13px", maxWidth: 720 }}>
          התבנית מצפה ל-{templateCount} פריטים, בקופסה {live}. אפשר להמשיך — הפער יירשם על המארז.
        </div>
      )}

      <div style={{ border: `1px solid ${HAIR}`, borderRadius: 14, overflow: "hidden", marginTop: 14 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--color-canvas-parchment)" }}>
              <th className="pkg-th" style={{ paddingInline: 14, width: 44 }}>#</th>
              <th className="pkg-th">סוג פריט</th>
              <th className="pkg-th" style={{ width: 230 }}>מספר סריאלי</th>
              <th className="pkg-th" style={{ width: 80 }}>פרטים</th>
              <th className="pkg-th" style={{ paddingInline: 14, width: 96 }}><span className="pkg-sr-only">בקופסה</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const id = `${uid}-r${r.key}`;
              const flag = flagOf(i);
              const rowError = (error?.rowIndex === i ? error.text : null) ?? (note?.rowIndex === i ? note.text : null);
              const typeName = r.typeDesc || memberTypes.find((t) => t.item_type_id === r.itemType)?.item_type_desc || `שורה ${i + 1}`;
              return (
                <React.Fragment key={r.key}>
                  <tr style={{ borderTop: `1px solid ${HAIR_2}`, background: rowError ? RED_BG : "var(--color-canvas)", opacity: r.gone ? 0.55 : 1 }}>
                    <td style={{ padding: "10px 14px", fontSize: 13, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{r.seq != null ? seq2(r.seq) : "+"}</td>
                    <td style={{ padding: "10px 12px" }}>
                      {r.itemId != null ? (
                        <span style={{ fontSize: 14, fontWeight: 600, textDecoration: r.gone ? "line-through" : undefined }}>{r.typeDesc}</span>
                      ) : (
                        <div style={{ minWidth: 180 }}>
                          <SearchableCombobox<ItemTypeOption>
                            dense denseHeight={38}
                            options={memberTypes}
                            value={memberTypes.find((t) => t.item_type_id === r.itemType) ?? null}
                            onChange={(t) => patch(i, { itemType: t ? t.item_type_id : "", typeDesc: t?.item_type_desc ?? "" })}
                            getOptionLabel={(t) => t.item_type_desc}
                            isOptionEqualToValue={(a, b) => a.item_type_id === b.item_type_id}
                            placeholder="בחר סוג פריט…"
                          />
                        </div>
                      )}
                      {r.gone && <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>לא הגיע — יוסר מהמארז</div>}
                      {!r.gone && expectedOf && r.itemType !== "" && (() => {
                        const m = expectedOf(r.itemType);
                        return (
                          <div style={{ fontSize: 12, color: MUTED, marginTop: 3 }}>
                            {m ? <>ייחוס צפוי: {m.name && <>{m.name} · </>}<bdi dir="ltr">{m.sku}</bdi></> : "אין ייחוס בייחוס המארז"}
                          </div>
                        );
                      })()}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      {!r.gone && (
                        <>
                          {/* Serials are codes: typed left-to-right, kept on the RTL edge. */}
                          <input ref={(el) => { serialRefs.current[i] = el; }} value={r.serial} placeholder="סרוק או הקלד" dir="ltr"
                            aria-label={`מספר סריאלי · שורה ${i + 1} · ${typeName}`}
                            aria-invalid={!!rowError || flag?.tone === "error" || undefined}
                            aria-describedby={flag || rowError ? `${id}-sn` : undefined}
                            onChange={(e) => { patch(i, { serial: e.target.value }); if (note?.rowIndex === i) setNote(null); }}
                            onKeyDown={(e) => {
                              if (e.key !== "Enter") { typeAsUsKeyboard(e); return; }
                              e.preventDefault();
                              if (applyBarcode(i, e.currentTarget.value)) return;
                              if (flag?.tone === "error") { e.currentTarget.select(); playCue("error"); return; }
                              const j = nextOpen(i);
                              if (j !== i) serialRefs.current[j]?.focus();
                              else onDone();
                            }}
                            className="pkg-field pkg-field--sm pkg-field--code"
                            style={flag?.tone === "error" || rowError ? { borderColor: RED } : undefined} />
                          {(rowError || flag) ? (
                            <div id={`${id}-sn`} style={{ fontSize: 11.5, lineHeight: 1.35, marginTop: 4, color: rowError || flag?.tone === "error" ? RED : AMBER_INK }}>{rowError ?? flag?.text}</div>
                          ) : r.fromQr && !r.serial.trim() && (
                            <div style={{ fontSize: 11.5, lineHeight: 1.35, marginTop: 4, color: MUTED }}>
                              בברקוד אין סריאלי — סרוק או הקלד את הסריאלי
                            </div>
                          )}
                        </>
                      )}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      {!r.gone && (
                        <button type="button" onClick={() => patch(i, { open: !r.open })} aria-expanded={r.open} aria-controls={r.open ? `${id}-d` : undefined}
                          className="pkg-link pkg-link--hit" style={{ fontSize: 13 }}>{r.open ? "סגור" : "פרטים"}</button>
                      )}
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "end" }}>
                      {r.gone ? (
                        <button type="button" onClick={() => patch(i, { gone: false })} className="pkg-link pkg-link--hit" style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <RotateCcw size={13} strokeWidth={2} aria-hidden />החזר
                        </button>
                      ) : (
                        <button type="button"
                          onClick={() => (r.itemId == null ? onRows((rs) => rs.filter((_, j) => j !== i)) : patch(i, { gone: true, open: false }))}
                          aria-label={`${r.itemId == null ? "הסר שורה" : "לא הגיע"} · ${typeName}`} title={r.itemId == null ? "הסר שורה" : "הפריט לא הגיע"}
                          className="pkg-iconbtn pkg-iconbtn--trash">
                          <Trash2 size={15} strokeWidth={1.75} aria-hidden />
                        </button>
                      )}
                    </td>
                  </tr>
                  {r.open && !r.gone && (
                    <tr id={`${id}-d`} style={{ background: "var(--color-surface-pearl)", borderTop: `1px solid ${HAIR_2}` }}>
                      <td></td>
                      <td colSpan={4} style={{ padding: "4px 12px 14px" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, maxWidth: 720 }}>
                          {([["מק״ט", "makat", true], ["דגם", "model", false], ["יצרן", "manufacturer", false], ["מק״ט יצרן", "manufacturerNo", true]] as const).map(([label, field, code]) => (
                            <div key={field}>
                              <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 5 }}>{label}</div>
                              <div style={{ fontSize: 13.5, color: INK_2 }}>
                                {r[field] ? (code ? <bdi dir="ltr">{r[field]}</bdi> : r[field]) : <span style={{ color: MUTED }}>—</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
        <button type="button" onClick={addRow} className="pkg-addrow">
          <Plus size={15} strokeWidth={2} aria-hidden />הוסף פריט שלא היה בתבנית
        </button>
      </div>
      {error && error.rowIndex == null && (
        <div role="alert" style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "flex-start", background: RED_BG, border: "1px solid color-mix(in srgb, var(--color-destructive) 25%, transparent)", borderRadius: 10, padding: "11px 14px", maxWidth: 720 }}>
          <span style={{ color: RED, marginTop: 1, display: "inline-flex" }}><CircleAlert size={16} strokeWidth={2} aria-hidden /></span>
          <div style={{ fontSize: 13, fontWeight: 600, color: RED }}>{error.text}</div>
        </div>
      )}
      <div style={{ marginTop: 12, fontSize: 12.5, color: INK_2, lineHeight: 1.5, maxWidth: 720 }}>
        Enter עובר לשורה הבאה. מק״ט, דגם ויצרן נלקחים מהמארז (מתעודת המשלוח) — לשינוי לוחצים "פרטים". ברקוד השורה מהתעודה ממלא סריאלי ופרטים. פריט שלא הגיע מסמנים בפח.
      </div>
    </div>
  );
}
