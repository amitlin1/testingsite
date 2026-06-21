"use client";
import React, { useEffect, useState } from "react";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    Autocomplete,
    Box,
    useTheme,
    alpha
} from "@mui/material";
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
            PaperProps={{
                sx: {
                    borderRadius: 4,
                    background: "rgba(255, 255, 255, 0.9)",
                    backdropFilter: "blur(24px)",
                    boxShadow: "0 8px 32px 0 rgba(31, 38, 135, 0.15)",
                    border: "1px solid rgba(255, 255, 255, 0.3)"
                }
            }}
        >
            <DialogTitle sx={{ 
                fontWeight: 800, 
                background: "linear-gradient(45deg, #1976d2, #90caf9)",
                backgroundClip: "text",
                textFillColor: "transparent",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                pb: 2
            }}>
                עדכון משלוח
            </DialogTitle>
            <form onSubmit={handleSubmit(onSubmit)} noValidate>
                <DialogContent>
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mt: 0.5 }}>
                        <Box sx={{ width: { xs: "100%", sm: "48%" } }}>
                            <Controller
                                name="shipment_code"
                                control={control}
                                rules={{
                                    required: "Required",
                                    maxLength: { value: 20, message: "Max 20 chars" },
                                }}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        label="מס' משלוח"
                                        fullWidth
                                        required
                                        error={!!errors.shipment_code}
                                        helperText={errors.shipment_code?.message}
                                        inputProps={{ maxLength: 20 }}
                                    />
                                )}
                            />
                        </Box>
                        <Box sx={{ width: { xs: "100%", sm: "48%" } }}>
                            <Controller
                                name="customer_id"
                                control={control}
                                rules={{ required: "Required" }}
                                render={({ field: { onChange, value, ref, onBlur } }) => (
                                    <Autocomplete
                                        options={customers}
                                        getOptionLabel={(option) => option.customer_code}
                                        value={customers.find((c) => c.id === value) || null}
                                        onChange={(_, newValue) => onChange(newValue?.id ?? null)}
                                        renderInput={(params) => (
                                            <TextField
                                                {...params}
                                                inputRef={ref}
                                                onBlur={onBlur}
                                                label="קוד לקוח"
                                                required
                                                error={!!errors.customer_id}
                                                helperText={errors.customer_id?.message}
                                            />
                                        )}
                                    />
                                )}
                            />
                        </Box>
                        <Box sx={{ width: { xs: "100%", sm: "48%" } }}>
                            <Controller
                                name="recieving_worker_id"
                                control={control}
                                render={({ field: { onChange, value, ref, onBlur } }) => (
                                    <Autocomplete
                                        options={workers}
                                        getOptionLabel={(option) => option.worker_name}
                                        value={workers.find((w) => w.worker_id === value) || null}
                                        onChange={(_, newValue) => onChange(newValue?.worker_id ?? null)}
                                        renderInput={(params) => (
                                            <TextField
                                                {...params}
                                                inputRef={ref}
                                                onBlur={onBlur}
                                                label="עובד מקבל"
                                                error={!!errors.recieving_worker_id}
                                                helperText={errors.recieving_worker_id?.message}
                                            />
                                        )}
                                    />
                                )}
                            />
                        </Box>
                        <Box sx={{ width: { xs: "100%", sm: "48%" } }}>
                            <Controller
                                name="source_id"
                                control={control}
                                render={({ field: { onChange, value, ref, onBlur } }) => (
                                    <Autocomplete
                                        options={sources}
                                        getOptionLabel={(option) => option.desc}
                                        value={sources.find((s) => s.id === value) || null}
                                        onChange={(_, newValue) => onChange(newValue?.id ?? null)}
                                        renderInput={(params) => (
                                            <TextField
                                                {...params}
                                                inputRef={ref}
                                                onBlur={onBlur}
                                                label="מקור"
                                                error={!!errors.source_id}
                                                helperText={errors.source_id?.message}
                                            />
                                        )}
                                    />
                                )}
                            />
                        </Box>
                        <Box sx={{ width: { xs: "100%", sm: "48%" } }}>
                            <Controller
                                name="shipment_date"
                                control={control}
                                rules={{
                                    required: "Required",
                                }}
                                render={({ field: { onChange, value } }) => (
                                    <TextField
                                        label="תאריך משלוח"
                                        type="date"
                                        fullWidth
                                        required
                                        InputLabelProps={{ shrink: true }}
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
                    <Box sx={{ mt: 3, borderTop: '1px solid #ccc', pt: 2 }}>
                        <Button variant="outlined" onClick={() => append({ item_type_id: 0, quantity: 0 })} sx={{ mb: 2 }}>
                            הוסף סוג פריט
                        </Button>
                        {fields.map((item, index) => (
                            <Box key={item.id} sx={{ display: 'flex', gap: 2, mb: 1, alignItems: 'center' }}>
                                <Controller
                                    name={`shipment_items.${index}.item_type_id` as const}
                                    control={control}
                                    rules={{ required: true }}
                                    render={({ field: { onChange, value } }) => (
                                        <Autocomplete
                                            options={itemTypes}
                                            getOptionLabel={(option) => option.name}
                                            value={itemTypes.find((t) => t.id === value) || null}
                                            onChange={(_, newValue) => onChange(newValue?.id ?? null)}
                                            renderInput={(params) => (
                                                <TextField
                                                    {...params}
                                                    label="סוג פריט"
                                                    required
                                                    sx={{ width: 300 }}
                                                    error={!!errors.shipment_items?.[index]?.item_type_id}
                                                />
                                            )}
                                        />
                                    )}
                                />
                                <Controller
                                    name={`shipment_items.${index}.makat` as const}
                                    control={control}
                                    rules={{
                                        required: "Required",
                                        validate: (value) =>
                                            value && Number(value) > 0 ? true : "Must be > 0",
                                    }}
                                    render={({ field }) => (
                                        <TextField
                                            {...field}
                                            label="מקט"
                                            type="number"
                                            required
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
                                            label="כמות"
                                            type="number"
                                            required
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
                </DialogContent>
                <DialogActions sx={{ p: 3, gap: 2, borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
                    <Button 
                        onClick={onClose}
                        variant="outlined"
                        sx={{ borderRadius: 2, px: 3, borderColor: 'rgba(0,0,0,0.12)' }}
                    >
                        ביטול
                    </Button>
                    <Button 
                        type="submit" 
                        disabled={!isValid} 
                        variant="contained"
                        sx={{ 
                            borderRadius: 2, 
                            px: 4,
                            fontWeight: 700,
                            background: "linear-gradient(45deg, #FF9800, #F57C00)",
                            boxShadow: "0 4px 12px rgba(245, 124, 0, 0.2)",
                            "&:hover": {
                                boxShadow: "0 6px 16px rgba(245, 124, 0, 0.3)"
                            }
                        }}
                    >
                        עדכן
                    </Button>
                </DialogActions>
            </form>
        </Dialog>
    );
}
