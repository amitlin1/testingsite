"use client";
import React, { useRef, useState } from "react";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    Alert,
    SearchableCombobox,
    FieldLabel,
} from "@/components/ui";
import { certRowLine, type ShipmentLine } from "@/app/lib/shipments/form";
import { useIdleScan } from "@/lib/hooks/useIdleScan";
import { looksLikeShipmentQr } from '@/app/lib/qrParser';
import { fromHebrewLayout, hasHebrew, typeAsUsKeyboard } from '@/lib/scan/scannerKeys';
import { parseItemQr, sameShipmentNumber, type ParsedItemData } from '@/app/lib/itemQrParser';
import { EditNote as EditNoteIcon } from "@/components/ui/icons";

/**
 * A row of the certificate's equipment table, scanned into "מארזים במשלוח"
 * and waiting for the worker's OK. Everything it can fill is filled and
 * editable; the package type stays the worker's choice. A row with a serial
 * is one unit, so one box. The confirmed line keeps the whole row; the
 * item's own serial is still recorded at the opening station.
 * `hebrew`: the scan held Hebrew letters and was read back through the
 * keyboard layout — the details may be garbled, so the draft says so.
 * `manual`: typed by hand (no QR, or one that won't read) — every detail is
 * an input, and the row has no raw barcode text. `qtyTouched`: the worker
 * typed the box count, so כמות לבדיקה no longer fills it.
 */
type LineDraft = {
    key: number;
    row: ParsedItemData;
    quantity: number;
    makat: string;
    itemTypeId: number | null;
    hebrew: boolean;
    manual: boolean;
    qtyTouched: boolean;
};

const EMPTY_ROW: ParsedItemData = {
    rowNum: "", manufacturerNo: "", manufacturer: "", makat: "", model: null, serialNumber: null,
    batchSize: "", qtyToTest: null, purchaseOrder: "", shipmentNumber: null, raw: "",
};

type ShipmentLineScanDialogProps = {
    open: boolean;
    onClose: () => void;
    itemTypes: { id: number; name: string }[];
    /** cert_row_raw of the rows already on the shipment (scannedRows). */
    takenRows: string[];
    /** The shipment number on the form: a row printed with another
     *  certificate's number is refused. Empty = not known yet. */
    shipmentCode?: string;
    /** The confirmed rows, as package lines, in scan order. */
    onConfirm: (lines: ShipmentLine[]) => void;
};

/** A certificate row → a package line: scan it (or type it by hand), look it over, confirm. */
export default function ShipmentLineScanDialog({
    open,
    onClose,
    itemTypes,
    takenRows,
    shipmentCode,
    onConfirm,
}: ShipmentLineScanDialogProps) {
    const fieldId = React.useId();
    const [input, setInput] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [drafts, setDrafts] = useState<LineDraft[]>([]);
    const { schedule: scheduleScan, cancel: cancelScan } = useIdleScan();
    const nextKey = useRef(0);

    const close = () => {
        cancelScan();
        setInput('');
        setError(null);
        setDrafts([]);
        onClose();
    };

    // A scanned equipment barcode becomes drafts to confirm. A row already
    // on the shipment or already waiting is not added twice, nor a row of
    // another certificate.
    const readScan = (text: string) => {
        // Enter and the idle timer both read a scan; whichever comes first
        // cancels the other, or the row would be read twice.
        cancelScan();
        const value = fromHebrewLayout(text).trim();
        setInput('');
        if (looksLikeShipmentQr(value)) {
            setError('זה ברקוד המשלוח — הוא נסרק ב"סרוק ברקוד" שבראש החלון. כאן סורקים את ברקוד השורה מטבלת הציוד.');
            return;
        }
        const rows = parseItemQr(value);
        if (!rows) {
            setError('זה לא ברקוד של שורה מטבלת הציוד בתעודת המשלוח, או שהסריקה לא נקראה במלואה. סרוק שוב.');
            return;
        }
        const foreign = rows.find((r) => r.shipmentNumber && shipmentCode?.trim() && !sameShipmentNumber(r.shipmentNumber, shipmentCode));
        if (foreign) {
            setError(`שורה ${foreign.rowNum} שייכת לתעודת משלוח ${foreign.shipmentNumber}, ולא למשלוח ${shipmentCode?.trim()}.`);
            return;
        }
        const seen = new Set([...takenRows, ...drafts.map((d) => d.row.raw)]);
        const fresh = rows.filter((r) => !seen.has(r.raw));
        if (fresh.length === 0) {
            setError(`שורה ${rows[0].rowNum} בתעודה כבר נסרקה למשלוח הזה.`);
            return;
        }
        setError(null);
        const hebrew = hasHebrew(text);
        setDrafts((d) => d.concat(fresh.map((row) => ({
            key: nextKey.current++,
            row,
            quantity: row.qtyToTest ?? 0,
            makat: row.makat,
            itemTypeId: null,
            hebrew,
            manual: false,
            qtyTouched: false,
        }))));
    };

    // A row with no QR, or one the scanner won't read: the same draft, every detail typed.
    const addManual = () => {
        setError(null);
        setDrafts((d) => d.concat({
            key: nextKey.current++, row: EMPTY_ROW, quantity: 0, makat: "", itemTypeId: null,
            hebrew: false, manual: true, qtyTouched: false,
        }));
    };

    const patchDraft = (k: number, patch: Partial<LineDraft>) =>
        setDrafts((d) => d.map((x, j) => (j === k ? { ...x, ...patch } : x)));

    // A typed detail. As on a scanned row: a serial makes it one box, and
    // כמות לבדיקה fills the box count until the worker types one.
    const patchRow = (k: number, patch: Partial<ParsedItemData>) =>
        setDrafts((d) => d.map((x, j) => {
            if (j !== k) return x;
            const row = { ...x.row, ...patch };
            const quantity = row.serialNumber ? 1
                : x.qtyTouched ? x.quantity
                : row.qtyToTest ?? 0;
            return { ...x, row, quantity };
        }));

    const confirm = () => {
        onConfirm(drafts.map((d) => certRowLine(d.row, d)));
        close();
    };
    const missingQty = drafts.some((d) => !(d.quantity >= 1));

    return (
        <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
            <DialogTitle onClose={close}>שורה מתעודת המשלוח</DialogTitle>
            <DialogContent>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
                    {error && <Alert severity="error">{error}</Alert>}
                    <TextField
                        autoFocus
                        fullWidth
                        placeholder="סרוק את ה-QR של השורה בטבלת הציוד…"
                        aria-label="ברקוד שורת הציוד"
                        value={input}
                        onChange={(e) => {
                            const val = e.target.value;
                            setInput(val);
                            scheduleScan(() => {
                                if (parseItemQr(fromHebrewLayout(val))) readScan(val);
                            });
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                if (input.trim()) readScan(input);
                                return;
                            }
                            typeAsUsKeyboard(e);
                        }}
                        inputProps={{ dir: "ltr", style: { textAlign: "center" } }}
                    />
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", color: "var(--color-ink-muted-48)", fontSize: "var(--text-body-sm)" }}>
                        <div style={{ flex: 1, height: 1, background: "var(--color-hairline)" }} />
                        או
                        <div style={{ flex: 1, height: 1, background: "var(--color-hairline)" }} />
                    </div>
                    <Button variant="outlined" size="small" startIcon={<EditNoteIcon fontSize={16} aria-hidden />} onClick={addManual} style={{ alignSelf: "center" }}>
                        הזנה ידנית של שורה
                    </Button>
                    {drafts.length === 0 && (
                        <div style={{ fontSize: "var(--text-body-sm)", color: "var(--color-ink-muted-48)", textAlign: "center" }}>
                            סרוק את ה-QR של השורה, או הזן אותה ידנית כשאין QR או שהסריקה לא נקראת.
                        </div>
                    )}
                    {drafts.map((d, k) => (
                        <div key={d.key} style={{
                            border: `1px solid ${d.manual ? "var(--color-primary)" : "var(--color-hairline)"}`, borderRadius: "var(--r-md)",
                            padding: "var(--space-md)", display: "flex", flexDirection: "column", gap: "var(--space-sm)",
                        }}>
                            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--space-sm)" }}>
                                <div style={{ fontWeight: 600 }}>
                                    {d.manual
                                        ? (d.row.rowNum.trim() ? `הזנה ידנית · שורה ${d.row.rowNum.trim()} בתעודה` : "הזנה ידנית")
                                        : `שורה ${d.row.rowNum} בתעודה`}
                                </div>
                                <Button size="small" color="inherit" onClick={() => setDrafts((x) => x.filter((_, j) => j !== k))}>הסר</Button>
                            </div>
                            {d.manual ? (
                                <div className="shp-form-grid shp-form-grid--3">
                                    {([
                                        ["rowNum", "מס׳ שורה בתעודה", d.row.rowNum, true],
                                        ["makat", "מק״ט צה״לי", d.makat, true],
                                        ["purchaseOrder", "הזמנת רכש", d.row.purchaseOrder, true],
                                        ["manufacturer", "שם יצרן", d.row.manufacturer, false],
                                        ["manufacturerNo", "מס׳ יצרן", d.row.manufacturerNo, true],
                                        ["model", "גרסת הציוד", d.row.model ?? "", false],
                                        ["serialNumber", "מס׳ סריאלי", d.row.serialNumber ?? "", true],
                                        ["batchSize", "גודל אצווה", d.row.batchSize, true],
                                    ] as const).map(([key, label, value, ltr]) => (
                                        <div key={key}>
                                            <FieldLabel htmlFor={`${fieldId}-draft-${k}-${key}`}>{label}</FieldLabel>
                                            <TextField
                                                id={`${fieldId}-draft-${k}-${key}`}
                                                size="small"
                                                fullWidth
                                                value={value}
                                                onChange={(e) => {
                                                    const v = e.target.value;
                                                    if (key === "makat") patchDraft(k, { makat: v });
                                                    else if (key === "model" || key === "serialNumber") patchRow(k, { [key]: v.trim() ? v : null });
                                                    else patchRow(k, { [key]: v });
                                                }}
                                                inputProps={ltr ? { dir: "ltr", style: { textAlign: "right" } } : undefined}
                                            />
                                        </div>
                                    ))}
                                    <div>
                                        <FieldLabel htmlFor={`${fieldId}-draft-${k}-qtyToTest`}>כמות לבדיקה</FieldLabel>
                                        <TextField
                                            id={`${fieldId}-draft-${k}-qtyToTest`}
                                            type="number"
                                            size="small"
                                            fullWidth
                                            value={d.row.qtyToTest ?? ''}
                                            onChange={(e) => {
                                                const n = Number(e.target.value);
                                                patchRow(k, { qtyToTest: e.target.value === '' || !Number.isFinite(n) ? null : n });
                                            }}
                                            inputProps={{ min: 0, style: { fontVariantNumeric: "tabular-nums" } }}
                                        />
                                    </div>
                                </div>
                            ) : (
                            <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr auto 1fr", gap: "4px 12px", fontSize: "var(--text-body-sm)" }}>
                                {([
                                    ["מס׳ יצרן", d.row.manufacturerNo],
                                    ["שם יצרן", d.row.manufacturer],
                                    ["גרסת הציוד", d.row.model],
                                    ["מק״ט צה״לי", d.row.makat],
                                    ["מס׳ סריאלי", d.row.serialNumber],
                                    ["גודל אצווה", d.row.batchSize],
                                    ["כמות לבדיקה", d.row.qtyToTest == null ? null : String(d.row.qtyToTest)],
                                    ["הזמנת רכש", d.row.purchaseOrder],
                                ] as const).map(([label, value]) => (
                                    <React.Fragment key={label}>
                                        <dt style={{ color: "var(--color-ink-muted-48)" }}>{label}</dt>
                                        <dd style={{ margin: 0, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}><bdi>{value || "—"}</bdi></dd>
                                    </React.Fragment>
                                ))}
                            </dl>
                            )}
                            {d.manual && !d.row.rowNum.trim() && !d.makat.trim() && !d.row.manufacturer.trim() && !d.row.model?.trim() && (
                                <Alert severity="warning">
                                    לא הוזנו פרטים מהתעודה. אפשר להוסיף ככה, אבל עדיף למלא לפחות מס׳ שורה ומק״ט.
                                </Alert>
                            )}
                            {d.hebrew && (
                                <Alert severity="warning">
                                    בברקוד הגיעו אותיות בעברית, והן הומרו לאנגלית לפי המקלדת. ייתכן שחלק מהפרטים השתבשו — השווה אותם לתעודה.
                                </Alert>
                            )}
                            {d.row.serialNumber && (
                                <Alert severity="info">
                                    בשורה יש מס׳ סריאלי — היא פריט אחד, ולכן מארז אחד. הסריאלי נשמר עם השורה; הסריאלי של כל פריט במארז נרשם בעמדת הפתיחה.
                                </Alert>
                            )}
                            <div className={d.manual ? "shp-form-grid" : "shp-form-grid shp-form-grid--3"}>
                                <SearchableCombobox<{ id: number; name: string }>
                                    label="סוג מארז"
                                    options={itemTypes}
                                    getOptionLabel={(option) => option.name}
                                    isOptionEqualToValue={(o, v) => o.id === v.id}
                                    value={itemTypes.find((t) => t.id === d.itemTypeId) || null}
                                    onChange={(t) => patchDraft(k, { itemTypeId: t?.id ?? null })}
                                    placeholder="בחר סוג מארז…"
                                />
                                <div>
                                    <FieldLabel htmlFor={`${fieldId}-draft-${k}-qty`}>כמות מארזים</FieldLabel>
                                    <TextField
                                        id={`${fieldId}-draft-${k}-qty`}
                                        type="number"
                                        size="small"
                                        fullWidth
                                        // A row with a serial is one unit: one box, nothing to change.
                                        disabled={!!d.row.serialNumber}
                                        value={d.quantity || ''}
                                        onChange={(e) => patchDraft(k, { quantity: e.target.value === '' ? 0 : Number(e.target.value), qtyTouched: true })}
                                        error={!(d.quantity >= 1)}
                                        helperText={!(d.quantity >= 1) ? (!d.manual && d.row.qtyToTest == null ? "בתעודה הכמות לבדיקה אינה מספר — הקלד את כמות המארזים" : "יש להזין כמות") : undefined}
                                        inputProps={{ min: 1, style: { fontVariantNumeric: "tabular-nums" } }}
                                    />
                                </div>
                                {!d.manual && <div>
                                    <FieldLabel htmlFor={`${fieldId}-draft-${k}-makat`}>מק״ט</FieldLabel>
                                    <TextField
                                        id={`${fieldId}-draft-${k}-makat`}
                                        size="small"
                                        fullWidth
                                        value={d.makat}
                                        onChange={(e) => patchDraft(k, { makat: e.target.value })}
                                        inputProps={{ dir: "ltr", style: { textAlign: "right" } }}
                                    />
                                </div>}
                            </div>
                        </div>
                    ))}
                    {drafts.length > 0 && (
                        <div style={{ fontSize: "var(--text-body-sm)", color: "var(--color-ink-muted-48)" }}>
                            אפשר לסרוק עוד שורות או להזין עוד שורה ידנית, ולאשר את כולן יחד. את סוג המארז אפשר לבחור גם אחר כך, בשורה עצמה — בלי סוג מארז המשלוח לא יישמר.
                        </div>
                    )}
                </div>
            </DialogContent>
            <DialogActions>
                <Button onClick={close} variant="outlined" color="inherit">ביטול</Button>
                <Button variant="contained" disabled={drafts.length === 0 || missingQty} onClick={confirm}>
                    {drafts.length > 1 ? `הוסף ${drafts.length} שורות למשלוח` : "הוסף למשלוח"}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
