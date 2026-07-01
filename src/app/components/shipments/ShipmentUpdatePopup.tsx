"use client";
import React, { useEffect, useState } from "react";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    Box,
    Typography,
    useTheme
} from "@mui/material";
import SearchableCombobox from "../common/SearchableCombobox";
import FieldLabel from "../common/FieldLabel";
import { useForm, Controller, useFieldArray } from "react-hook-form";
import { Shipment, NewShipment, Customers } from "@/types";
import { DISPLAY_TIMEZONE } from "@/app/lib/datetime";

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
    const theme = useTheme();
    const [customers, setCustomers] = useState<Customers[]>([]);
    const [workers, setWorkers] = useState<{ worker_id: number; worker_name: string }[]>([]);
    const [itemTypes, setItemTypes] = useState<{ id: number; name: string }[]>([]);
    const [sources, setSources] = useState<{ id: number; desc: string }[]>([]);

    const {
        control,
        handleSubmit,
        reset,
        watch,
        setValue,
        formState: { errors, isValid },
    } = useForm<NewShipment>({
        mode: "onChange",
    });

    const { fields, append, remove } = useFieldArray({
        control,
        name: "shipment_items"
    });



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
                    fetch("/api/customers"),
                    fetch("/api/workers"),
                    fetch("/api/item-types"),
                    fetch("/api/sources")
                ]);
                const custData = await custRes.json();
                const workersData = await workersRes.json();
                const typesData = await typesRes.json();
                const sourcesData = await sourcesRes.json();

                if (!cancelled) {
                    setCustomers(Array.isArray(custData) ? custData : []);
                    setWorkers(Array.isArray(workersData) ? workersData : []);
                    setItemTypes(Array.isArray(typesData) ? typesData : []);
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
            });
        }
    }, [open, shipment, reset]);

    const onSubmit = async (data: NewShipment) => {
        if (!shipment) return;
        try {
            // Filter out empty rows
            const validItems = data.shipment_items?.filter(i => i.item_type_id && i.quantity > 0) || [];

            if (validItems.length === 0) {
                alert("Must add at least one item with valid type and quantity");
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

            const res = await fetch(`/api/shipments/${shipment.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            if (res.ok) {
                onUpdate(true);
            } else {
                onUpdate(false);
            }
        } catch (error) {
            console.error(error);
            onUpdate(false);
        } finally {
            onClose();
        }
    };

    return (
        <Dialog
            open={open}
            onClose={onClose}
            fullWidth
            maxWidth="md"
        >
            <DialogTitle sx={{
                fontWeight: 700,
                color: "text.primary",
                borderBottom: `1px solid ${theme.palette.divider}`,
                pb: 2
            }}>
                עדכון משלוח
            </DialogTitle>
            <form onSubmit={handleSubmit(onSubmit)} noValidate>
                <DialogContent>
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mt: 0.5 }}>
                        <Box sx={{ width: { xs: "100%", sm: "48%" } }}>
                            <FieldLabel required>מס' משלוח</FieldLabel>
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
                                        placeholder="מס' משלוח"
                                        fullWidth
                                        size="small"
                                        error={!!errors.shipment_code}
                                        helperText={errors.shipment_code?.message}
                                        inputProps={{ maxLength: 20 }}
                                    />
                                )}
                            />
                        </Box>
                        <Box sx={{ width: { xs: "100%", sm: "48%" } }}>
                            <FieldLabel required>קוד לקוח</FieldLabel>
                            <Controller
                                name="customer_id"
                                control={control}
                                rules={{ required: "שדה חובה" }}
                                render={({ field: { onChange, value } }) => (
                                    <SearchableCombobox<Customers>
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
                        </Box>
                        <Box sx={{ width: { xs: "100%", sm: "48%" } }}>
                            <FieldLabel>עובד מקבל</FieldLabel>
                            <Controller
                                name="recieving_worker_id"
                                control={control}
                                render={({ field: { onChange, value } }) => (
                                    <SearchableCombobox<{ worker_id: number; worker_name: string }>
                                        options={workers}
                                        getOptionLabel={(option) => option.worker_name}
                                        isOptionEqualToValue={(o, v) => o.worker_id === v.worker_id}
                                        value={workers.find((w) => w.worker_id === value) || null}
                                        onChange={(newValue) => onChange(newValue?.worker_id ?? null)}
                                        placeholder="בחר עובד…"
                                        error={!!errors.recieving_worker_id}
                                        helperText={errors.recieving_worker_id?.message}
                                    />
                                )}
                            />
                        </Box>
                        <Box sx={{ width: { xs: "100%", sm: "48%" } }}>
                            <FieldLabel>מקור</FieldLabel>
                            <Controller
                                name="source_id"
                                control={control}
                                render={({ field: { onChange, value } }) => (
                                    <SearchableCombobox<{ id: number; desc: string }>
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
                        </Box>
                        <Box sx={{ width: { xs: "100%", sm: "48%" } }}>
                            <FieldLabel required>תאריך משלוח</FieldLabel>
                            <Controller
                                name="shipment_date"
                                control={control}
                                rules={{
                                    required: "שדה חובה",
                                }}
                                render={({ field: { onChange, value } }) => (
                                    <TextField
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
                        </Box>

                    </Box>

                    {/* Dynamic Items Section */}
                    <Box sx={{ mt: 3, borderTop: `1px solid ${theme.palette.divider}`, pt: 2 }}>
                        <Button variant="outlined" onClick={() => append({ item_type_id: 0, quantity: 0 })} sx={{ mb: 2 }}>
                            הוסף סוג פריט
                        </Button>
                        {fields.map((item, index) => (
                            <Box key={item.id} sx={{ display: 'flex', gap: 2, mb: 1, alignItems: 'center' }}>
                                <Box sx={{ width: 300 }}>
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
                                            placeholder="סוג פריט"
                                            error={!!errors.shipment_items?.[index]?.item_type_id}
                                        />
                                    )}
                                />
                                </Box>
                                <Controller
                                    name={`shipment_items.${index}.makat` as const}
                                    control={control}
                                    rules={{
                                        required: "שדה חובה",
                                        validate: (value) =>
                                            value && Number(value) > 0 ? true : "חייב להיות > 0",
                                    }}
                                    render={({ field }) => (
                                        <TextField
                                            {...field}
                                            placeholder="מקט"
                                            type="number"
                                            required
                                            size="small"
                                            sx={{ width: 100 }}
                                            value={field.value ?? ""}
                                            onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
                                            error={!!errors.shipment_items?.[index]?.makat}
                                        />
                                    )}
                                />
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
                                            sx={{ width: 100 }}
                                            onChange={(e) => field.onChange(Number(e.target.value))}
                                            error={!!errors.shipment_items?.[index]?.quantity}
                                        />
                                    )}
                                />
                                {fields.length > 1 && (
                                    <Button color="error" onClick={() => remove(index)}>
                                        מחק
                                    </Button>
                                )}
                            </Box>
                        ))}
                    </Box>

                    {/* Auto-calculated total = Σ quantities */}
                    <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                            סה״כ כמות: <Box component="span" sx={{ color: 'primary.main', fontVariantNumeric: 'tabular-nums' }}>{watch("amount") || 0}</Box>
                        </Typography>
                    </Box>
                </DialogContent>
                <DialogActions sx={{ p: 3, gap: 2, borderTop: `1px solid ${theme.palette.divider}` }}>
                    <Button
                        onClick={onClose}
                        variant="outlined"
                        sx={{ borderRadius: 9999, px: 3, borderColor: 'rgba(0,0,0,0.12)', color: 'text.primary' }}
                    >
                        ביטול
                    </Button>
                    <Button
                        type="submit"
                        disabled={!isValid}
                        variant="contained"
                        sx={{ borderRadius: 9999, px: 4, fontWeight: 700 }}
                    >
                        עדכן
                    </Button>
                </DialogActions>
            </form>
        </Dialog>
    );
}
