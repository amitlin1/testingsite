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
        formState: { errors, isValid, isSubmitting },
    } = useForm<NewShipment>({
        mode: "onChange",
        defaultValues: { ...defaultShipment, shipment_items: [{ item_type_id: 0, quantity: 0 }] }, // Start with one row
    });

    const { fields, append, remove } = useFieldArray({
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
    // The date is locked only when the barcode actually supplied a valid one.
    const [scannedDate, setScannedDate] = useState(false);

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
        const parsedData = parseShipmentQr(decodedText);

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
        setValue('shipment_code', parsedData.shipmentNumber);

        // Find and set customer by customer_code
        const matchingCustomer = customers.find(
            c => c.customer_code === parsedData.customer
        );
        if (matchingCustomer) {
            setValue('customer_id', matchingCustomer.id);
        }

        // Set POC details
        if (parsedData.poc) {
            setValue('poc_details', parsedData.poc);
        }

        // Convert and set shipment date
        const convertedDate = convertQrDateToInputFormat(parsedData.supplyDate);
        if (convertedDate) {
            setValue('shipment_date', new Date(convertedDate), { shouldValidate: true });
        }
        setScannedDate(!!convertedDate);

        // Lock the barcode-derived fields against manual editing.
        setScanned(true);
        setScanError(null);
        setScannerOpen(false);
    }, [customers, setValue, existingShipments]);

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
                                if (e.key === 'Enter' && manualBarcodeInput.trim()) {
                                    handleQrScan(manualBarcodeInput.trim());
                                    setManualBarcodeInput('');
                                }
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
                                    validate: (value) => {
                                        const englishOnlyRegex = /^[A-Za-z0-9\s\.,!\?'-]*$/;
                                        if (!value || englishOnlyRegex.test(value)) {
                                            return true;
                                        }
                                        return "ניתן להזין באנגלית בלבד";
                                    }
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
                                        disabled={scanned}
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
                                        disabled={scanned}
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
                                        disabled={scanned}
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
                            <Button variant="outlined" size="small" startIcon={<AddIcon fontSize={16} aria-hidden />} onClick={() => append({ item_type_id: 0, quantity: 0 })}>
                                הוסף סוג מארז
                            </Button>
                        </div>
                        <div className="shp-items-head" aria-hidden>
                            <span>סוג מארז</span>
                            <span>כמות</span>
                            <span />
                        </div>
                        {fields.map((item, index) => (
                            <div key={item.id} className="shp-items-row">
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
