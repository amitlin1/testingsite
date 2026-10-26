"use client";
import React from "react";
import NextLink from "next/link";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, FlaskConical, History, Lock, Pencil, Plus, Printer, QrCode, X } from "lucide-react";
import type { PackageView } from "@/app/lib/packages/read";
import PackageIdText, { MiniItems, StatusPill } from "@/app/components/packages/PackageIdText";
import { AMBER, BLUE, GREEN, ITEM_STATES, PKG_STATUS, RED, fmtDate, seq2 } from "@/app/components/packages/packageUi";
import { HttpError, sendJson, useInvalidatePackages, type ItemTypeLite } from "./queries";

type Item = PackageView["items"][number];

const OFF = "var(--color-hairline)";
const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;

/** The board's grouping of a box status: the stage tabs. */
export type Stage = "test" | "pending" | "done";
export const stageOf = (p: PackageView): Stage => (p.status === "pending" ? "pending" : p.status === "done" ? "done" : "test");

/** The box is still at its opening station: items may be added. */
const isOpening = (p: PackageView) => (p.current_route_step ?? 1) <= 1 && !p.is_finished && (p.status === "queue" || p.status === "test");

/** A box / item the testing screen has in a queue right now. */
const pkgAtStation = (p: PackageView) => p.status === "queue" || p.status === "test" || p.status === "readyClose";
const itemAtStation = (it: Item) => it.state === "queue" || it.state === "test";
const hasSerial = (it: Item) => !!it.serial_no?.trim();

function pkgSegments(p: PackageView): string[] {
  const n = p.route_length;
  if (!n || p.status === "pending") return [];
  const step = p.current_route_step ?? 1;
  const wait = p.status === "waitItems" || p.status === "readyClose" || p.status === "queue";
  return Array.from({ length: n }, (_, i) =>
    p.status === "done" || i < step - 1 ? GREEN : i === step - 1 ? (wait ? AMBER : BLUE) : OFF,
  );
}

function pkgStepText(p: PackageView): { n: string; where: string } {
  const len = p.route_length;
  if (p.status === "pending" || !len) return { n: "טרם נקלט", where: "במשלוח" };
  if (p.status === "done") return { n: `${len} מתוך ${len}`, where: "הושלם" };
  return { n: `שלב ${p.current_route_step ?? 1} מתוך ${len}`, where: p.station_name ?? p.current_step_desc ?? "—" };
}

function pkgNote(p: PackageView): { text: string; warn: boolean } {
  if (p.status === "pending") return { text: "ממתין לסריקה בקליטה", warn: false };
  if (p.status === "done") return { text: p.closed_at ? `נסגר ${fmtDate(p.closed_at)}` : "נסגר", warn: false };
  if (p.status === "waitItems" && p.blocked_by.length > 0) {
    return { text: `${p.blocked_by.length} פריטים עוד לא הגיעו לסגירה`, warn: true };
  }
  if (p.status === "queue") return { text: "ממתין בעמדת הפתיחה", warn: true };
  if (p.status === "readyClose") return { text: "כל הפריטים הגיעו — ממתין לסגירה", warn: true };
  const c = { test: 0, queue: 0, done: 0, missing: 0, new: 0 };
  for (const it of p.items) c[it.state]++;
  const parts = [c.test && `${c.test} בבדיקה`, c.queue && `${c.queue} ממתינים`, c.done && `${c.done} סיימו`, c.missing && `${c.missing} חסרים`].filter(Boolean);
  return { text: parts.join(" · ") || "—", warn: false };
}

function itemSegments(it: Item): string[] {
  const n = it.route_length;
  if (!n) return [];
  const step = it.current_route_step ?? 1;
  return Array.from({ length: n }, (_, i) => {
    if (it.state === "done") return GREEN;
    if (it.state === "missing") return i === 0 ? RED : OFF;
    if (it.state === "new") return OFF;
    return i < step - 1 ? GREEN : i === step - 1 ? (it.state === "queue" ? AMBER : BLUE) : OFF;
  });
}

function itemStepText(it: Item): { n: string; where: string } {
  const len = it.route_length;
  if (!len) return { n: "—", where: "—" };
  if (it.state === "done") return { n: `${len} מתוך ${len}`, where: "הושלם" };
  if (it.state === "missing") return { n: `0 מתוך ${len}`, where: "חסר במארז" };
  if (it.state === "new") return { n: `0 מתוך ${len}`, where: "טרם נפתח" };
  return { n: `שלב ${it.current_route_step ?? 1} מתוך ${len}`, where: it.station_name ?? it.step_desc ?? "—" };
}

const chipBg = (s: Item["state"]) =>
  s === "done" ? "var(--color-success-bg)" : s === "missing" ? "var(--color-danger-bg)" : s === "test" ? "var(--color-primary-soft)" : s === "queue" ? "var(--color-warning-bg)" : "var(--color-canvas-parchment)";

function Segments({ colors, labels }: { colors: string[]; labels?: string }) {
  if (colors.length === 0) return <div className="pb-segs" aria-hidden><span className="pb-seg" /></div>;
  return (
    <div className="pb-segs" role="img" aria-label={labels}>
      {colors.map((c, i) => <span key={i} className="pb-seg" style={{ background: c }} />)}
    </div>
  );
}

function TestingLink({ id, label }: { id: string; label: string }) {
  return (
    <NextLink href={`/testing?item=${id}`} className="pkg-iconbtn" title={label} aria-label={label}>
      <FlaskConical {...ICON} />
    </NextLink>
  );
}

// ---------------------------------------------------------------------------
// One item, shown or edited in place.

function ItemEditLine({ pkg, it, itemTypes, onDone, inPkgEdit }: {
  pkg: PackageView;
  it: Item;
  itemTypes: ItemTypeLite[];
  onDone: () => void;
  inPkgEdit: boolean;
}) {
  const invalidate = useInvalidatePackages();
  const [f, setF] = React.useState({
    itemType: String(it.item_type_id),
    serial: it.serial_no ?? "",
    makat: it.makat ?? "",
    model: it.model ?? "",
    manufacturer: it.manufacturer_name ?? "",
  });
  const [needReset, setNeedReset] = React.useState(false);
  const types = itemTypes.filter((t) => !t.is_package);
  const dirty = f.itemType !== String(it.item_type_id) || f.serial !== (it.serial_no ?? "") || f.makat !== (it.makat ?? "") ||
    f.model !== (it.model ?? "") || f.manufacturer !== (it.manufacturer_name ?? "");

  const save = useMutation({
    mutationFn: (confirmPackageReset: boolean) =>
      sendJson(`/api/items/${it.item_id}`, "PUT", {
        customer: pkg.customer_id,
        itemType: Number(f.itemType),
        serialNumber: f.serial.trim(),
        makat: f.makat,
        model: f.model,
        manufacturer: f.manufacturer,
        manufacturerNo: it.manufacturer_no ?? "",
        confirmPackageReset,
      }),
    onSuccess: () => { setNeedReset(false); invalidate(); onDone(); },
    onError: (e) => { if (e instanceof HttpError && e.body.code === "PACKAGE_RESET_REQUIRED") setNeedReset(true); },
  });

  const [confirmRemove, setConfirmRemove] = React.useState(false);
  const remove = useMutation({
    mutationFn: () => sendJson(`/api/items/${it.item_id}`, "DELETE"),
    onSuccess: () => invalidate(),
  });

  const err = save.error?.message ?? remove.error?.message;
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && dirty && !save.isPending) save.mutate(false);
    if (e.key === "Escape" && !inPkgEdit) onDone();
  };
  const st = ITEM_STATES[it.state];
  const step = itemStepText(it);

  return (
    <div className="pb-irow pb-irow--edit" onKeyDown={onKey}>
      <div className="pb-igrid">
        <span className="pb-seq" style={{ background: chipBg(it.state) }}>{seq2(it.package_seq)}</span>
        <select className="pb-in" aria-label="סוג פריט" value={f.itemType} onChange={(e) => setF({ ...f, itemType: e.target.value })}>
          {types.length === 0 && <option value={String(it.item_type_id)}>{it.item_type_desc}</option>}
          {types.map((t) => <option key={t.item_type_id} value={String(t.item_type_id)}>{t.item_type_desc.trim()}</option>)}
        </select>
        <input className="pb-in pb-ltr" aria-label="מספר סריאלי" dir="ltr" value={f.serial} placeholder="מספר סריאלי" autoFocus={!inPkgEdit} onChange={(e) => setF({ ...f, serial: e.target.value })} />
        <input className="pb-in pb-ltr" aria-label="מק״ט" dir="ltr" value={f.makat} onChange={(e) => setF({ ...f, makat: e.target.value })} />
        <input className="pb-in" aria-label="דגם" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} />
        <div style={{ minWidth: 0 }}>
          <input className="pb-in" aria-label="יצרן" value={f.manufacturer} placeholder="יצרן" onChange={(e) => setF({ ...f, manufacturer: e.target.value })} />
          <div className="pb-cell-sub"><span className="pb-step-n">{step.n}</span> · {step.where}</div>
        </div>
        <div><StatusPill label={st.label} dot={st.color} /></div>
        <div className="pb-actions" style={{ gap: 6 }}>
          {inPkgEdit && !dirty ? (
            confirmRemove ? (
              <button type="button" className="pkg-pill pkg-pill--sm pkg-pill--danger" disabled={remove.isPending} onClick={() => remove.mutate()}>להסיר?</button>
            ) : (
              <button type="button" className="pkg-iconbtn pkg-iconbtn--trash" title="הסרה מהמארז" aria-label={`הסרת פריט ${seq2(it.package_seq)} מהמארז`} onClick={() => setConfirmRemove(true)}><X {...ICON} /></button>
            )
          ) : (
            <>
              {!inPkgEdit && <button type="button" className="pkg-link" onClick={onDone}>ביטול</button>}
              <button type="button" className="pkg-pill pkg-pill--primary pkg-pill--sm" disabled={!dirty || save.isPending || !f.serial.trim()} onClick={() => save.mutate(false)}>
                {save.isPending ? "שומר…" : "שמור"}
              </button>
            </>
          )}
        </div>
      </div>
      {needReset && (
        <div className="pb-band pb-band--warn" style={{ marginTop: 8 }}>
          <span style={{ flex: 1 }}>שינוי הסוג יאפס את כל המארז ויחזיר אותו לעמדת הפתיחה.</span>
          <button type="button" className="pkg-pill pkg-pill--sm pkg-pill--danger" disabled={save.isPending} onClick={() => save.mutate(true)}>אפס ושמור</button>
        </div>
      )}
      {err && !needReset && <div className="pb-err" role="alert" style={{ marginTop: 6 }}>{err}</div>}
    </div>
  );
}

function ItemLine({ pkg, it, hit, canEdit, onEdit, onBarcode }: {
  pkg: PackageView;
  it: Item;
  hit: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onBarcode: () => void;
}) {
  const st = ITEM_STATES[it.state];
  const step = itemStepText(it);
  return (
    <div className={`pb-irow${hit ? " pb-irow--hit" : ""}`} aria-current={hit ? "true" : undefined}>
      <div className="pb-igrid">
        <span className="pb-seq" style={{ background: chipBg(it.state) }}>{seq2(it.package_seq)}</span>
        <div style={{ minWidth: 0 }}>
          <div className="pb-cell-main">{it.item_type_desc}</div>
          <div className="pb-cell-sub"><PackageIdText id={it.item_id} size={12} /></div>
        </div>
        <span className="pb-ltr" style={{ fontSize: 14, fontWeight: 600 }}>{it.serial_no ?? "—"}</span>
        <span className="pb-ltr" style={{ fontSize: 14 }}>{it.makat || "—"}</span>
        <span style={{ fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.model || "—"}</span>
        <div style={{ minWidth: 0 }}>
          <Segments colors={itemSegments(it)} labels={`${step.n} · ${step.where}`} />
          <div className="pb-step"><span className="pb-step-n">{step.n}</span> · {step.where}</div>
        </div>
        <div><StatusPill label={st.label} dot={st.color} /></div>
        <div className="pb-actions">
          {canEdit && <button type="button" className="pkg-iconbtn" title="עריכת פריט" aria-label={`עריכת פריט ${seq2(it.package_seq)}`} onClick={onEdit}><Pencil {...ICON} /></button>}
          {!pkg.shipment_is_sent && itemAtStation(it) && <TestingLink id={it.item_id} label="למסך הבדיקות, מסונן לפריט" />}
          <button type="button" className="pkg-iconbtn" title="ברקוד הפריט" aria-label={`ברקוד פריט ${seq2(it.package_seq)}`} onClick={onBarcode}><QrCode {...ICON} /></button>
          <NextLink href={`/items/${it.item_id}/history`} className="pkg-iconbtn" title="היסטוריית הפריט" aria-label={`היסטוריית פריט ${seq2(it.package_seq)}`}><History {...ICON} /></NextLink>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The box row.

function PackageEditBand({ pkg, onClose, onDelete }: { pkg: PackageView; onClose: () => void; onDelete: () => void }) {
  const invalidate = useInvalidatePackages();
  const [f, setF] = React.useState({ makat: pkg.makat ?? "", model: pkg.model ?? "", manufacturer: pkg.manufacturer_name ?? "" });
  const save = useMutation({
    mutationFn: () => sendJson(`/api/packages/${pkg.item_id}`, "PATCH", f),
    onSuccess: () => { invalidate(); onClose(); },
  });
  return (
    <div className="pb-indent" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="pb-editband" onKeyDown={(e) => { if (e.key === "Enter" && !save.isPending) save.mutate(); if (e.key === "Escape") onClose(); }}>
        <label className="pb-lbl" style={{ width: 160 }}>מק״ט המארז<input className="pb-in pb-ltr" dir="ltr" value={f.makat} autoFocus onChange={(e) => setF({ ...f, makat: e.target.value })} /></label>
        <label className="pb-lbl" style={{ width: 140 }}>דגם<input className="pb-in" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} /></label>
        <label className="pb-lbl" style={{ width: 160 }}>יצרן<input className="pb-in" value={f.manufacturer} placeholder="אופציונלי" onChange={(e) => setF({ ...f, manufacturer: e.target.value })} /></label>
        <span className="pb-lock"><Lock size={14} strokeWidth={1.75} aria-hidden />סוג, לקוח ומשלוח נקבעו בקליטה</span>
      </div>
      {save.error && <div className="pb-err" role="alert">{save.error.message}</div>}
      <div className="pb-foot">
        <button type="button" className="pkg-pill pkg-pill--ghost pkg-pill--sm pkg-pill--danger-text" onClick={onDelete}>מחיקת מארז</button>
        <span style={{ flex: 1 }} />
        <button type="button" className="pkg-pill pkg-pill--ghost" onClick={onClose}>סיום עריכה</button>
        <button type="button" className="pkg-pill pkg-pill--primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "שומר…" : "שמור את פרטי המארז"}</button>
      </div>
    </div>
  );
}

function AddItemLine({ pkg, itemTypes }: { pkg: PackageView; itemTypes: ItemTypeLite[] }) {
  const invalidate = useInvalidatePackages();
  const blank = { itemType: "", serial: "", makat: pkg.makat ?? "", model: pkg.model ?? "", manufacturer: pkg.manufacturer_name ?? "" };
  const [f, setF] = React.useState(blank);
  const add = useMutation({
    mutationFn: () => sendJson(`/api/packages/${pkg.item_id}/items`, "POST", {
      itemType: Number(f.itemType), serialNumber: f.serial.trim(), makat: f.makat, model: f.model, manufacturer: f.manufacturer,
    }),
    onSuccess: () => { setF(blank); invalidate(); },
  });
  const ok = !!f.itemType && !!f.serial.trim();
  return (
    <div className="pb-irow" style={{ background: "var(--color-surface-pearl)" }}>
      <div className="pb-igrid" onKeyDown={(e) => { if (e.key === "Enter" && ok && !add.isPending) add.mutate(); }}>
        <span className="pb-seq" aria-hidden style={{ background: "transparent", border: "1px dashed var(--color-field-border)", color: "var(--color-ink-muted-48)" }}><Plus size={14} strokeWidth={2} /></span>
        <select className="pb-in" aria-label="סוג הפריט להוספה" value={f.itemType} onChange={(e) => setF({ ...f, itemType: e.target.value })}>
          <option value="">סוג פריט…</option>
          {itemTypes.filter((t) => !t.is_package).map((t) => <option key={t.item_type_id} value={String(t.item_type_id)}>{t.item_type_desc.trim()}</option>)}
        </select>
        <input className="pb-in pb-ltr" dir="ltr" aria-label="מספר סריאלי לפריט החדש" placeholder="מספר סריאלי" value={f.serial} onChange={(e) => setF({ ...f, serial: e.target.value })} />
        <input className="pb-in pb-ltr" dir="ltr" aria-label="מק״ט לפריט החדש" placeholder="מק״ט" value={f.makat} onChange={(e) => setF({ ...f, makat: e.target.value })} />
        <input className="pb-in" aria-label="דגם לפריט החדש" placeholder="דגם" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} />
        <span className="pb-note">הוספה אפשרית רק בזמן פתיחת המארז</span>
        <span />
        <div className="pb-actions">
          <button type="button" className="pkg-pill pkg-pill--ghost pkg-pill--sm" disabled={!ok || add.isPending} onClick={() => add.mutate()}>{add.isPending ? "מוסיף…" : "הוסף פריט"}</button>
        </div>
      </div>
      {add.error && <div className="pb-err" role="alert" style={{ marginTop: 6 }}>{add.error.message}</div>}
    </div>
  );
}

export type PackageRowProps = {
  pkg: PackageView;
  expanded: boolean;
  onToggle: () => void;
  hit: boolean;
  hitItems: Set<string>;
  itemTypes: ItemTypeLite[];
  onIntake: () => void;
  intakeBusy: boolean;
  onLabels: () => void;
  onDelete: () => void;
  onBarcode: (it: Item) => void;
};

export default function PackageRow({ pkg, expanded, onToggle, hit, hitItems, itemTypes, onIntake, intakeBusy, onLabels, onDelete, onBarcode }: PackageRowProps) {
  // One edit at a time inside a box: the whole box, or one of its items.
  const [edit, setEdit] = React.useState<{ kind: "pkg" } | { kind: "item"; id: string } | null>(null);
  const readOnly = pkg.shipment_is_sent;
  const st = PKG_STATUS[pkg.status];
  const step = pkgStepText(pkg);
  const note = pkgNote(pkg);
  const pkgEdit = edit?.kind === "pkg";
  const open = expanded || pkgEdit;
  const routed = pkg.status !== "pending";

  return (
    <div className="pb-pkg">
      <div className={`pb-grid pb-pkg-row${hit ? " pb-pkg-row--hit" : ""}`}>
        <button type="button" className="pkg-iconbtn" onClick={onToggle} aria-expanded={open} aria-label={open ? "הסתרת פריטי המארז" : "הצגת פריטי המארז"}>
          <ChevronDown size={18} strokeWidth={1.75} aria-hidden className={`pb-chev${open ? "" : " pb-chev--closed"}`} />
        </button>
        <div style={{ minWidth: 0 }}>
          <PackageIdText id={pkg.item_id} size={13.5} headColor="var(--color-ink)" weight={600} />
          <div className="pb-cell-sub">{pkg.status === "pending" ? "טרם נקלט" : `נקלט ${fmtDate(pkg.created_at)}`}</div>
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="pb-cell-main">{pkg.item_type_desc}</div>
          <div className="pb-cell-sub">{pkg.customer_name ?? pkg.customer_code ?? "—"} · <bdi dir="ltr">{pkg.shipment_code ?? "—"}</bdi></div>
        </div>
        <div>
          <MiniItems width={12} height={12} items={pkg.items.map((it) => ({ color: ITEM_STATES[it.state].color, title: `${seq2(it.package_seq)} · ${it.item_type_desc} · ${it.state_label}` }))} />
          <div className="pb-cell-sub" style={{ marginTop: 5 }}>{pkg.finished_count}/{pkg.items.length} סיימו</div>
        </div>
        <div style={{ minWidth: 0 }}>
          <Segments colors={pkgSegments(pkg)} labels={`${step.n} · ${step.where}`} />
          <div className="pb-step"><span className="pb-step-n">{step.n}</span> · <span style={{ fontWeight: 600 }}>{step.where}</span></div>
          <div className="pb-cell-sub" style={{ color: note.warn ? "var(--color-warning-ink)" : undefined }}>{note.text}</div>
        </div>
        <div>
          <StatusPill label={readOnly ? "יצא במשלוח" : st.label} dot={readOnly ? "var(--color-ink-muted-48)" : st.dot} />
        </div>
        <div className="pb-actions">
          {pkg.status === "pending" && !readOnly && (
            <button type="button" className="pkg-pill pkg-pill--primary pkg-pill--sm" disabled={intakeBusy} onClick={onIntake} style={{ marginInlineEnd: 4 }}>
              {intakeBusy ? "קולט…" : "קליטה"}
            </button>
          )}
          {!readOnly && routed && (
            <button type="button" className="pkg-iconbtn" title="עריכת מארז" aria-label="עריכת מארז" aria-pressed={pkgEdit} onClick={() => setEdit(pkgEdit ? null : { kind: "pkg" })}><Pencil {...ICON} /></button>
          )}
          {!readOnly && pkgAtStation(pkg) && <TestingLink id={pkg.item_id} label="למסך הבדיקות, מסונן למארז" />}
          <button type="button" className="pkg-iconbtn" title="מדבקות" aria-label="הדפסת מדבקות" onClick={onLabels}><Printer {...ICON} /></button>
          <NextLink href={`/packages/${pkg.item_id}`} className="pkg-iconbtn" title="היסטוריית המארז" aria-label="היסטוריית המארז"><History {...ICON} /></NextLink>
        </div>
      </div>

      {open && (
        <div className="pb-expand">
          {pkgEdit && <PackageEditBand pkg={pkg} onClose={() => setEdit(null)} onDelete={onDelete} />}
          <div className="pb-indent pb-items">
            <div className="pb-igrid pb-ith" aria-hidden>
              <span>#</span><span>סוג פריט</span><span>סריאלי</span><span>מק״ט</span><span>דגם</span><span>שלב במסלול · עמדה</span><span>סטטוס</span><span style={{ textAlign: "end" }}>פעולות</span>
            </div>
            {pkg.items.map((it) =>
              // An item without a serial has not been opened yet: the opening
              // station records it, and the server refuses an edit without one.
              (pkgEdit && hasSerial(it)) || (edit?.kind === "item" && edit.id === it.item_id) ? (
                <ItemEditLine key={it.item_id} pkg={pkg} it={it} itemTypes={itemTypes} inPkgEdit={pkgEdit} onDone={() => setEdit(null)} />
              ) : (
                <ItemLine key={it.item_id} pkg={pkg} it={it} hit={hitItems.has(it.item_id)} canEdit={!readOnly && routed && edit == null && hasSerial(it)}
                  onEdit={() => setEdit({ kind: "item", id: it.item_id })} onBarcode={() => onBarcode(it)} />
              ),
            )}
            {pkgEdit && isOpening(pkg) && <AddItemLine pkg={pkg} itemTypes={itemTypes} />}
          </div>
        </div>
      )}
    </div>
  );
}
