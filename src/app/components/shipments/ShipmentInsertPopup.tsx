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
import { useForm, Controller, useFieldArray, useWatch } from "react-hook-form";
import { NewShipment, Customers, Shipment } from "@/types";
import SignatureCanvas from 'react-signature-canvas';
import { parseShipmentQr, isValidShipmentQr, convertQrDateToInputFormat, type ShipmentData } from '@/app/lib/qrParser';
import { fromHebrewLayout, hasHebrew, typeAsUsKeyboard } from '@/app/lib/scannerKeys';
import { apiFetch } from "@/lib/api/client";
import { useShipmentWorker } from "@/lib/hooks/useShipmentWorker";
import ShipmentSignatureField from "./ShipmentSignatureField";
import ShipmentLineScanDialog, { BIG_SHIPMENT, LineCertNote, declaredBoxes, lineIsEmpty, lineProblem, placeScannedLines, scannedRows, type ShipmentLine } from "./ShipmentLineScanDialog";
import ShipmentDuplicateDialog, { duplicateOf, type DuplicateShipment } from "./ShipmentDuplicateDialog";
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

/** The same certificate = the same shipment number and customer (the server's SHIPMENT_DUPLICATE rule). */
const sameCode = (a: string | null | undefined, b: string | null | undefined) =>
    (a ?? "").trim().toUpperCase() === (b ?? "").trim().toUpperCase();
const duplicateKey = (code: string | null | undefined, customerId: number | null | undefined) =>
    `${(code ?? "").trim().toUpperCase()}|${customerId ?? ""}`;

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
        setValue,
        getValues,
        trigger,
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

    // Scanning certificate rows into the package lines (ShipmentLineScanDialog).
    const [lineScanOpen, setLineScanOpen] = useState(false);

    // The same certificate is already in the system (a scan of it, or the
    // server's refusal of the save). `parsed` = the scan to fill if the worker
    // enters it anyway; null = the save to send again.
    const [duplicate, setDuplicate] = useState<{ existing: DuplicateShipment; parsed: ShipmentData | null } | null>(null);
    // A duplicate found by a scan opens once the scanner dialog has closed: the
    // scanner hands focus back to the form a tick after it unmounts, and a
    // dialog already open would read that as "focus left" and dismiss itself.
    const [scannedDuplicate, setScannedDuplicate] = useState<{ existing: DuplicateShipment; parsed: ShipmentData } | null>(null);
    useEffect(() => {
        if (scannerOpen || !scannedDuplicate) return;
        const t = setTimeout(() => { setDuplicate(scannedDuplicate); setScannedDuplicate(null); }, 0);
        return () => clearTimeout(t);
    }, [scannerOpen, scannedDuplicate]);
    // The certificate (number|customer) the worker chose to enter again; the
    // save carries allow_duplicate only while the form still holds it.
    const allowDuplicateRef = useRef<string | null>(null);

    // A save of more than BIG_SHIPMENT boxes asks once more (cleared when the count changes).
    const [confirmBig, setConfirmBig] = useState(false);

    const [isSigned, setIsSigned] = useState(false);

    const clearScanTimer = () => {
        if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
        scanTimeoutRef.current = null;
    };

    const closeScanner = () => {
        clearScanTimer();
        setScannerOpen(false);
        setScanError(null);
        setManualBarcodeInput('');
    };

    // Fills the form from a shipment barcode. Every field the barcode carries
    // is set again — a second scan must not leave the first one's customer or
    // POC behind.
    const fillFromScan = useCallback((parsedData: ShipmentData, hebrew: boolean) => {
        const code = parsedData.shipmentNumber.trim();
        setValue('shipment_code', code, { shouldValidate: true });

        const matchingCustomer = customers.find(
            c => c.customer_code?.trim() === parsedData.customer.trim()
        );
        setValue('customer_id', matchingCustomer?.id ?? null, { shouldValidate: true });

        const poc = parsedData.poc.trim();
        setValue('poc_details', poc, { shouldValidate: true });

        const convertedDate = convertQrDateToInputFormat(parsedData.supplyDate);
        setValue('shipment_date', convertedDate ? new Date(convertedDate) : null, { shouldValidate: true });
        setScannedDate(!!convertedDate);

        // Lock the barcode-derived fields against manual editing — each only
        // when the barcode gave a value the form accepts.
        const pocOk = POC_ALLOWED.test(poc);
        const codeOk = code !== "" && code.length <= 20;
        setLocked({ poc: pocOk && poc !== "", code: codeOk, customer: !!matchingCustomer });
        setScanProblems([
            ...(hebrew ? ["בברקוד הגיעו אותיות בעברית והן הומרו לאנגלית — בדוק שהפרטים תואמים לתעודה"] : []),
            ...(codeOk ? [] : [code.length > 20 ? "מס׳ המשלוח (ארוך מ-20 תווים)" : "מס׳ המשלוח"]),
            ...(matchingCustomer ? [] : [`קוד הלקוח (${parsedData.customer.trim() || "ריק"} לא נמצא במערכת)`]),
            ...(convertedDate ? [] : ["תאריך המשלוח"]),
            ...(pocOk ? [] : ["פרטי איש הקשר (באנגלית בלבד)"]),
        ]);
        setScanned(true);
    }, [customers, setValue]);

    // Handle QR scan result
    const handleQrScan = useCallback((decodedText: string) => {
        clearScanTimer();
        // The scan field reads physical keys; text that still went through a
        // Hebrew layout (pasted, say) is turned back the same way.
        const parsedData = parseShipmentQr(fromHebrewLayout(decodedText));

        if (!parsedData) {
            setScanError('פורמט QR לא תקין, או שהסריקה לא נקראה במלואה. סרוק שוב.');
            return;
        }
        setScanError(null);
        setScannerOpen(false);
        setManualBarcodeInput('');

        // The same certificate already in the system: say so, and let the
        // worker enter it anyway (a shipment can come again on it).
        const existingMatch = existingShipments.find(
            (s) => sameCode(s.shipment_code, parsedData.shipmentNumber) && s.customer_code?.trim() === parsedData.customer.trim()
        );
        if (existingMatch) {
            setScannedDuplicate({ existing: existingMatch, parsed: parsedData });
            return;
        }
        fillFromScan(parsedData, hasHebrew(decodedText));
    }, [existingShipments, fillFromScan]);

    const addScannedLines = (lines: ShipmentLine[]) => {
        placeScannedLines(getValues('shipment_items'), lines, { update, append });
        // A row confirmed without a package type shows its error right away.
        void trigger('shipment_items');
    };

    // The declared total = Σ quantities of the started lines.
    const shipmentItems = useWatch({ control, name: "shipment_items" });
    const shipmentCode = useWatch({ control, name: "shipment_code" });
    const total = declaredBoxes(shipmentItems);
    useEffect(() => {
        setValue("amount", total);
    }, [total, setValue]);
    // A changed count asks again: cleared during render.
    const [confirmedFor, setConfirmedFor] = useState(total);
    if (confirmedFor !== total) {
        setConfirmedFor(total);
        setConfirmBig(false);
    }

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

    // Every opening starts clean: the screen state during render, the form,
    // the ref and the signature pad in the effect below.
    const [wasOpen, setWasOpen] = useState(false);
    if (wasOpen !== open) {
        setWasOpen(open);
        if (open) {
            setScanned(false);
            setScannedDate(false);
            setLocked({ poc: false, code: false, customer: false });
            setScanProblems([]);
            setLineScanOpen(false);
            setDuplicate(null);
            setScannedDuplicate(null);
            setConfirmBig(false);
            setIsSigned(false);
            setSubmitError(null);
        }
    }
    useEffect(() => {
        if (open) {
            reset({ ...defaultShipment, source_id: 1, shipment_items: [{ item_type_id: 0, quantity: 0 }] });
            allowDuplicateRef.current = null;
            sigCanvas.current?.clear();
        }
        return () => {
            if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
        };
    }, [open, reset]);

    // Every new shipment starts from the logged-in worker (a manager may change it).
    useEffect(() => {
        if (!open || receiver.selfId == null) return;
        setValue("recieving_worker_id", receiver.selfId);
        setValue("recieving_worker_name", receiver.selfName);
    }, [open, receiver.selfId, receiver.selfName, setValue]);

    const onSubmit = async (data: NewShipment) => {
        setSubmitError(null);
        // A started line that is not whole stops the save — it is never
        // dropped quietly; only the untouched blank row is left out.
        const lines = data.shipment_items ?? [];
        const bad = lines.findIndex((l) => lineProblem(l) != null);
        if (bad >= 0) {
            setSubmitError(`שורה ${bad + 1}: ${lineProblem(lines[bad])}`);
            void trigger('shipment_items');
            return;
        }
        const validItems = lines.filter((l) => !lineIsEmpty(l));
        if (validItems.length === 0) {
            setSubmitError("יש להוסיף לפחות סוג מארז אחד עם כמות.");
            return;
        }
        const totalAmount = declaredBoxes(validItems);
        if (totalAmount > BIG_SHIPMENT && !confirmBig) {
            setConfirmBig(true);
            return;
        }

        // The dialog closes only once the server has accepted the shipment; a
        // refusal keeps the typed form and the signature, with the reason shown.
        let saved = false;
        try {
            const signature_base64 = sigCanvas.current && !sigCanvas.current.isEmpty() ? sigCanvas.current.toDataURL() : null;

            const payload = {
                ...data,
                amount: totalAmount,
                shipment_date: data.shipment_date ? new Date(data.shipment_date).toISOString() : null,
                shipment_items: validItems,
                // Legacy support: set main item_type_id to the first item's type (or null)
                item_type_id: validItems[0]?.item_type_id || null,
                signature_base64,
                allow_duplicate: allowDuplicateRef.current === duplicateKey(data.shipment_code, data.customer_id),
            };

            const res = await apiFetch("/api/shipments", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            if (res.ok) {
                saved = true;
            } else {
                const existing = await duplicateOf(res);
                if (existing) setDuplicate({ existing, parsed: null });
                else setSubmitError(await serverErrorMessage(res, "המשלוח לא נשמר. בדוק את הפרטים ונסה שוב."));
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

    // "הכנס בכל זאת": fill from the scan, or send the save again — either way
    // the save now carries allow_duplicate for this certificate.
    const enterDuplicateAnyway = () => {
        const d = duplicate;
        setDuplicate(null);
        if (!d) return;
        if (d.parsed) {
            const match = customers.find((c) => c.customer_code?.trim() === d.parsed!.customer.trim());
            allowDuplicateRef.current = duplicateKey(d.parsed.shipmentNumber, match?.id ?? null);
            fillFromScan(d.parsed, false);
        } else {
            allowDuplicateRef.current = duplicateKey(getValues("shipment_code"), getValues("customer_id"));
            void handleSubmit(onSubmit)();
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
                                clearScanTimer();
                                scanTimeoutRef.current = setTimeout(() => {
                                    if (val.trim() && isValidShipmentQr(fromHebrewLayout(val.trim()))) handleQrScan(val.trim());
                                }, 300);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    // Enter and the idle timer both read a scan; Enter
                                    // cancels the timer, or the scan is read twice.
                                    if (manualBarcodeInput.trim()) handleQrScan(manualBarcodeInput.trim());
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
                                if (manualBarcodeInput.trim()) handleQrScan(manualBarcodeInput.trim());
                            }}
                            disabled={!manualBarcodeInput.trim()}
                        >
                            אישור
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <ShipmentDuplicateDialog
                duplicate={duplicate?.existing ?? null}
                onCancel={() => setDuplicate(null)}
                onConfirm={enterDuplicateAnyway}
            />

            <ShipmentLineScanDialog
                open={lineScanOpen}
                onClose={() => setLineScanOpen(false)}
                itemTypes={itemTypes}
                takenRows={scannedRows(shipmentItems)}
                shipmentCode={shipmentCode}
                onConfirm={addScannedLines}
            />

            {/* ה-form חייב להיות flex column כדי ש-DialogContent יגלול והכפתורים יישארו גלויים */}
            <form
                onSubmit={(e) => handleSubmit(onSubmit)(e)}
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
                                <Button variant="outlined" size="small" startIcon={<AddIcon fontSize={16} aria-hidden />} onClick={() => append({ item_type_id: 0, quantity: 0 })}>
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
                                        rules={{
                                            // A started line needs its type; 0 is "none", not a type.
                                            validate: (_v, values) => {
                                                const line = values.shipment_items?.[index];
                                                return lineIsEmpty(line) || line?.item_type_id ? true : "יש לבחור סוג מארז";
                                            },
                                            deps: [`shipment_items.${index}.quantity`],
                                        }}
                                        render={({ field: { onChange, value } }) => (
                                            <SearchableCombobox<{ id: number; name: string }>
                                                options={itemTypes}
                                                getOptionLabel={(option) => option.name}
                                                isOptionEqualToValue={(o, v) => o.id === v.id}
                                                value={itemTypes.find((t) => t.id === value) || null}
                                                onChange={(newValue) => onChange(newValue?.id ?? 0)}
                                                placeholder="סוג מארז"
                                                error={!!errors.shipment_items?.[index]?.item_type_id}
                                                helperText={errors.shipment_items?.[index]?.item_type_id?.message}
                                            />
                                        )}
                                    />
                                    <LineCertNote line={shipmentItems?.[index]} />
                                </div>

                                <Controller
                                    name={`shipment_items.${index}.quantity` as const}
                                    control={control}
                                    rules={{
                                        validate: (_v, values) => {
                                            const line = values.shipment_items?.[index];
                                            if (lineIsEmpty(line)) return true;
                                            const qty = Number(line?.quantity);
                                            return Number.isInteger(qty) && qty >= 1 ? true : "מינימום 1";
                                        },
                                        deps: [`shipment_items.${index}.item_type_id`],
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
                                    <IconButton size="small" color="error" title="הסר שורה" onClick={() => remove(index)}>
                                        <DeleteIcon fontSize={16} aria-hidden />
                                    </IconButton>
                                ) : <span />}
                            </div>
                        ))}
                    </div>
                    {/* Auto-calculated total = Σ quantities */}
                    <div style={{ marginTop: "var(--space-md)", display: 'flex', justifyContent: 'flex-end', fontSize: "var(--text-body-sm)", fontWeight: 600 }}>
                        <span>
                            סה״כ מארזים (מחושב): <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{total}</span>
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
                {(submitError || confirmBig) && (
                    <div style={{ padding: "0 var(--space-lg) var(--space-sm)" }}>
                        {submitError ? (
                            <Alert severity="error">{submitError}</Alert>
                        ) : (
                            <Alert severity="warning">
                                המשלוח ייצור {total} מארזים ו-{total} מדבקות. אם הכמות נכונה, לחץ שוב על &quot;הוספה&quot;.
                            </Alert>
                        )}
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
