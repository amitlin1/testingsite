"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { useForm, Controller, useFieldArray, useWatch } from "react-hook-form";
import { Shipment, NewShipment, Customers, SHIPMENT_CODE_MAX, type BoxSync, type DuplicateShipment } from "@/app/lib/shipments/contract";
import { BIG_SHIPMENT, declaredBoxes, lineIsEmpty, lineProblem, placeScannedLines, scannedRows, type ShipmentLine } from "@/app/lib/shipments/form";
import type { DirectoryWorker } from "@/lib/users/rules";
import { formatIdText } from "@/app/lib/packages/ids";
import { ApiError, sendJson } from "@/lib/api/client";
import { useCustomers, useItemTypeRows, useSources, useWorkersDirectory } from "@/app/components/lookups";
import { useShipmentWorker } from "./useShipmentWorker";
import ShipmentLineScanDialog from "./ShipmentLineScanDialog";
import ShipmentDuplicateDialog, { duplicateOf } from "./ShipmentDuplicateDialog";
import { SHIPMENT_FORM_NO_ANSWER, ShipmentDateField, ShipmentLinesSection, WorkerField, WorkerUnknownAlert } from "./ShipmentFormFields";
import { failureText } from "@/app/components/failureText";
import { omit } from "@/lib/omit";

type ShipmentUpdatePopupProps = {
    open: boolean;
    onClose: () => void;
    onUpdated: () => void;
    shipment: Shipment | null;
};

/** What a save would do to the boxes (PUT dry_run): pending boxes that go —
 *  their labels stop being valid — and boxes re-minted for a new customer. */
type BoxChanges = Pick<BoxSync, "removed" | "reminted">;

const NO_CUSTOMERS: Customers[] = [];
const NO_WORKERS: DirectoryWorker[] = [];
const NO_SOURCES: { id: number; desc: string }[] = [];

export default function ShipmentUpdatePopup({
    open,
    onClose,
    onUpdated,
    shipment,
}: ShipmentUpdatePopupProps) {
    const customers = useCustomers().data ?? NO_CUSTOMERS;
    const workers = useWorkersDirectory().data ?? NO_WORKERS;
    const allTypes = useItemTypeRows().data;
    // Package types only (docs/features/packages/PLAN.md §9.10) — a shipment declares boxes.
    const itemTypes = useMemo(() => (allTypes ?? []).filter((t) => t.is_package === true), [allTypes]);
    const sources = useSources().data ?? NO_SOURCES;
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

    const shipmentItems = useWatch({ control, name: "shipment_items" });
    const shipmentCode = useWatch({ control, name: "shipment_code" });
    const customerId = useWatch({ control, name: "customer_id" });
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
        if (open && shipment) {
            // Each saved line goes back with its id (line_id), so the server
            // keeps that line's boxes.
            let initialItems: ShipmentLine[] = (shipment.shipment_items || []).map(({ id, ...line }) => ({ ...omit(line, ["item_type_desc"]), line_id: id ?? null }));
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
            allowDuplicateRef.current = false;
        }
    }, [open, shipment, reset]);
    // The screen state of an opening starts clean during render; the form and
    // the ref follow in the effect above.
    const [openedFor, setOpenedFor] = useState<{ open: boolean; shipment: typeof shipment } | null>(null);
    if (!openedFor || openedFor.open !== open || openedFor.shipment !== shipment) {
        setOpenedFor({ open, shipment });
        if (open && shipment) {
            setSubmitError(null);
            setLineScanOpen(false);
            setPending(null);
            setDuplicate(null);
            setConfirmBig(false);
        }
    }

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
    const customerChanged = shipment != null && customerId !== shipment.customer_id;

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

    const put = (payload: object) => sendJson<{ boxes?: BoxChanges }>(`/api/shipments/${shipment!.id}`, "PUT", payload);

    const buildPayload = (data: NewShipment, validItems: ShipmentLine[]) => ({
        ...data,
        amount: declaredBoxes(validItems),
        shipment_date: data.shipment_date ? new Date(data.shipment_date).toISOString() : null,
        shipment_items: validItems,
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
        try {
            const payload = buildPayload(data, validItems);
            if (!confirmed && mayDropBoxes(validItems)) {
                const plan = (await put({ ...payload, dry_run: true })).boxes;
                if (plan && (plan.removed.length > 0 || plan.reminted > 0)) {
                    setPending(plan);
                    return;
                }
            }
            await put(payload);
        } catch (error) {
            const existing = duplicateOf(error);
            if (existing) setDuplicate(existing);
            else setSubmitError(failureText(error, "השינויים לא נשמרו. בדוק את הפרטים ונסה שוב.", SHIPMENT_FORM_NO_ANSWER));
            if (!(error instanceof ApiError)) console.error(error);
            return;
        }
        setPending(null);
        onUpdated();
        onClose();
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
                shipmentCode={shipmentCode}
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
            <form onSubmit={(e) => handleSubmit((data) => onSubmit(data))(e)} noValidate style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}>
                <DialogContent>
                    {receiverBlocked && <WorkerUnknownAlert />}
                    <div className="shp-form-grid">
                        <div>
                            <FieldLabel required htmlFor={`${fieldId}-code`}>מס&apos; משלוח</FieldLabel>
                            <Controller
                                name="shipment_code"
                                control={control}
                                rules={{
                                    required: "שדה חובה",
                                    maxLength: { value: SHIPMENT_CODE_MAX, message: `מקסימום ${SHIPMENT_CODE_MAX} תווים` },
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
                                    helper={receiver.locked && !receiverBlocked ? (receiverAlreadySet ? "רק מנהל יכול לשנות" : "מזוהה מההתחברות") : null}
                                />
                            )}
                        />
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
                        <ShipmentDateField control={control} fieldId={fieldId} errors={errors} />

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
                                            {pending.removed.map((id) => formatIdText(id)).join(" · ")}
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
