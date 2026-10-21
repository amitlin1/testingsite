"use client";

import * as React from "react";
import { Plus, Trash2, CircleAlert, Check, Package } from "lucide-react";
import {
  Alert, Button, ConfirmDialog, Dialog, DialogActions, DialogContent, DialogTitle, Tag, TextField, type TagTone,
} from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import ReferenceItemFields from "./ReferenceItemFields";
import {
  checkDraft, draftOf, draftPayload, isComplete, revokeDraftUrls, startUploadType,
  type FieldErrors, type FieldKey, type ItemDraft, type ItemType, type PhotoType, type ReferenceItem, type TemplateLine,
} from "./referenceForm";

/**
 * The package reference dialog (spec: ייחוס מארז) — a reference item of a
 * package type, holding the box and one reference item per line of the
 * type's contents (settings → מארזים). The rail lists "המארז עצמו" and the
 * lines, in the contents' order, each with its status; the pane is the same
 * form as a regular reference item (ReferenceItemFields). A line may stay
 * without a reference item: the opening station then looks one up by what is
 * scanned, as before. Members of types no longer in the contents stay, under
 * "לא בתכולה", until removed.
 *
 * Mount it with a key per opening: its state starts from `editing`.
 */

type Sel = "box" | number;
type Row = { typeId: number; desc: string; quantity: number | null; inTemplate: boolean };
type Status = "ok" | "incomplete" | "missing" | "error";

const STATUS: Record<Status, { label: string; tone: TagTone }> = {
  ok: { label: "מלא", tone: "success" },
  incomplete: { label: "חסרים פרטים", tone: "warning" },
  missing: { label: "אין ייחוס", tone: "warning" },
  error: { label: "שגיאה", tone: "danger" },
};

const MUTED = "var(--color-ink-muted-48)";

export default function PackageReferenceDialog({ packageType, editing, lines, photoTypes, onClose, onSaved }: {
  packageType: ItemType;
  /** The package reference being edited; null for a new one. */
  editing: ReferenceItem | null;
  /** The package type's contents. */
  lines: TemplateLine[];
  photoTypes: PhotoType[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const fallbackPhoto = photoTypes[0]?.code ?? "";
  const [box, setBox] = React.useState<ItemDraft>(() => draftOf(editing, startUploadType(photoTypes, "package"), fallbackPhoto));
  const [members, setMembers] = React.useState<Record<number, ItemDraft | null>>(() =>
    Object.fromEntries((editing?.members ?? []).map((m) => [m.item_type_id, draftOf(m, startUploadType(photoTypes, "product"), fallbackPhoto)])));
  const [sel, setSel] = React.useState<Sel>("box");
  const [errors, setErrors] = React.useState<Record<string, FieldErrors>>({});
  const [formError, setFormError] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  // The contents' lines, then any member whose type left the contents.
  const rows: Row[] = [
    ...lines.map((l) => ({ typeId: l.item_type_id, desc: l.item_type_desc, quantity: l.quantity, inTemplate: true })),
    ...(editing?.members ?? [])
      .filter((m) => !lines.some((l) => l.item_type_id === m.item_type_id))
      .map((m) => ({ typeId: m.item_type_id, desc: m.item_type_desc ?? "", quantity: null, inTemplate: false })),
  ];
  const keyOf = (s: Sel) => (s === "box" ? "box" : String(s));

  const statusOf = (s: Sel): Status => {
    if (errors[keyOf(s)] && Object.keys(errors[keyOf(s)]).length > 0) return "error";
    const d = s === "box" ? box : members[s];
    if (!d) return "missing";
    return isComplete(d) ? "ok" : "incomplete";
  };
  const withRef = rows.filter((r) => r.inTemplate && members[r.typeId]).length;
  const templateCount = rows.filter((r) => r.inTemplate).length;
  const full = withRef === templateCount;

  const clearError = (s: Sel) => (key: FieldKey) =>
    setErrors((all) => {
      const cur = all[keyOf(s)];
      if (!cur?.[key]) return all;
      const next = { ...cur };
      delete next[key];
      return { ...all, [keyOf(s)]: next };
    });

  const close = () => {
    revokeDraftUrls(box);
    Object.values(members).forEach(revokeDraftUrls);
    onClose();
  };

  const addMember = (typeId: number) =>
    setMembers((all) => ({ ...all, [typeId]: draftOf(null, startUploadType(photoTypes, "product"), fallbackPhoto) }));
  const removeMember = (typeId: number) => {
    revokeDraftUrls(members[typeId] ?? null);
    setMembers((all) => ({ ...all, [typeId]: null }));
    setErrors((all) => { const next = { ...all }; delete next[String(typeId)]; return next; });
  };

  const save = async () => {
    // Every missing field is marked on itself and on its row; the dialog shows
    // the first row that has one.
    const errs: Record<string, FieldErrors> = {};
    const boxErr = checkDraft(box);
    if (Object.keys(boxErr).length) errs.box = boxErr;
    for (const r of rows) {
      const d = members[r.typeId];
      const e = d ? checkDraft(d) : {};
      if (Object.keys(e).length) errs[String(r.typeId)] = e;
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      setSel(errs.box ? "box" : rows.find((r) => errs[String(r.typeId)])!.typeId);
      setFormError("יש שדות חסרים. הם מסומנים באדום, וגם ברשימה שבצד.");
      return;
    }

    setSaving(true);
    setFormError("");
    try {
      const memberBodies = [];
      for (const r of rows) {
        const d = members[r.typeId];
        if (d) memberBodies.push({ item_type_id: r.typeId, reference_item_id: d.id, ...(await draftPayload(d)) });
      }
      const body = { item_type_id: packageType.item_type_id, ...(await draftPayload(box)), members: memberBodies };
      const res = await apiFetch(editing ? `/api/settings/reference-items/${editing.reference_item_id}` : "/api/settings/reference-items", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "שגיאה בשמירה");
      }
      revokeDraftUrls(box);
      Object.values(members).forEach(revokeDraftUrls);
      onSaved();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "שגיאה בשמירה");
    } finally {
      setSaving(false);
    }
  };

  // Asked through the app's ConfirmDialog (below), not window.confirm.
  const remove = async () => {
    if (!editing) return;
    setConfirmDelete(false);
    setSaving(true);
    try {
      const res = await apiFetch(`/api/settings/reference-items/${editing.reference_item_id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "שגיאה במחיקה");
      }
      revokeDraftUrls(box);
      Object.values(members).forEach(revokeDraftUrls);
      onSaved();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "שגיאה במחיקה");
    } finally {
      setSaving(false);
    }
  };

  const typeDesc = packageType.item_type_desc.trim();
  const selRow = sel === "box" ? null : rows.find((r) => r.typeId === sel) ?? null;
  const selDraft = sel === "box" ? box : members[sel] ?? null;
  const setSelDraft = (next: ItemDraft) => (sel === "box" ? setBox(next) : setMembers((all) => ({ ...all, [sel]: next })));

  const navRow = (s: Sel, badge: React.ReactNode, title: React.ReactNode, sub: string) => {
    const st = STATUS[statusOf(s)];
    return (
      <button key={keyOf(s)} type="button" className="ri-pkg-row" aria-current={sel === s} onClick={() => setSel(s)}>
        <span className="ri-pkg-badge" aria-hidden>{badge}</span>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontWeight: 600 }}>{title}</span>
          <span className="ri-pkg-sub">{sub}</span>
        </span>
        <Tag tone={st.tone}>{st.label}</Tag>
      </button>
    );
  };
  const memberSub = (typeId: number) => {
    const d = members[typeId];
    if (!d) return "יחפש ייחוס לפי הסריקה";
    const name = d.name.trim() || "פריט ייחוס חדש";
    return d.sku.trim() ? `${name} · ${d.sku.trim()}` : name;
  };
  const outside = rows.filter((r) => !r.inTemplate);

  return (
    <>
      <Dialog open onClose={() => { if (!saving) close(); }} maxWidth={false} fullWidth dir="rtl" PaperProps={{ style: { maxWidth: 1080 } }}>
        <DialogTitle onClose={close}>
          <span style={{ minWidth: 0 }}>
            {editing ? "עריכת ייחוס מארז" : "ייחוס מארז חדש"} · {typeDesc}
            <span style={{ display: "block", fontSize: "var(--text-small)", fontWeight: 400, color: MUTED, marginTop: 4, fontFamily: "var(--font-text)" }}>
              מדבקת הקופסה מזהה את ייחוס המארז בעמדת הפתיחה. לכל פריט בתכולה יש פריט ייחוס משלו, וכל פריט נבדק מולו.
            </span>
          </span>
        </DialogTitle>

        <DialogContent style={{ padding: 0 }} dividers>
          <div className="ri-pkg">
            <nav className="ri-pkg-nav" aria-label="חלקי ייחוס המארז">
              <div className="ri-pkg-group">הקופסה</div>
              {navRow("box", <Package size={18} strokeWidth={1.75} />, "המארז עצמו",
                box.sku.trim() ? `${box.sku.trim()} · ${box.images.length} תמונות` : "מק״ט, משקל ותמונות אריזה")}

              <div className="ri-pkg-group" style={{ marginTop: 14 }}>פריטים בתכולה</div>
              <div style={{ fontSize: "var(--text-fine)", color: MUTED, padding: "0 12px 6px" }}>לפי התכולה של {typeDesc} במסך המארזים</div>
              {rows.filter((r) => r.inTemplate).map((r, i) =>
                navRow(r.typeId, i + 1, <>{r.desc} <span style={{ fontWeight: 400, color: MUTED }}>×{r.quantity}</span></>, memberSub(r.typeId)))}
              {templateCount === 0 && (
                <div style={{ fontSize: "var(--text-small)", color: MUTED, padding: "4px 12px" }}>לסוג המארז הזה אין תכולה מוגדרת.</div>
              )}

              {outside.length > 0 && (
                <>
                  <div className="ri-pkg-group" style={{ marginTop: 14 }}>לא בתכולה</div>
                  <div style={{ fontSize: "var(--text-fine)", color: MUTED, padding: "0 12px 6px" }}>הסוג הוסר מהתכולה. משמש רק אם פריט כזה נוסף בפתיחה.</div>
                  {outside.map((r) => navRow(r.typeId, <CircleAlert size={16} strokeWidth={1.75} />, r.desc, memberSub(r.typeId)))}
                </>
              )}

              <div style={{ marginTop: "auto", padding: "18px 12px 6px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--text-small)", color: MUTED }}>
                  <span>פריטים עם ייחוס</span>
                  <span style={{ fontWeight: 600, color: "var(--color-ink)", fontVariantNumeric: "tabular-nums" }}>{withRef} מתוך {templateCount}</span>
                </div>
                <div className="ri-pkg-progress" aria-hidden>
                  <span style={{ width: `${templateCount ? Math.round((withRef / templateCount) * 100) : 0}%`, background: full ? "var(--color-status-approved)" : "var(--color-warning-ink)" }} />
                </div>
              </div>
            </nav>

            <div className="ri-pkg-pane">
              {sel === "box" ? (
                <div>
                  <div style={{ fontSize: "var(--text-fine)", fontWeight: 600, color: MUTED }}>הקופסה</div>
                  <h3 style={{ margin: "3px 0 0", fontSize: "var(--text-lead)", fontWeight: 700 }}>המארז עצמו</h3>
                  <p style={{ margin: "4px 0 0", fontSize: "var(--text-small)", color: MUTED }}>אותם שדות ואותן תמונות כמו בפריט ייחוס רגיל. מק״ט היצרן הוא המק״ט שעל מדבקת הקופסה.</p>
                </div>
              ) : selRow && (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                    <div style={{ fontSize: "var(--text-fine)", fontWeight: 600, color: MUTED }}>
                      {selRow.inTemplate ? `שורה ${rows.indexOf(selRow) + 1} בתכולה · כמות ${selRow.quantity}` : "לא בתכולה"}
                    </div>
                    <h3 style={{ margin: "3px 0 0", fontSize: "var(--text-lead)", fontWeight: 700 }}>{selRow.desc}</h3>
                  </div>
                  {selDraft && (
                    <Button variant="text" color="error" onClick={() => removeMember(selRow.typeId)} startIcon={<Trash2 size={16} strokeWidth={1.75} aria-hidden />}>
                      הסר פריט ייחוס
                    </Button>
                  )}
                </div>
              )}

              {selDraft ? (
                <>
                  <ReferenceItemFields
                    key={keyOf(sel)}
                    idPrefix={`pkg-${keyOf(sel)}`}
                    draft={selDraft}
                    onDraft={setSelDraft}
                    errors={errors[keyOf(sel)] ?? {}}
                    onClearError={clearError(sel)}
                    photoTypes={photoTypes}
                    typeField={
                      <TextField
                        id={`pkg-${keyOf(sel)}-type`}
                        label="סוג פריט"
                        required
                        fullWidth
                        value={sel === "box" ? typeDesc : selRow?.desc ?? ""}
                        InputProps={{ readOnly: true }}
                        helperText={sel === "box" ? "סוג המארז קבוע לייחוס הזה." : "נקבע לפי שורת התכולה."}
                      />
                    }
                    skuHelp={sel === "box" ? "לפי המק״ט הזה הסריקה בעמדת הפתיחה מוצאת את ייחוס המארז." : "המק״ט שהעובד יסרוק על הפריט בעמדת הפתיחה."}
                    nameLabel={sel === "box" ? "שם ייחוס המארז" : "שם הפריט"}
                    namePlaceholder={sel === "box" ? "לדוגמה: מארז HP EliteDesk 800" : "תיאור קצר"}
                    weightLabel={sel === "box" ? "משקל הקופסה המלאה (גר׳)" : "משקל (גר׳)"}
                  />
                  {sel !== "box" && (
                    <div className="ri-pkg-note">
                      פריט הייחוס הזה שייך לייחוס המארז בלבד. הוא לא מופיע ברשימה של {selRow?.desc}, ונמחק יחד עם ייחוס המארז.
                    </div>
                  )}
                </>
              ) : selRow && (
                <div className="ri-pkg-empty">
                  <span style={{ fontWeight: 600, fontSize: "var(--text-body)" }}>אין עדיין פריט ייחוס ל{selRow.desc}</span>
                  <span style={{ fontSize: "var(--text-small)", color: MUTED, maxWidth: 460 }}>
                    בלי פריט ייחוס כאן, עמדת הפתיחה תחפש ייחוס לפי המק״ט שנסרק על הפריט, כמו היום.
                  </span>
                  <Button onClick={() => addMember(selRow.typeId)} startIcon={<Plus size={16} strokeWidth={2} aria-hidden />}>
                    הוסף פריט ייחוס
                  </Button>
                </div>
              )}

              {formError && <Alert severity="error">{formError}</Alert>}
            </div>
          </div>
        </DialogContent>

        {/* Standard footer: delete at the start, the status, then Cancel and Save at the end. */}
        <DialogActions>
          {editing && (
            <Button variant="text" color="error" onClick={() => setConfirmDelete(true)} disabled={saving} style={{ order: -1 }}>
              מחק ייחוס מארז
            </Button>
          )}
          <span style={{ order: -1, marginInlineEnd: "auto", display: "inline-flex", alignItems: "center", gap: 7, fontSize: "var(--text-small)", color: full ? "var(--color-success-ink)" : "var(--color-warning-ink)" }}>
            {templateCount > 0 && (full ? <Check size={16} strokeWidth={2} aria-hidden /> : <CircleAlert size={16} strokeWidth={2} aria-hidden />)}
            {templateCount === 0 ? null : full
              ? "לכל הפריטים בתכולה יש פריט ייחוס."
              : `${templateCount - withRef === 1 ? "לפריט אחד" : `ל-${templateCount - withRef} פריטים`} אין פריט ייחוס. אפשר לשמור, והכרטיס יסומן כחלקי.`}
          </span>
          <Button variant="outlined" color="inherit" onClick={close} disabled={saving}>ביטול</Button>
          <Button onClick={save} loading={saving}>שמירה</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        draggable={false}
        open={confirmDelete}
        title="מחיקת ייחוס מארז"
        message={`למחוק את ייחוס המארז "${box.name.trim() || box.sku.trim() || "ללא שם"}", יחד עם פריטי הייחוס שבתוכו? פעולה זו אינה ניתנת לביטול.`}
        confirmText="מחק"
        destructive
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
