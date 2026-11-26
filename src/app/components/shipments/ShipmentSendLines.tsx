"use client";
import React from "react";
import { Controller, useFieldArray, useFormState, useWatch, type Control } from "react-hook-form";
import { Alert, Button, IconButton, SearchableCombobox, TextField } from "@/components/ui";
import { Add as AddIcon, Delete as DeleteIcon } from "@/components/ui/icons";
import type { Shipment } from "@/app/lib/shipments/contract";
import { declaredLineOf, maxToSend, remainingLines, type DeclaredLine, type SentRow } from "@/app/lib/shipments/send";

export type SendLine = { item_type_id: number | null; makat: string | null; amount: number | "" };

/** The return form (ShipmentSendPopup): the send's details, and the boxes each source shipment sends. */
export type SendFormValues = {
    /** YYYY-MM-DD, as the date input holds it. */
    sent_date: string;
    sending_worker_id: number | null;
    sending_worker_name: string | null;
    groups: { shipment_id: number; items: SendLine[] }[];
};

export const blankSendLine = (): SendLine => ({ item_type_id: null, makat: null, amount: "" });

/** A line that sends something: a type and at least one box. */
export const isSendable = (l: SendLine) => !!l.item_type_id && Number(l.amount) > 0;

/** What line `i` may still send: two lines of one type and makat share one cap, as the server counts them. */
function lineMax(available: DeclaredLine[], sent: SentRow[], lines: SendLine[], i: number): number {
    const line = lines[i];
    const others = lines
        .filter((l, j) => j !== i && l.item_type_id === line.item_type_id && (l.makat || null) === (line.makat || null))
        .reduce((n, l) => n + (Number(l.amount) || 0), 0);
    return Math.max(0, maxToSend(available, sent, line.item_type_id, line.makat) - others);
}

type Props = {
    control: Control<SendFormValues>;
    /** Which group of the form (groups.{index}) this shipment's lines are. */
    index: number;
    shipment: Shipment;
    /** What already went out of the shipment, per type and makat. */
    sent: SentRow[];
    /** Several shipments go out together: each section names its shipment. */
    titled: boolean;
};

/**
 * One source shipment's part of a return: what is still not done in it, and
 * its lines — box type and boxes, each up to what was declared less what
 * already went out (send.ts maxToSend; POST /api/shipment-history refuses more).
 */
export default function ShipmentSendLines({ control, index, shipment, sent, titled }: Props) {
    const name = `groups.${index}.items` as const;
    const { fields, append, remove, replace } = useFieldArray({ control, name });
    const lines = useWatch({ control, name });
    const { errors } = useFormState({ control, name });
    const lineErrors = errors.groups?.[index]?.items;
    const available = shipment.shipment_items || [];
    const left = remainingLines(available, sent);

    // The send counts boxes as declared, not as tested: say what is still not
    // done before the shipment is closed by it.
    const notTakenIn = Math.max(0, (shipment.total_items ?? 0) - (shipment.sampled_amount ?? 0));
    const unfinished = Math.max(0, (shipment.sampled_amount ?? 0) - (shipment.finished_sampled_amount ?? 0));

    return (
        <section className={titled ? "shp-send-group" : undefined} aria-label={titled ? `משלוח ${shipment.shipment_code}` : undefined}>
            {titled && (
                <div className="shp-send-group__title">
                    משלוח <strong>{shipment.shipment_code}</strong>
                    <span> · לקוח {shipment.customer_code}</span>
                </div>
            )}
            {(notTakenIn > 0 || unfinished > 0) && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    {[
                        notTakenIn > 0 ? (notTakenIn === 1 ? "מארז אחד לא נקלט" : `${notTakenIn} מארזים לא נקלטו`) : null,
                        unfinished > 0 ? (unfinished === 1 ? "מארז אחד עדיין בבדיקה" : `${unfinished} מארזים עדיין בבדיקה`) : null,
                    ].filter(Boolean).join(" · ")}
                    . שליחה שמשלימה את הכמות שהוצהרה סוגרת את המשלוח, והמארזים שלא נקלטו נמחקים איתה.
                </Alert>
            )}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-sm)", marginBottom: "var(--space-sm)" }}>
                <div style={{ fontSize: "var(--text-body)", fontWeight: 600 }}>מארזים לשליחה</div>
                <div style={{ display: "flex", gap: "var(--space-xs)" }}>
                    <Button
                        variant="text"
                        size="small"
                        disabled={left.length === 0}
                        title={left.length === 0 ? "לא נשאר מה לשלוח במשלוח הזה" : "שורה לכל סוג מארז, עם כל מה שעוד לא נשלח ממנו"}
                        onClick={() => replace(left)}
                    >
                        מלא את כל היתרה
                    </Button>
                    <Button variant="outlined" size="small" startIcon={<AddIcon fontSize={16} aria-hidden />} onClick={() => append(blankSendLine())}>
                        הוסף סוג מארז לשליחה
                    </Button>
                </div>
            </div>
            <div className="shp-items-head shp-items-row--wide" aria-hidden>
                <span>סוג מארז</span>
                <span>מארזים</span>
                <span />
            </div>
            {fields.map((item, i) => (
                // One line: type, amount, delete — tops aligned so the amount's
                // note / error underneath doesn't push the line out of shape.
                <div key={item.id} className="shp-items-row shp-items-row--wide">
                    <Controller
                        name={`${name}.${i}`}
                        control={control}
                        rules={{ validate: (val) => (val.item_type_id ? true : "בחר סוג מארז") }}
                        render={({ field: { onChange, value } }) => (
                            <SearchableCombobox<(typeof available)[number]>
                                options={available}
                                getOptionLabel={(option) => `${option.item_type_desc || "—"}`}
                                value={declaredLineOf(available, value.item_type_id, value.makat) || null}
                                onChange={(picked) =>
                                    onChange(picked
                                        ? { item_type_id: picked.item_type_id, makat: picked.makat || null, amount: value.amount }
                                        : blankSendLine())
                                }
                                placeholder="סוג מארז"
                                error={!!lineErrors?.[i]}
                            />
                        )}
                    />
                    <Controller
                        name={`${name}.${i}.amount`}
                        control={control}
                        rules={{
                            validate: (value, form) => {
                                if (value === "" || value === 0) return true;
                                const group = form.groups[index].items;
                                if (!group[i].item_type_id) return true;
                                const max = lineMax(available, sent, group, i);
                                return Number(value) > max ? `המקסימום לשליחה הוא ${max}` : true;
                            },
                            // A change on one line of a type moves the cap of its others.
                            deps: fields.map((_, j) => `${name}.${j}.amount` as const).filter((_, j) => j !== i),
                        }}
                        render={({ field }) => {
                            // Right after "הוסף" the watched list is a render
                            // behind the rows: the new row starts blank.
                            const max = lines?.[i] ? lineMax(available, sent, lines, i) : maxToSend(available, sent, item.item_type_id, item.makat);
                            const error = lineErrors?.[i]?.amount;
                            return (
                                <TextField
                                    {...field}
                                    placeholder="מארזים"
                                    type="number"
                                    required
                                    size="small"
                                    fullWidth
                                    inputProps={{
                                        "aria-label": titled ? `מארזים לשליחה ממשלוח ${shipment.shipment_code}, שורה ${i + 1}` : `מארזים לשליחה, שורה ${i + 1}`,
                                        style: { fontVariantNumeric: "tabular-nums" },
                                    }}
                                    onChange={(e) => field.onChange(e.target.value === "" ? "" : Number(e.target.value))}
                                    error={!!error}
                                    helperText={error ? (error.message || "כמות לא תקינה") : `מקס׳ ${max}`}
                                />
                            );
                        }}
                    />
                    <IconButton size="small" color="error" title="הסר שורה" onClick={() => remove(i)}>
                        <DeleteIcon fontSize={16} aria-hidden />
                    </IconButton>
                </div>
            ))}
        </section>
    );
}
