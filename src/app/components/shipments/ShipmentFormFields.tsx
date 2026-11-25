"use client";
import React from "react";
import { Controller, type Control, type FieldArrayWithId, type FieldErrors } from "react-hook-form";
import { Alert, Button, FieldLabel, IconButton, SearchableCombobox, TextField } from "@/components/ui";
import { Add as AddIcon, Delete as DeleteIcon, QrCodeScanner as QrCodeScannerIcon } from "@/components/ui/icons";
import type { NewShipment } from "@/app/lib/shipments/contract";
import type { DirectoryWorker } from "@/lib/users/rules";
import { certSummary, dateInputValue, lineIsEmpty, type ShipmentLine } from "@/app/lib/shipments/form";

/** The pieces the shipment forms (new, edit, return) share, drawn the same in each. */

/** A form's save that got no answer (failureText's `noAnswer`): what is typed stays in the form. */
export const SHIPMENT_FORM_NO_ANSWER = "אין תקשורת עם השרת. בדוק את החיבור ונסה שוב — הפרטים שהזנת נשמרו בטופס.";

/** Under a package line that came from the certificate. */
function LineCertNote({ line }: { line: ShipmentLine | undefined }) {
    const text = certSummary(line);
    return text ? <div className="shp-items-cert">{text}</div> : null;
}

/** The worker field cannot be filled: the login has no employee number. */
export function WorkerUnknownAlert() {
    return (
        <Alert severity="error" sx={{ mb: 2 }}>
            לא ניתן לזהות אותך — לחשבון שלך אין מספר עובד מוגדר. פנה למנהל להוספתו בהגדרות משתמשים.
        </Alert>
    );
}

/** "עובד מקבל" / "עובד מוציא": the worker picker of a form, locked to the
 *  logged-in worker unless a manager fills it (useShipmentWorker). */
export function WorkerField({ label, options, workers, value, onChange, locked, helper }: {
    label: string;
    options: DirectoryWorker[];
    workers: DirectoryWorker[];
    value: number | null | undefined;
    onChange: (worker: DirectoryWorker | null) => void;
    locked: boolean;
    /** The line under the field, when there is one. */
    helper?: string | null;
}) {
    return (
        <div>
            <SearchableCombobox<DirectoryWorker>
                label={label}
                options={options}
                getOptionLabel={(option) => option.worker_name}
                isOptionEqualToValue={(o, v) => o.worker_id === v.worker_id}
                value={workers.find((w) => w.worker_id === value) || null}
                onChange={onChange}
                disabled={locked}
                placeholder={locked ? "מזוהה מההתחברות" : "בחר עובד…"}
            />
            {helper && <div className="sh-field-helper">{helper}</div>}
        </div>
    );
}

/** תאריך משלוח — required; `disabled` while a scanned barcode supplied it. */
export function ShipmentDateField({ control, fieldId, errors, disabled }: {
    control: Control<NewShipment>;
    fieldId: string;
    errors: FieldErrors<NewShipment>;
    disabled?: boolean;
}) {
    return (
        <div>
            <FieldLabel required htmlFor={`${fieldId}-date`}>תאריך משלוח</FieldLabel>
            <Controller
                name="shipment_date"
                control={control}
                rules={{ required: "שדה חובה" }}
                render={({ field: { onChange, value } }) => (
                    <TextField
                        id={`${fieldId}-date`}
                        type="date"
                        fullWidth
                        size="small"
                        disabled={disabled}
                        value={value ? dateInputValue(value) : ""}
                        onChange={(e) => onChange(e.target.value ? new Date(e.target.value) : null)}
                        error={!!errors.shipment_date}
                        helperText={errors.shipment_date?.message}
                    />
                )}
            />
        </div>
    );
}

/** "מארזים במשלוח": the package lines (type, quantity, remove), the buttons
 *  that add them, and the declared total under them. */
export function ShipmentLinesSection({ control, errors, fields, lines, itemTypes, total, onScan, append, remove }: {
    control: Control<NewShipment>;
    errors: FieldErrors<NewShipment>;
    fields: FieldArrayWithId<NewShipment, "shipment_items", "id">[];
    /** The lines as they are now (useWatch). */
    lines: ShipmentLine[] | undefined;
    itemTypes: { id: number; name: string }[];
    total: number;
    onScan: () => void;
    append: (line: ShipmentLine) => void;
    remove: (index: number) => void;
}) {
    return (
        <>
            <div style={{ marginTop: "var(--space-lg)", borderTop: "1px solid var(--color-hairline)", paddingTop: "var(--space-md)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-sm)", marginBottom: "var(--space-sm)" }}>
                    <div style={{ fontSize: "var(--text-body)", fontWeight: 600 }}>מארזים במשלוח</div>
                    <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>
                        <Button variant="outlined" size="small" startIcon={<QrCodeScannerIcon fontSize={16} aria-hidden />} onClick={onScan}>
                            סרוק או הזן שורה מהתעודה
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
                            <LineCertNote line={lines?.[index]} />
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
            <div style={{ marginTop: "var(--space-md)", display: 'flex', justifyContent: 'flex-end', fontSize: "var(--text-body-sm)", fontWeight: 600 }}>
                <span>
                    סה״כ מארזים (מחושב): <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{total}</span>
                </span>
            </div>
        </>
    );
}
