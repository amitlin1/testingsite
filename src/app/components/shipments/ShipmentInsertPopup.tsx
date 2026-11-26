"use client";
import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
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
import { QrCodeScanner as QrCodeScannerIcon } from "@/components/ui/icons";
import { Lock as LockIcon } from "@/components/ui/icons";
import { useForm, Controller, useFieldArray, useWatch } from "react-hook-form";
import { NewShipment, Customers, POC_FORM_ALLOWED, SHIPMENT_CODE_MAX, duplicateKey, type DuplicateShipment } from "@/app/lib/shipments/contract";
import { BIG_SHIPMENT, declaredBoxes, lineIsEmpty, lineProblem, placeScannedLines, scannedRows, type ShipmentLine } from "@/app/lib/shipments/form";
import type { DirectoryWorker } from "@/lib/users/rules";
import SignatureCanvas from 'react-signature-canvas';
import { parseShipmentQr, isValidShipmentQr, convertQrDateToInputFormat, type ShipmentData } from '@/app/lib/qrParser';
import { fromHebrewLayout, hasHebrew, typeAsUsKeyboard } from '@/lib/scan/scannerKeys';
import { ApiError, sendJson } from "@/lib/api/client";
import { useIdleScan } from "@/lib/hooks/useIdleScan";
import { useCustomers, useItemTypeRows, useSources, useWorkersDirectory } from "@/app/components/lookups";
import { useShipmentWorker } from "./useShipmentWorker";
import SignaturePad from "@/components/SignaturePad";
import ShipmentLineScanDialog from "./ShipmentLineScanDialog";
import ShipmentDuplicateDialog, { duplicateOf } from "./ShipmentDuplicateDialog";
import { SHIPMENT_FORM_NO_ANSWER, ShipmentDateField, ShipmentLinesSection, WorkerField, WorkerUnknownAlert } from "./ShipmentFormFields";
import { failureText } from "@/app/components/failureText";

type ShipmentInsertPopupProps = {
    open: boolean;
    onClose: () => void;
    onCreated: () => void;
    /** The shipment already in the system with this certificate number and
     *  customer code, if any (from the list the host shows). */
    findExisting: (shipmentNumber: string, customerCode: string) => DuplicateShipment | null;
};

const NO_CUSTOMERS: Customers[] = [];
const NO_WORKERS: DirectoryWorker[] = [];
const NO_SOURCES: { id: number; desc: string }[] = [];

const defaultShipment: NewShipment = {
    shipment_code: "",
    customer_id: null,
    shipment_date: null,
    makat: null,
    amount: null,
    recieving_worker_id: null,
    source_id: null,
    sending_worker_id: null,
    poc_details: "",
};

export default function ShipmentInsertPopup({
    open,
    onClose,
    onCreated,
    findExisting,
}: ShipmentInsertPopupProps) {
    const customers = useCustomers().data ?? NO_CUSTOMERS;
    const workers = useWorkersDirectory().data ?? NO_WORKERS;
    const allTypes = useItemTypeRows().data;
    // Package types only (docs/features/packages/PLAN.md §9.10) — a shipment declares boxes.
    const itemTypes = useMemo(() => (allTypes ?? []).filter((t) => t.is_package === true), [allTypes]);
    const sources = useSources().data ?? NO_SOURCES;
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

    const [scannerOpen, setScannerOpen] = useState(false);
    const [scanError, setScanError] = useState<string | null>(null);
    const [manualBarcodeInput, setManualBarcodeInput] = useState('');
    const { schedule: scheduleScan, cancel: cancelScan } = useIdleScan();

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

    const closeScanner = () => {
        cancelScan();
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
        const pocOk = POC_FORM_ALLOWED.test(poc);
        const codeOk = code !== "" && code.length <= SHIPMENT_CODE_MAX;
        setLocked({ poc: pocOk && poc !== "", code: codeOk, customer: !!matchingCustomer });
        setScanProblems([
            ...(hebrew ? ["בברקוד הגיעו אותיות בעברית והן הומרו לאנגלית — בדוק שהפרטים תואמים לתעודה"] : []),
            ...(codeOk ? [] : [code.length > SHIPMENT_CODE_MAX ? `מס׳ המשלוח (ארוך מ-${SHIPMENT_CODE_MAX} תווים)` : "מס׳ המשלוח"]),
            ...(matchingCustomer ? [] : [`קוד הלקוח (${parsedData.customer.trim() || "ריק"} לא נמצא במערכת)`]),
            ...(convertedDate ? [] : ["תאריך המשלוח"]),
            ...(pocOk ? [] : ["פרטי איש הקשר (באנגלית בלבד)"]),
        ]);
        setScanned(true);
    }, [customers, setValue]);

    const handleQrScan = useCallback((decodedText: string) => {
        cancelScan();
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
        const existingMatch = findExisting(parsedData.shipmentNumber, parsedData.customer);
        if (existingMatch) {
            setScannedDuplicate({ existing: existingMatch, parsed: parsedData });
            return;
        }
        fillFromScan(parsedData, hasHebrew(decodedText));
    }, [cancelScan, findExisting, fillFromScan]);

    const addScannedLines = (lines: ShipmentLine[]) => {
        placeScannedLines(getValues('shipment_items'), lines, { update, append });
        // A row confirmed without a package type shows its error right away.
        void trigger('shipment_items');
    };

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
        return cancelScan;
    }, [open, reset, cancelScan]);

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
        try {
            const signature_base64 = sigCanvas.current && !sigCanvas.current.isEmpty() ? sigCanvas.current.toDataURL() : null;
            await sendJson("/api/shipments", "POST", {
                ...data,
                amount: totalAmount,
                shipment_date: data.shipment_date ? new Date(data.shipment_date).toISOString() : null,
                shipment_items: validItems,
                signature_base64,
                allow_duplicate: allowDuplicateRef.current === duplicateKey(data.shipment_code, data.customer_id),
            });
        } catch (error) {
            const existing = duplicateOf(error);
            if (existing) setDuplicate({ existing, parsed: null });
            else setSubmitError(failureText(error, "המשלוח לא נשמר. בדוק את הפרטים ונסה שוב.", SHIPMENT_FORM_NO_ANSWER));
            if (!(error instanceof ApiError)) console.error(error);
            return;
        }
        onCreated();
        onClose();
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
                                scheduleScan(() => {
                                    if (val.trim() && isValidShipmentQr(fromHebrewLayout(val.trim()))) handleQrScan(val.trim());
                                });
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    // Enter and the idle timer both read a scan; Enter
                                    // cancels the timer, or the scan is read twice.
                                    if (manualBarcodeInput.trim()) handleQrScan(manualBarcodeInput.trim());
                                    return;
                                }
                                // The scanner presses keys; on a Hebrew layout they would
                                // come out as Hebrew letters (lib/scan/scannerKeys.ts).
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

            {/* A flex column: the content scrolls, the buttons stay in view. */}
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
                    {receiver.blocked && <WorkerUnknownAlert />}
                    <div className="shp-form-grid">
                        <div className="shp-form-grid__full">
                            <FieldLabel htmlFor={`${fieldId}-poc`}>פרטי איש קשר (POC Details)</FieldLabel>
                            <Controller
                                name="poc_details"
                                control={control}
                                rules={{
                                    validate: (value) => (!value || POC_FORM_ALLOWED.test(value) ? true : "ניתן להזין באנגלית בלבד")
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
                                    maxLength: { value: SHIPMENT_CODE_MAX, message: `מקסימום ${SHIPMENT_CODE_MAX} תווים` },
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
                                        inputProps={{ maxLength: SHIPMENT_CODE_MAX, dir: "ltr", style: { textAlign: "right" } }}
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
                        <Controller
                            name="recieving_worker_id"
                            control={control}
                            render={({ field: { onChange, value } }) => (
                                <WorkerField
                                    label="עובד מקבל"
                                    options={receiver.options}
                                    workers={workers}
                                    value={value}
                                    onChange={(worker) => {
                                        onChange(worker?.worker_id ?? null);
                                        setValue("recieving_worker_name", worker?.worker_name ?? null);
                                    }}
                                    locked={receiver.locked}
                                    helper={receiver.locked && !receiver.blocked ? "מזוהה מההתחברות" : null}
                                />
                            )}
                        />
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
                        <ShipmentDateField control={control} fieldId={fieldId} errors={errors} disabled={scannedDate} />
                    </div>

                    <ShipmentLinesSection
                        control={control}
                        errors={errors}
                        fields={fields}
                        lines={shipmentItems}
                        itemTypes={itemTypes}
                        total={total}
                        onScan={() => setLineScanOpen(true)}
                        append={append}
                        remove={remove}
                    />
                    <div style={{ marginTop: "var(--space-md)", borderTop: "1px solid var(--color-hairline)", paddingTop: "var(--space-sm)" }}>
                        <SignaturePad
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
