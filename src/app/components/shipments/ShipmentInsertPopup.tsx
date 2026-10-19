"use client";
import React, { useEffect, useState, useRef, useCallback } from "react";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    IconButton,
    Alert
} from "@/components/ui";
import SearchableCombobox from "../common/SearchableCombobox";
import FieldLabel from "../common/FieldLabel";
import { QrCodeScanner as QrCodeScannerIcon } from "@/components/ui/icons";
import { Lock as LockIcon } from "@/components/ui/icons";
import { Add as AddIcon, Delete as DeleteIcon } from "@/components/ui/icons";
import { useForm, Controller, useFieldArray } from "react-hook-form";
import { NewShipment, Customers, Shipment } from "@/types";
import SignatureCanvas from 'react-signature-canvas';
import { parseShipmentQr, isValidShipmentQr, convertQrDateToInputFormat } from '@/app/lib/qrParser';
import { fromHebrewLayout, typeAsUsKeyboard } from '@/app/lib/scannerKeys';
import { parseItemQr, type ParsedItemData } from '@/app/lib/itemQrParser';
import { formatDate } from "@/app/lib/datetime";
import { apiFetch } from "@/lib/api/client";
import { useShipmentWorker } from "@/lib/hooks/useShipmentWorker";
import ShipmentSignatureField from "./ShipmentSignatureField";
import { serverErrorMessage, NETWORK_ERROR } from "./serverError";

type ShipmentInsertPopupProps = {
    open: boolean;
    onClose: () => void;
    onCreate: (success: boolean) => void;
    existingShipments?: Shipment[];
};

// POC details are English only. The certificate tool (shipment-QR_CODE-)
// lets English letters, digits and contact punctuation into the POC, so
// everything it can put in the barcode passes here too.
const POC_ALLOWED = /^[A-Za-z0-9\s.,!?'()/@&+-]*$/;

/**
 * A row of the certificate's equipment table, scanned into "מארזים במשלוח"
 * and waiting for the worker's OK. Everything it can fill is filled and
 * editable; the package type stays the worker's choice. A row with a serial
 * is one unit, so one box — the serial itself belongs to the intake.
 */
type LineDraft = { row: ParsedItemData; quantity: number; makat: string; itemTypeId: number | null };

/** Under a line that came from the certificate: "מהתעודה · שורה 2 · SONY 145DL · מק״ט 16321545 · הזמנה PO-778". */
function certSummary(row: ParsedItemData, makat: string | null | undefined): string {
    return [
        "מהתעודה",
        `שורה ${row.rowNum}`,
        [row.manufacturer, row.model].filter(Boolean).join(" "),
        makat ? `מק״ט ${makat}` : "",
        row.purchaseOrder ? `הזמנה ${row.purchaseOrder}` : "",
    ].filter(Boolean).join(" · ");
}

const defaultShipment: NewShipment = {
    shipment_code: "",
    customer_id: null,
    shipment_date: null,
    makat: null,
    amount: null,
    recieving_worker_id: null,
    item_type_id: null,
    source_id: null,
    sending_worker_id: null,
    poc_details: "",
};

export default function ShipmentInsertPopup({
    open,
    onClose,
    onCreate,
    existingShipments = [],
}: ShipmentInsertPopupProps) {
    const [customers, setCustomers] = useState<Customers[]>([]);
    const [workers, setWorkers] = useState<{ worker_id: number; worker_name: string; roles: string[] }[]>([]);
    // Package types only (docs/packages/PLAN.md §9.10) — a shipment declares boxes.
    const [itemTypes, setItemTypes] = useState<{ id: number; name: string; is_package?: boolean }[]>([]);
    const [sources, setSources] = useState<{ id: number; desc: string }[]>([]);
    const fieldId = React.useId();

    // "עובד מקבל" is the logged-in worker; only a manager may pick someone
    // else (useShipmentWorker — the server applies the same rule).
    const receiver = useShipmentWorker(workers);

    const {
        control,
        handleSubmit,
        reset,
        watch,
        setValue,
        getValues,
        formState: { errors, isValid, isSubmitting },
    } = useForm<NewShipment>({
        mode: "onChange",
        defaultValues: { ...defaultShipment, shipment_items: [{ item_type_id: 0, quantity: 0 }] }, // Start with one row
    });

    const { fields, append, remove, update } = useFieldArray({
        control,
        name: "shipment_items"
    });

    const sigCanvas = React.useRef<SignatureCanvas>(null);

    // A refused save keeps the dialog — and the typed form and the signature —
    // open, with the server's reason above the buttons.
    const [submitError, setSubmitError] = useState<string | null>(null);

    // Scanner state
    const [scannerOpen, setScannerOpen] = useState(false);
    const [scanError, setScanError] = useState<string | null>(null);
    const [manualBarcodeInput, setManualBarcodeInput] = useState('');
    const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // When a shipment is filled from a scanned barcode its details are locked for
    // manual editing — only the fields the barcode does not provide stay editable.
    const [scanned, setScanned] = useState(false);
    // Each barcode field locks only when the barcode gave a value the form
    // accepts: a refused value in a locked field would leave no way to save.
    const [locked, setLocked] = useState({ poc: false, code: false, customer: false });
    // Fields the barcode brought but the form could not take, for the banner.
    const [scanProblems, setScanProblems] = useState<string[]>([]);
    // The date is locked only when the barcode actually supplied a valid one.
    const [scannedDate, setScannedDate] = useState(false);

    // Scanning certificate rows into the package lines.
    const [lineScanOpen, setLineScanOpen] = useState(false);
    const [lineScanInput, setLineScanInput] = useState('');
    const [lineScanError, setLineScanError] = useState<string | null>(null);
    const [lineDrafts, setLineDrafts] = useState<LineDraft[]>([]);
    const lineScanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Alongside `fields`, index for index: the certificate row a line came
    // from, or null for a line added by hand.
    const [lineCerts, setLineCerts] = useState<(ParsedItemData | null)[]>([null]);

    // Duplicate-shipment dialog (shown when a scanned shipment already exists).
    const [duplicate, setDuplicate] = useState<Shipment | null>(null);

    const [isSigned, setIsSigned] = useState(false);

    const closeScanner = () => {
        setScannerOpen(false);
        setScanError(null);
        setManualBarcodeInput('');
    };

    // Handle QR scan result
    const handleQrScan = useCallback((decodedText: string) => {
        // The scan field reads physical keys; text that still went through a
        // Hebrew layout (pasted, say) is turned back the same way.
        const parsedData = parseShipmentQr(fromHebrewLayout(decodedText));

        if (!parsedData) {
            setScanError('פורמט QR לא תקין');
            return;
        }

        // Guard against scanning a shipment that is already in the system with the
        // same identifying details (shipment number + customer).
        const existingMatch = existingShipments.find(
            (s) =>
                s.shipment_code?.trim() === parsedData.shipmentNumber.trim() &&
                s.customer_code?.trim() === parsedData.customer.trim()
        );
        if (existingMatch) {
            setDuplicate(existingMatch);
            setScanError(null);
            setScannerOpen(false);
            setManualBarcodeInput('');
            return;
        }

        // Fill shipment number
        const code = parsedData.shipmentNumber.trim();
        setValue('shipment_code', code, { shouldValidate: true });

        // Find and set customer by customer_code
        const matchingCustomer = customers.find(
            c => c.customer_code?.trim() === parsedData.customer.trim()
        );
        if (matchingCustomer) {
            setValue('customer_id', matchingCustomer.id, { shouldValidate: true });
        }

        // Set POC details
        const poc = parsedData.poc.trim();
        if (poc) {
            setValue('poc_details', poc, { shouldValidate: true });
        }

        // Convert and set shipment date
        const convertedDate = convertQrDateToInputFormat(parsedData.supplyDate);
        if (convertedDate) {
            setValue('shipment_date', new Date(convertedDate), { shouldValidate: true });
        }
        setScannedDate(!!convertedDate);

        // Lock the barcode-derived fields against manual editing — each only
        // when its value is one the form accepts.
        const pocOk = POC_ALLOWED.test(poc);
        const codeOk = code !== "" && code.length <= 20 && !existingShipments.some((s) => s.shipment_code?.trim() === code);
        setLocked({ poc: pocOk, code: codeOk, customer: !!matchingCustomer });
        setScanProblems([
            ...(codeOk ? [] : ["מס׳ המשלוח"]),
            ...(matchingCustomer ? [] : [`קוד הלקוח (${parsedData.customer.trim() || "ריק"} לא נמצא במערכת)`]),
            ...(convertedDate ? [] : ["תאריך המשלוח"]),
            ...(pocOk ? [] : ["פרטי איש הקשר (באנגלית בלבד)"]),
        ]);
        setScanned(true);
        setScanError(null);
        setScannerOpen(false);
    }, [customers, setValue, existingShipments]);

    const closeLineScan = () => {
        setLineScanOpen(false);
        setLineScanInput('');
        setLineScanError(null);
        setLineDrafts([]);
    };

    // A scanned equipment barcode becomes drafts to confirm. A row already
    // on the shipment or already waiting is not added twice.
    const readLineScan = (text: string) => {
        // Enter and the idle timer both read a scan; whichever comes first
        // cancels the other, or the row would be read twice.
        if (lineScanTimeoutRef.current) clearTimeout(lineScanTimeoutRef.current);
        const value = fromHebrewLayout(text).trim();
        setLineScanInput('');
        if (isValidShipmentQr(value)) {
            setLineScanError('זה ברקוד המשלוח — הוא נסרק ב"סרוק ברקוד" שבראש החלון. כאן סורקים את ברקוד השורה מטבלת הציוד.');
            return;
        }
        const rows = parseItemQr(value);
        if (!rows) {
            setLineScanError('זה לא ברקוד של שורה מטבלת הציוד בתעודת המשלוח.');
            return;
        }
        const seen = new Set([...lineCerts, ...lineDrafts.map((d) => d.row)].flatMap((r) => (r ? [r.raw] : [])));
        const fresh = rows.filter((r) => !seen.has(r.raw));
        if (fresh.length === 0) {
            setLineScanError(`שורה ${rows[0].rowNum} בתעודה כבר נסרקה למשלוח הזה.`);
            return;
        }
        setLineScanError(null);
        setLineDrafts((d) => d.concat(fresh.map((row) => ({
            row,
            quantity: row.serialNumber ? 1 : row.qtyToTest,
            makat: row.makat,
            itemTypeId: null,
        }))));
    };

    const patchDraft = (k: number, patch: Partial<LineDraft>) =>
        setLineDrafts((d) => d.map((x, j) => (j === k ? { ...x, ...patch } : x)));

    // The confirmed drafts become package lines; an untouched empty line (the
    // form starts with one) takes the first instead of staying blank above it.
    const confirmLineDrafts = () => {
        const items = getValues('shipment_items') ?? [];
        const certs = lineCerts.slice();
        let drafts = lineDrafts;
        const lastIdx = items.length - 1;
        const last = items[lastIdx];
        if (last && !last.item_type_id && !last.quantity && drafts.length > 0) {
            const [first, ...rest] = drafts;
            update(lastIdx, { item_type_id: first.itemTypeId ?? 0, quantity: first.quantity, makat: first.makat.trim() || null });
            certs[lastIdx] = first.row;
            drafts = rest;
        }
        for (const d of drafts) {
            append({ item_type_id: d.itemTypeId ?? 0, quantity: d.quantity, makat: d.makat.trim() || null });
            certs.push(d.row);
        }
        setLineCerts(certs);
        closeLineScan();
    };

    // Auto-calculate total amount
    const shipmentItems = watch("shipment_items");
    useEffect(() => {
        const total = shipmentItems?.reduce((sum, item) => sum + (Number(item?.quantity) || 0), 0) || 0;
        setValue("amount", total);
    }, [shipmentItems, setValue]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [custRes, workersRes, typesRes, sourcesRes] = await Promise.all([
                    apiFetch("/api/customers"),
                    apiFetch("/api/workers-directory"),
                    apiFetch("/api/item-types"),
                    apiFetch("/api/sources")
                ]);
                const custData = await custRes.json();
                const workersData = await workersRes.json();
                const typesData = await typesRes.json();
                const sourcesData = await sourcesRes.json();

                if (!cancelled) {
                    setCustomers(Array.isArray(custData) ? custData : []);
                    setWorkers(Array.isArray(workersData) ? workersData : []);
                    setItemTypes((Array.isArray(typesData) ? typesData : []).filter((t: { is_package?: boolean }) => t.is_package === true));
                    const loadedSources = Array.isArray(sourcesData) ? sourcesData : [];
                    setSources(loadedSources);

                    // Default source to ID 1 if exists
                    if (loadedSources.find((s: any) => s.id === 1)) {
                        setValue("source_id", 1);
                    }
                }
            } catch (error) {
                console.error("Error loading data:", error);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [setValue]);

    useEffect(() => {
        if (open) {
            reset({ ...defaultShipment, source_id: 1, shipment_items: [{ item_type_id: 0, quantity: 0 }] });
            setScanned(false);
            setScannedDate(false);
            setLocked({ poc: false, code: false, customer: false });
            setScanProblems([]);
            setLineCerts([null]);
            setLineDrafts([]);
            setLineScanOpen(false);
            setDuplicate(null);
            setIsSigned(false);
            setSubmitError(null);
            sigCanvas.current?.clear();
        }
    }, [open, reset]);

    // Every new shipment starts from the logged-in worker (a manager may change it).
    useEffect(() => {
        if (!open || receiver.selfId == null) return;
        setValue("recieving_worker_id", receiver.selfId);
        setValue("recieving_worker_name", receiver.selfName);
    }, [open, receiver.selfId, receiver.selfName, setValue]);

    const onSubmit = async (data: NewShipment) => {
        setSubmitError(null);
        // The dialog closes only once the server has accepted the shipment; a
        // refusal keeps the typed form and the signature, with the reason shown.
        let saved = false;
        try {
            // Filter out empty rows
            const validItems = data.shipment_items?.filter(i => i.item_type_id && i.quantity > 0) || [];

            // Recalculate total amount
            const totalAmount = validItems.reduce((sum, item) => sum + (Number(item?.quantity) || 0), 0);

            const signature_base64 = sigCanvas.current && !sigCanvas.current.isEmpty() ? sigCanvas.current.toDataURL() : null;

            const payload = {
                ...data,
                amount: totalAmount,
                shipment_date: data.shipment_date ? new Date(data.shipment_date).toISOString() : null,
                shipment_items: validItems,
                // Legacy support: set main item_type_id to the first item's type (or null)
                item_type_id: validItems[0]?.item_type_id || null,
                signature_base64
            };

            const res = await apiFetch("/api/shipments", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            if (res.ok) {
                saved = true;
            } else {
                setSubmitError(await serverErrorMessage(res, "המשלוח לא נשמר. בדוק את הפרטים ונסה שוב."));
            }
        } catch (error) {
            console.error(error);
            setSubmitError(NETWORK_ERROR);
        } finally {
            if (saved) {
                onCreate(true);
                onClose();
            }
        }
    };

    return (
        <Dialog
            open={open}
            onClose={onClose}
            fullWidth
            maxWidth="md"
        >
            <DialogTitle onClose={onClose}>
                <span style={{ flex: 1, minWidth: 0 }}>הוספת משלוח חדש</span>
                <Button
                    size="small"
                    startIcon={<QrCodeScannerIcon fontSize={16} />}
                    title="סרוק ברקוד למילוי אוטומטי"
                    onClick={() => setScannerOpen(true)}
                >
                    סרוק ברקוד
                </Button>
            </DialogTitle>

            {/* QR Scanner Modal */}
            <Dialog
                open={scannerOpen}
                onClose={closeScanner}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle onClose={closeScanner}>סריקת ברקוד</DialogTitle>
                <DialogContent>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: "var(--space-lg)", paddingBlock: "var(--space-md)" }}>
                        {scanError && (
                            <Alert severity="error" sx={{ width: '100%' }}>
                                {scanError}
                            </Alert>
                        )}
                        <QrCodeScannerIcon fontSize={64} aria-hidden style={{ color: "var(--color-ink-muted-48)" }} />
                        <p style={{ margin: 0, fontSize: "var(--text-lead)", fontWeight: 600, textAlign: "center" }}>
                            נא לסרוק את הברקוד כעת
                        </p>
                        <TextField
                            autoFocus
                            fullWidth
                            placeholder="המתנה לסריקה... או הזן ידנית"
                            aria-label="ברקוד המשלוח"
                            value={manualBarcodeInput}
                            onChange={(e) => {
                                const val = e.target.value;
                                setManualBarcodeInput(val);
                                if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
                                scanTimeoutRef.current = setTimeout(() => {
                                    if (val.trim() && isValidShipmentQr(val.trim())) {
                                        handleQrScan(val.trim());
                                        setManualBarcodeInput('');
                                    }
                                }, 300);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    if (manualBarcodeInput.trim()) {
                                        handleQrScan(manualBarcodeInput.trim());
                                        setManualBarcodeInput('');
                                    }
                                    return;
                                }
                                // The scanner presses keys; on a Hebrew layout they would
                                // come out as Hebrew letters (lib/scannerKeys.ts).
                                typeAsUsKeyboard(e);
                            }}
                            // A barcode is a code: typed left to right.
                            inputProps={{ dir: "ltr", style: { textAlign: "center", fontSize: "var(--text-lead)" } }}
                        />
                        <Button
                            variant="contained"
                            fullWidth
                            onClick={() => {
                                if (manualBarcodeInput.trim()) {
                                    handleQrScan(manualBarcodeInput.trim());
                                    setManualBarcodeInput('');
                                }
                            }}
                            disabled={!manualBarcodeInput.trim()}
                        >
                            אישור
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Duplicate shipment dialog — the scanned shipment is already in the system */}
            <Dialog
                open={!!duplicate}
                onClose={() => setDuplicate(null)}
                fullWidth
                maxWidth="xs"
            >
                <DialogTitle onClose={() => setDuplicate(null)}>המשלוח כבר קיים במערכת</DialogTitle>
                <DialogContent>
                    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
                        <Alert severity="error">
                            לא ניתן לקלוט את המשלוח — קיים כבר משלוח עם אותם הפרטים.
                        </Alert>
                        {duplicate && (
                            <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 12px", fontSize: "var(--text-body-sm)" }}>
                                <dt style={{ color: "var(--color-ink-muted-48)" }}>מס׳ משלוח</dt>
                                <dd style={{ margin: 0, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{duplicate.shipment_code}</dd>
                                <dt style={{ color: "var(--color-ink-muted-48)" }}>קוד לקוח</dt>
                                <dd style={{ margin: 0, fontWeight: 600 }}>{duplicate.customer_code}</dd>
                                <dt style={{ color: "var(--color-ink-muted-48)" }}>תאריך קבלה</dt>
                                <dd style={{ margin: 0, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{formatDate(duplicate.shipment_date)}</dd>
                            </dl>
                        )}
                    </div>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDuplicate(null)}>
                        אישור
                    </Button>
                </DialogActions>
            </Dialog>

            {/* A certificate row → a package line: scan, look it over, confirm. */}
            <Dialog open={lineScanOpen} onClose={closeLineScan} fullWidth maxWidth="sm">
                <DialogTitle onClose={closeLineScan}>סריקת שורה מתעודת המשלוח</DialogTitle>
                <DialogContent>
                    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
                        {lineScanError && <Alert severity="error">{lineScanError}</Alert>}
                        <TextField
                            autoFocus
                            fullWidth
                            placeholder="סרוק את ה-QR של השורה בטבלת הציוד…"
                            aria-label="ברקוד שורת הציוד"
                            value={lineScanInput}
                            onChange={(e) => {
                                const val = e.target.value;
                                setLineScanInput(val);
                                if (lineScanTimeoutRef.current) clearTimeout(lineScanTimeoutRef.current);
                                lineScanTimeoutRef.current = setTimeout(() => {
                                    if (parseItemQr(fromHebrewLayout(val))) readLineScan(val);
                                }, 300);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    if (lineScanInput.trim()) readLineScan(lineScanInput);
                                    return;
                                }
                                typeAsUsKeyboard(e);
                            }}
                            inputProps={{ dir: "ltr", style: { textAlign: "center" } }}
                        />
                        {lineDrafts.map((d, k) => (
                            <div key={d.row.raw} style={{ border: "1px solid var(--color-hairline)", borderRadius: "var(--r-md)", padding: "var(--space-md)", display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
                                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--space-sm)" }}>
                                    <div style={{ fontWeight: 600 }}>שורה {d.row.rowNum} בתעודה</div>
                                    <Button size="small" color="inherit" onClick={() => setLineDrafts((x) => x.filter((_, j) => j !== k))}>הסר</Button>
                                </div>
                                <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr auto 1fr", gap: "4px 12px", fontSize: "var(--text-body-sm)" }}>
                                    {([
                                        ["מס׳ יצרן", d.row.manufacturerNo],
                                        ["שם יצרן", d.row.manufacturer],
                                        ["גרסת הציוד", d.row.model],
                                        ["מק״ט צה״לי", d.row.makat],
                                        ["מס׳ סריאלי", d.row.serialNumber],
                                        ["גודל אצווה", d.row.batchSize],
                                        ["כמות לבדיקה", String(d.row.qtyToTest)],
                                        ["הזמנת רכש", d.row.purchaseOrder],
                                    ] as const).map(([label, value]) => (
                                        <React.Fragment key={label}>
                                            <dt style={{ color: "var(--color-ink-muted-48)" }}>{label}</dt>
                                            <dd style={{ margin: 0, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}><bdi>{value || "—"}</bdi></dd>
                                        </React.Fragment>
                                    ))}
                                </dl>
                                {d.row.serialNumber && (
                                    <Alert severity="info">
                                        בשורה יש מס׳ סריאלי — היא פריט אחד, ולכן מארז אחד. הסריאלי לא נשמר במשלוח; הוא נקלט בקליטת המארז.
                                    </Alert>
                                )}
                                <div className="shp-form-grid shp-form-grid--3">
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
                                            value={d.quantity || ''}
                                            onChange={(e) => patchDraft(k, { quantity: e.target.value === '' ? 0 : Number(e.target.value) })}
                                            inputProps={{ min: 1, style: { fontVariantNumeric: "tabular-nums" } }}
                                        />
                                    </div>
                                    <div>
                                        <FieldLabel htmlFor={`${fieldId}-draft-${k}-makat`}>מק״ט</FieldLabel>
                                        <TextField
                                            id={`${fieldId}-draft-${k}-makat`}
                                            size="small"
                                            fullWidth
                                            value={d.makat}
                                            onChange={(e) => patchDraft(k, { makat: e.target.value })}
                                            inputProps={{ dir: "ltr", style: { textAlign: "right" } }}
                                        />
                                    </div>
                                </div>
                            </div>
                        ))}
                        {lineDrafts.length > 0 && (
                            <div style={{ fontSize: "var(--text-body-sm)", color: "var(--color-ink-muted-48)" }}>
                                אפשר לסרוק עוד שורות ולאשר את כולן יחד. את סוג המארז אפשר לבחור גם אחר כך, בשורה עצמה.
                            </div>
                        )}
                    </div>
                </DialogContent>
                <DialogActions>
                    <Button onClick={closeLineScan} variant="outlined" color="inherit">ביטול</Button>
                    <Button variant="contained" disabled={lineDrafts.length === 0} onClick={confirmLineDrafts}>
                        {lineDrafts.length > 1 ? `הוסף ${lineDrafts.length} שורות למשלוח` : "הוסף למשלוח"}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* ה-form חייב להיות flex column כדי ש-DialogContent יגלול והכפתורים יישארו גלויים */}
            <form
                onSubmit={handleSubmit(onSubmit)}
                noValidate
                style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}
            >
                <DialogContent>
                    {scanned && (
                        <Alert
                            severity="info"
                            icon={<LockIcon fontSize={18} />}
                            sx={{ mb: 2 }}
                        >
                            הנתונים מולאו מסריקת ברקוד ונעולים לעריכה. ניתן להזין ידנית רק את שדות המארזים שאינם כלולים בברקוד.
                        </Alert>
                    )}
                    {scanned && scanProblems.length > 0 && (
                        <Alert severity="warning" sx={{ mb: 2 }}>
                            מהברקוד לא הגיעו תקינים: {scanProblems.join(" · ")}. השדות האלה נשארו פתוחים — יש לתקן אותם ידנית.
                        </Alert>
                    )}
                    {receiver.blocked && (
                        <Alert severity="error" sx={{ mb: 2 }}>
                            לא ניתן לזהות אותך — לחשבון שלך אין מספר עובד מוגדר. פנה למנהל להוספתו בהגדרות משתמשים.
                        </Alert>
                    )}
                    <div className="shp-form-grid">
                        <div className="shp-form-grid__full">
                            <FieldLabel htmlFor={`${fieldId}-poc`}>פרטי איש קשר (POC Details)</FieldLabel>
                            <Controller
                                name="poc_details"
                                control={control}
                                rules={{
                                    validate: (value) => (!value || POC_ALLOWED.test(value) ? true : "ניתן להזין באנגלית בלבד")
                                }}
                                render={({ field, fieldState: { error } }) => (
                                    <TextField
                                        {...field}
                                        id={`${fieldId}-poc`}
                                        placeholder="פרטי איש קשר"
                                        fullWidth
                                        size="small"
                                        multiline
                                        rows={2}
                                        disabled={locked.poc}
                                        error={!!error}
                                        helperText={error?.message}
                                    />
                                )}
                            />
                        </div>
                        <div>
                            <FieldLabel required htmlFor={`${fieldId}-code`}>מס&apos; משלוח</FieldLabel>
                            <Controller
                                name="shipment_code"
                                control={control}
                                rules={{
                                    required: "שדה חובה",
                                    maxLength: { value: 20, message: "מקסימום 20 תווים" },
                                    validate: (value) => {
                                        const isExists = existingShipments.some(
                                            (s) => s.shipment_code?.trim() === value.trim()
                                        );
                                        return isExists ? "משלוח עם מספר זה כבר קיים במערכת" : true;
                                    }
                                }}
                                render={({ field, fieldState: { error } }) => (
                                    <TextField
                                        {...field}
                                        id={`${fieldId}-code`}
                                        placeholder="מס' משלוח"
                                        fullWidth
                                        size="small"
                                        disabled={locked.code}
                                        error={!!error}
                                        helperText={error?.message}
                                        // A code reads left to right; aligned with the Hebrew fields.
                                        inputProps={{ maxLength: 20, dir: "ltr", style: { textAlign: "right" } }}
                                    />
                                )}
                            />
                        </div>
                        <div>
                            <Controller
                                name="customer_id"
                                control={control}
                                rules={{ required: "שדה חובה" }}
                                render={({ field: { onChange, value } }) => (
                                    <SearchableCombobox<Customers>
                                        label="קוד לקוח"
                                        required
                                        options={customers}
                                        disabled={locked.customer}
                                        getOptionLabel={(option) => option.customer_code}
                                        isOptionEqualToValue={(o, v) => o.id === v.id}
                                        value={customers.find((c) => c.id === value) || null}
                                        onChange={(newValue) => onChange(newValue?.id ?? null)}
                                        placeholder="בחר לקוח…"
                                        error={!!errors.customer_id}
                                        helperText={errors.customer_id?.message}
                                    />
                                )}
                            />
                        </div>
                        <div>
                            <Controller
                                name="recieving_worker_id"
                                control={control}
                                render={({ field: { onChange, value } }) => (
                                    <SearchableCombobox<{ worker_id: number; worker_name: string; roles: string[] }>
                                        label="עובד מקבל"
                                        options={receiver.options}
                                        getOptionLabel={(option) => option.worker_name}
                                        isOptionEqualToValue={(o, v) => o.worker_id === v.worker_id}
                                        value={workers.find((w) => w.worker_id === value) || null}
                                        onChange={(newValue) => {
                                            onChange(newValue?.worker_id ?? null);
                                            setValue("recieving_worker_name", newValue?.worker_name ?? null);
                                        }}
                                        // Not from the barcode, so a scan doesn't lock it — only the role does.
                                        disabled={receiver.locked}
                                        placeholder={receiver.locked ? "מזוהה מההתחברות" : "בחר עובד…"}
                                        error={!!errors.recieving_worker_id}
                                        helperText={errors.recieving_worker_id?.message}
                                    />
                                )}
                            />
                            {receiver.locked && !receiver.blocked && <div className="sh-field-helper">מזוהה מההתחברות</div>}
                        </div>
                        <div>
                            <Controller
                                name="source_id"
                                control={control}
                                rules={{ required: "חובה לבחור מקור" }}
                                render={({ field: { onChange, value } }) => (
                                    <SearchableCombobox<{ id: number; desc: string }>
                                        label="מקור"
                                        required
                                        options={sources}
                                        getOptionLabel={(option) => option.desc}
                                        isOptionEqualToValue={(o, v) => o.id === v.id}
                                        value={sources.find((s) => s.id === value) || null}
                                        onChange={(newValue) => onChange(newValue?.id ?? null)}
                                        placeholder="בחר מקור…"
                                        error={!!errors.source_id}
                                        helperText={errors.source_id?.message}
                                    />
                                )}
                            />
                        </div>
                        <div>
                            <FieldLabel required htmlFor={`${fieldId}-date`}>תאריך משלוח</FieldLabel>
                            <Controller
                                name="shipment_date"
                                control={control}
                                rules={{
                                    required: "שדה חובה",
                                }}
                                render={({ field: { onChange, value } }) => (
                                    <TextField
                                        id={`${fieldId}-date`}
                                        type="date"
                                        fullWidth
                                        size="small"
                                        disabled={scannedDate}
                                        value={value ? new Date(value).toISOString().split("T")[0] : ""}
                                        onChange={(e) => onChange(e.target.value ? new Date(e.target.value) : null)}
                                        error={!!errors.shipment_date}
                                        helperText={errors.shipment_date?.message}
                                    />
                                )}
                            />
                        </div>
                    </div>

                    {/* Dynamic Items Section */}
                    <div style={{ marginTop: "var(--space-lg)", borderTop: "1px solid var(--color-hairline)", paddingTop: "var(--space-md)" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-sm)", marginBottom: "var(--space-sm)" }}>
                            <div style={{ fontSize: "var(--text-body)", fontWeight: 600 }}>מארזים במשלוח</div>
                            <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>
                                <Button variant="outlined" size="small" startIcon={<QrCodeScannerIcon fontSize={16} aria-hidden />} onClick={() => setLineScanOpen(true)}>
                                    סרוק שורה מהתעודה
                                </Button>
                                <Button variant="outlined" size="small" startIcon={<AddIcon fontSize={16} aria-hidden />} onClick={() => { append({ item_type_id: 0, quantity: 0 }); setLineCerts((c) => c.concat([null])); }}>
                                    הוסף סוג מארז
                                </Button>
                            </div>
                        </div>
                        <div className="shp-items-head" aria-hidden>
                            <span>סוג מארז</span>
                            <span>כמות</span>
                            <span />
                        </div>
                        {fields.map((item, index) => (
                            <div key={item.id} className="shp-items-row">
                                <div style={{ minWidth: 0 }}>
                                    <Controller
                                        name={`shipment_items.${index}.item_type_id` as const}
                                        control={control}
                                        rules={{ required: true }}
                                        render={({ field: { onChange, value } }) => (
                                            <SearchableCombobox<{ id: number; name: string }>
                                                options={itemTypes}
                                                getOptionLabel={(option) => option.name}
                                                isOptionEqualToValue={(o, v) => o.id === v.id}
                                                value={itemTypes.find((t) => t.id === value) || null}
                                                onChange={(newValue) => onChange(newValue?.id ?? null)}
                                                placeholder="סוג מארז"
                                                error={!!errors.shipment_items?.[index]?.item_type_id}
                                            />
                                        )}
                                    />
                                    {lineCerts[index] && (
                                        <div className="shp-items-cert">{certSummary(lineCerts[index]!, watch(`shipment_items.${index}.makat`))}</div>
                                    )}
                                </div>

                                <Controller
                                    name={`shipment_items.${index}.quantity` as const}
                                    control={control}
                                    rules={{
                                        validate: (value) => {
                                            // Allow empty during input (value will be 0 or undefined)
                                            if (value === undefined || value === 0) return true;
                                            if (Number(value) < 1) return "מינימום 1";
                                            return true;
                                        }
                                    }}
                                    render={({ field }) => (
                                        <TextField
                                            {...field}
                                            placeholder="כמות"
                                            type="number"
                                            required
                                            size="small"
                                            fullWidth
                                            inputProps={{ "aria-label": `כמות, שורה ${index + 1}`, style: { fontVariantNumeric: "tabular-nums" } }}
                                            value={field.value === 0 ? '' : field.value ?? ''}
                                            onChange={(e) => field.onChange(e.target.value === '' ? 0 : Number(e.target.value))}
                                            error={!!errors.shipment_items?.[index]?.quantity}
                                            helperText={errors.shipment_items?.[index]?.quantity?.message}
                                        />
                                    )}
                                />
                                {fields.length > 1 ? (
                                    <IconButton size="small" color="error" title="הסר שורה" onClick={() => { remove(index); setLineCerts((c) => c.filter((_, j) => j !== index)); }}>
                                        <DeleteIcon fontSize={16} aria-hidden />
                                    </IconButton>
                                ) : <span />}
                            </div>
                        ))}
                    </div>
                    {/* Auto-calculated total = Σ quantities */}
                    <div style={{ marginTop: "var(--space-md)", display: 'flex', justifyContent: 'flex-end', fontSize: "var(--text-body-sm)", fontWeight: 600 }}>
                        <span>
                            סה״כ מארזים (מחושב): <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{watch("amount") || 0}</span>
                        </span>
                    </div>
                    {/* Signature — required; the hint says so without alarming */}
                    <div style={{ marginTop: "var(--space-md)", borderTop: "1px solid var(--color-hairline)", paddingTop: "var(--space-sm)" }}>
                        <ShipmentSignatureField
                            canvasRef={sigCanvas}
                            signed={isSigned}
                            onSignedChange={setIsSigned}
                            hint="יש לחתום לפני הוספת המשלוח"
                        />
                    </div>

                </DialogContent>
                {submitError && (
                    <div style={{ padding: "0 var(--space-lg) var(--space-sm)" }}>
                        <Alert severity="error">{submitError}</Alert>
                    </div>
                )}
                <DialogActions>
                    <Button onClick={onClose} variant="outlined" color="inherit">
                        ביטול
                    </Button>
                    <Button
                        type="submit"
                        // הכפתור יהיה חסום אם הטופס לא תקין, שעדיין לא חתמו, או שלא ניתן לזהות את המחסנאי
                        disabled={!isValid || !isSigned || receiver.blocked}
                        loading={isSubmitting}
                        variant="contained"
                    >
                        הוספה
                    </Button>
                </DialogActions>
            </form>
        </Dialog>
    );
}
