"use client";
import React, { useEffect, useRef, useState } from "react";
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
import { fmtId } from "@/app/components/packages/packageUi";
import ShipmentLineScanDialog, { BIG_SHIPMENT, LineCertNote, declaredBoxes, lineIsEmpty, lineProblem, placeScannedLines, scannedRows, type ShipmentLine } from "./ShipmentLineScanDialog";
import ShipmentDuplicateDialog, { duplicateOf, type DuplicateShipment } from "./ShipmentDuplicateDialog";
import { serverErrorMessage, NETWORK_ERROR } from "./serverError";

type ShipmentUpdatePopupProps = {
    open: boolean;
    onClose: () => void;
    onUpdate: (success: boolean) => void;
    shipment: Shipment | null;
};

/** What a save would do to the boxes (PUT dry_run): pending boxes that go —
 *  their labels stop being valid — and boxes re-minted for a new customer. */
type BoxChanges = { removed: string[]; reminted: number };

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

    // The save would remove boxes or re-mint them: shown, and saved only on "אשר ושמור".
    const [pending, setPending] = useState<BoxChanges | null>(null);
    // The same certificate (number + customer) is already another shipment's.
    const [duplicate, setDuplicate] = useState<DuplicateShipment | null>(null);
    const allowDuplicateRef = useRef(false);
    // A save that grows the shipment past BIG_SHIPMENT boxes asks once more.
    const [confirmBig, setConfirmBig] = useState(false);

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
        trigger,
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
    const addScannedLines = (lines: ShipmentLine[]) => {
        placeScannedLines(getValues('shipment_items'), lines, { update, append });
        void trigger('shipment_items');
    };

    // The declared total = Σ quantities of the started lines.
    const shipmentItems = watch("shipment_items");
    const total = declaredBoxes(shipmentItems);
    useEffect(() => {
        setValue("amount", total);
        setConfirmBig(false);
    }, [total, setValue]);

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
            // Each saved line goes back with its id (line_id), so the server
            // keeps that line's boxes. A legacy shipment without lines starts
            // from its single item type.
            let initialItems: ShipmentLine[] = (shipment.shipment_items || []).map(({ id, item_type_desc: _desc, ...line }) => ({ ...line, line_id: id ?? null }));
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
            setPending(null);
            setDuplicate(null);
            allowDuplicateRef.current = false;
            setConfirmBig(false);
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

    // The customer is in every box id. Once a box was taken in it stays the
    // shipment's customer (the server refuses the change too); before that a
    // change re-mints the boxes, so their labels are printed again.
    const customerLocked = (shipment?.sampled_amount ?? 0) > 0;
    const customerChanged = shipment != null && watch("customer_id") !== shipment.customer_id;

    // Could this save take boxes away or re-mint them? Then the server is asked
    // first (dry_run) and the worker sees which labels stop being valid.
    const mayDropBoxes = (lines: ShipmentLine[]): boolean => {
        if (!shipment) return false;
        if (customerChanged) return true;
        const byId = new Map(lines.filter((l) => l.line_id != null).map((l) => [l.line_id, l]));
        return (shipment.shipment_items ?? []).some((old) => {
            const now = old.id != null ? byId.get(old.id) : undefined;
            return !now || now.item_type_id !== old.item_type_id || Number(now.quantity) < old.quantity;
        });
    };

    const put = (payload: object) => apiFetch(`/api/shipments/${shipment!.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    const buildPayload = (data: NewShipment, validItems: ShipmentLine[]) => ({
        ...data,
        amount: declaredBoxes(validItems),
        shipment_date: data.shipment_date ? new Date(data.shipment_date).toISOString() : null,
        shipment_items: validItems,
        // Legacy support
        item_type_id: validItems[0]?.item_type_id || null,
        allow_duplicate: allowDuplicateRef.current,
        // Every saved line goes back with its line_id: a line without one is new.
        line_ids: true,
    });

    /** Sends the edit; `confirmed` = the worker already saw what it does to the boxes. */
    const onSubmit = async (data: NewShipment, confirmed = false) => {
        if (!shipment) return;
        setSubmitError(null);
        // A started line that is not whole stops the save — it is never
        // dropped quietly; only an untouched blank row is left out.
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
        if (totalAmount > BIG_SHIPMENT && totalAmount > (shipment.amount ?? 0) && !confirmBig) {
            setConfirmBig(true);
            return;
        }

        // The dialog closes only once the server has accepted the change; a
        // refusal keeps everything typed.
        let saved = false;
        try {
            const payload = buildPayload(data, validItems);
            if (!confirmed && mayDropBoxes(validItems)) {
                const dry = await put({ ...payload, dry_run: true });
                if (!dry.ok) {
                    const existing = await duplicateOf(dry);
                    if (existing) setDuplicate(existing);
                    else setSubmitError(await serverErrorMessage(dry, "השינויים לא נשמרו. בדוק את הפרטים ונסה שוב."));
                    return;
                }
                const plan = (await dry.json().catch(() => null))?.boxes as BoxChanges | undefined;
                if (plan && (plan.removed.length > 0 || plan.reminted > 0)) {
                    setPending(plan);
                    return;
                }
            }

            const res = await put(payload);
            if (res.ok) {
                saved = true;
            } else {
                const existing = await duplicateOf(res);
                if (existing) setDuplicate(existing);
                else setSubmitError(await serverErrorMessage(res, "השינויים לא נשמרו. בדוק את הפרטים ונסה שוב."));
            }
        } catch (error) {
            console.error(error);
            setSubmitError(NETWORK_ERROR);
        } finally {
            if (saved) {
                setPending(null);
                onUpdate(true);
                onClose();
            }
        }
    };

    const confirmPending = () => {
        setPending(null);
        void handleSubmit((data) => onSubmit(data, true))();
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
                shipmentCode={watch("shipment_code")}
                onConfirm={addScannedLines}
            />
            <ShipmentDuplicateDialog
                duplicate={duplicate}
                onCancel={() => setDuplicate(null)}
                onConfirm={() => {
                    setDuplicate(null);
                    allowDuplicateRef.current = true;
                    void handleSubmit((data) => onSubmit(data))();
                }}
            />
            <form onSubmit={handleSubmit((data) => onSubmit(data))} noValidate style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}>
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
                                        disabled={customerLocked}
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
                            {customerLocked ? (
                                <div className="sh-field-helper">מארזים מהמשלוח כבר נקלטו — אי אפשר לשנות את הלקוח</div>
                            ) : customerChanged && (shipment?.total_items ?? 0) > 0 && (
                                <div className="sh-field-helper" style={{ color: "var(--color-warning-ink)" }}>שינוי הלקוח מחליף את מזהי המארזים — יש להדפיס את המדבקות מחדש</div>
                            )}
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
                </DialogContent>
                {(submitError || pending || confirmBig) && (
                    <div style={{ padding: "0 var(--space-lg) var(--space-sm)" }}>
                        {submitError ? (
                            <Alert severity="error">{submitError}</Alert>
                        ) : pending ? (
                            <Alert severity="warning">
                                {pending.removed.length > 0 && (
                                    <div>
                                        השמירה תמחק {pending.removed.length === 1 ? "מארז אחד שממתין" : `${pending.removed.length} מארזים שממתינים`} לקליטה. אם המדבקה כבר הודבקה — יש להסיר אותה מהקופסה:
                                        <div dir="ltr" style={{ marginTop: 4, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
                                            {pending.removed.map((id) => { const { head, suffix } = fmtId(id); return `${head} ${suffix}`; }).join(" · ")}
                                        </div>
                                    </div>
                                )}
                                {pending.reminted > 0 && (
                                    <div style={{ marginTop: pending.removed.length > 0 ? 6 : 0 }}>
                                        {pending.reminted === 1 ? "מזהה של מארז אחד יוחלף" : `המזהים של ${pending.reminted} מארזים יוחלפו`} בגלל שינוי הלקוח — יש להדפיס את המדבקות מחדש.
                                    </div>
                                )}
                            </Alert>
                        ) : (
                            <Alert severity="warning">
                                המשלוח יכלול {total} מארזים. אם הכמות נכונה, לחץ שוב על &quot;עדכן&quot;.
                            </Alert>
                        )}
                    </div>
                )}
                <DialogActions>
                    <Button onClick={pending ? () => setPending(null) : onClose} variant="outlined" color="inherit">
                        ביטול
                    </Button>
                    {pending ? (
                        <Button onClick={confirmPending} loading={isSubmitting} variant="contained">
                            אשר ושמור
                        </Button>
                    ) : (
                        <Button
                            type="submit"
                            disabled={!isValid || receiverBlocked}
                            loading={isSubmitting}
                            variant="contained"
                        >
                            עדכן
                        </Button>
                    )}
                </DialogActions>
            </form>
        </Dialog>
    );
}
