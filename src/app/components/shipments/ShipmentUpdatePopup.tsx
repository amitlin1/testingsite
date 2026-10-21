"use client";
import React, { useEffect, useState } from "react";
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
import { Add as AddIcon, Delete as DeleteIcon, QrCodeScanner as QrCodeScannerIcon } from "@/components/ui/icons";
import SearchableCombobox from "../common/SearchableCombobox";
import FieldLabel from "../common/FieldLabel";
import { useForm, Controller, useFieldArray } from "react-hook-form";
import { Shipment, NewShipment, Customers } from "@/types";
import { DISPLAY_TIMEZONE } from "@/app/lib/datetime";
import { apiFetch } from "@/lib/api/client";
import { useShipmentWorker } from "@/lib/hooks/useShipmentWorker";
import ShipmentLineScanDialog, { LineCertNote, placeScannedLines, scannedRows, type ShipmentLine } from "./ShipmentLineScanDialog";
import { serverErrorMessage, NETWORK_ERROR } from "./serverError";

type ShipmentUpdatePopupProps = {
    open: boolean;
    onClose: () => void;
    onUpdate: (success: boolean) => void;
    shipment: Shipment | null;
};

export default function ShipmentUpdatePopup({
    open,
    onClose,
    onUpdate,
    shipment,
}: ShipmentUpdatePopupProps) {
    const [customers, setCustomers] = useState<Customers[]>([]);
    const [workers, setWorkers] = useState<{ worker_id: number; worker_name: string; roles: string[] }[]>([]);
    // Package types only (docs/packages/PLAN.md §9.10) — a shipment declares boxes.
    const [itemTypes, setItemTypes] = useState<{ id: number; name: string; is_package?: boolean }[]>([]);
    const [sources, setSources] = useState<{ id: number; desc: string }[]>([]);
    const fieldId = React.useId();

    // A refused save (or a form with no package line) keeps the dialog open
    // with the reason above the buttons; nothing typed is lost.
    const [submitError, setSubmitError] = useState<string | null>(null);

    // "עובד מקבל" — same rule as ShipmentInsertPopup (useShipmentWorker): only
    // a manager may change it; the server applies the same rule.
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
    });

    const { fields, append, remove, update } = useFieldArray({
        control,
        name: "shipment_items"
    });

    // Scanning more certificate rows into the package lines — same dialog as
    // ShipmentInsertPopup. A row already on the shipment (saved with its
    // cert_row_raw) is not added twice.
    const [lineScanOpen, setLineScanOpen] = useState(false);
    const addScannedLines = (lines: ShipmentLine[]) =>
        placeScannedLines(getValues('shipment_items'), lines, { update, append });

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
                    setSources(Array.isArray(sourcesData) ? sourcesData : []);
                }
            } catch (error) {
                console.error("Error loading data:", error);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (open && shipment) {
            // Prepare initial shipment items. If new array exists use it, otherwise fallback to legacy single item type
            let initialItems = shipment.shipment_items || [];
            if (initialItems.length === 0 && shipment.item_type_id) {
                initialItems = [{
                    item_type_id: shipment.item_type_id,
                    quantity: shipment.amount || 0,
                    makat: shipment.makat
                }];
            }
            if (initialItems.length === 0) {
                initialItems = [{ item_type_id: 0, quantity: 0 }];
            }

            reset({
                shipment_code: shipment.shipment_code,
                customer_id: shipment.customer_id,
                shipment_date: new Date(shipment.shipment_date),
                shipment_items: initialItems,
                source_id: shipment.source_id,
                recieving_worker_id: shipment.recieving_worker_id,
                recieving_worker_name: shipment.recieving_worker_name,
            });
            setSubmitError(null);
            setLineScanOpen(false);
        }
    }, [open, shipment, reset]);

    // Editing keeps whoever already received the shipment (fixing the customer
    // code must not reassign it to the editor); only a shipment nobody is
    // attributed to yet starts from the logged-in worker.
    const receiverAlreadySet = shipment?.recieving_worker_id != null;
    useEffect(() => {
        if (!open || receiverAlreadySet || receiver.selfId == null) return;
        setValue("recieving_worker_id", receiver.selfId);
        setValue("recieving_worker_name", receiver.selfName);
    }, [open, receiverAlreadySet, receiver.selfId, receiver.selfName, setValue]);
    const receiverBlocked = receiver.blocked && !receiverAlreadySet;

    const onSubmit = async (data: NewShipment) => {
        if (!shipment) return;
        setSubmitError(null);
        // The dialog closes only once the server has accepted the change; a
        // refusal (or a form with no package line) keeps everything typed.
        let saved = false;
        try {
            // Filter out empty rows
            const validItems = data.shipment_items?.filter(i => i.item_type_id && i.quantity > 0) || [];

            if (validItems.length === 0) {
                setSubmitError("יש להוסיף לפחות סוג מארז אחד עם כמות.");
                return;
            }

            // Recalculate total amount to ensure it is up to date with any immediate changes
            const totalAmount = validItems.reduce((sum, item) => sum + (Number(item?.quantity) || 0), 0);

            const payload = {
                ...data,
                amount: totalAmount, // Use the calculated total
                shipment_date: data.shipment_date ? new Date(data.shipment_date).toISOString() : null,
                shipment_items: validItems,
                // Legacy support
                item_type_id: validItems[0]?.item_type_id || null
            };

            const res = await apiFetch(`/api/shipments/${shipment.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            if (res.ok) {
                saved = true;
            } else {
                setSubmitError(await serverErrorMessage(res, "השינויים לא נשמרו. בדוק את הפרטים ונסה שוב."));
            }
        } catch (error) {
            console.error(error);
            setSubmitError(NETWORK_ERROR);
        } finally {
            if (saved) {
                onUpdate(true);
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
                עדכון משלוח
            </DialogTitle>
            <ShipmentLineScanDialog
                open={lineScanOpen}
                onClose={() => setLineScanOpen(false)}
                itemTypes={itemTypes}
                takenRows={scannedRows(shipmentItems)}
                onConfirm={addScannedLines}
            />
            <form onSubmit={handleSubmit(onSubmit)} noValidate style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}>
                <DialogContent>
                    {receiverBlocked && (
                        <Alert severity="error" sx={{ mb: 2 }}>
                            לא ניתן לזהות אותך — לחשבון שלך אין מספר עובד מוגדר. פנה למנהל להוספתו בהגדרות משתמשים.
                        </Alert>
                    )}
                    <div className="shp-form-grid">
                        <div>
                            <FieldLabel required htmlFor={`${fieldId}-code`}>מס&apos; משלוח</FieldLabel>
                            <Controller
                                name="shipment_code"
                                control={control}
                                rules={{
                                    required: "שדה חובה",
                                    maxLength: { value: 20, message: "מקסימום 20 תווים" },
                                }}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        id={`${fieldId}-code`}
                                        placeholder="מס' משלוח"
                                        fullWidth
                                        size="small"
                                        error={!!errors.shipment_code}
                                        helperText={errors.shipment_code?.message}
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
                                        disabled={receiver.locked}
                                        placeholder={receiver.locked ? "מזוהה מההתחברות" : "בחר עובד…"}
                                        error={!!errors.recieving_worker_id}
                                        helperText={errors.recieving_worker_id?.message}
                                    />
                                )}
                            />
                            {receiver.locked && !receiverBlocked && <div className="sh-field-helper">{receiverAlreadySet ? "רק מנהל יכול לשנות" : "מזוהה מההתחברות"}</div>}
                        </div>
                        <div>
                            <Controller
                                name="source_id"
                                control={control}
                                render={({ field: { onChange, value } }) => (
                                    <SearchableCombobox<{ id: number; desc: string }>
                                        label="מקור"
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
                                        value={value ? new Date(value).toLocaleDateString('en-CA', { timeZone: DISPLAY_TIMEZONE }) : ""}
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
                                    <LineCertNote line={shipmentItems?.[index]} />
                                </div>

                                <Controller
                                    name={`shipment_items.${index}.quantity` as const}
                                    control={control}
                                    rules={{ required: true, min: 1 }}
                                    render={({ field }) => (
                                        <TextField
                                            {...field}
                                            placeholder="כמות"
                                            type="number"
                                            required
                                            size="small"
                                            fullWidth
                                            inputProps={{ "aria-label": `כמות, שורה ${index + 1}`, style: { fontVariantNumeric: "tabular-nums" } }}
                                            onChange={(e) => field.onChange(Number(e.target.value))}
                                            error={!!errors.shipment_items?.[index]?.quantity}
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
                        disabled={!isValid || receiverBlocked}
                        loading={isSubmitting}
                        variant="contained"
                    >
                        עדכן
                    </Button>
                </DialogActions>
            </form>
        </Dialog>
    );
}
