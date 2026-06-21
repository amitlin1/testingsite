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
    Typography,
    useTheme,
    alpha,
    Alert,
} from "@mui/material";
import { useForm, Controller, useFieldArray } from "react-hook-form";
import { Shipment } from "@/types";
import { DISPLAY_TIMEZONE } from "@/app/lib/datetime";
import SignatureCanvas from 'react-signature-canvas';

type ShipmentSendPopupProps = {
    open: boolean;
    onClose: () => void;
    onSend: (success: boolean) => void;
    shipment: Shipment | null;
};

type SendFormValues = {
    sent_shipment_code: string;
    sent_date: string; // ISO date string YYYY-MM-DD
    sending_worker_id: number | null;
    items: {
        item_type_id: number | null;
        makat: number | null;
        amount: number | '';
        // Helper to store the original index or id to lookup details if needed
        original_item_index?: number;
    }[];
};

export default function ShipmentSendPopup({
    open,
    onClose,
    onSend,
    shipment,
}: ShipmentSendPopupProps) {
    const theme = useTheme();
    const [workers, setWorkers] = useState<{ worker_id: number; worker_name: string }[]>([]);
    const [history, setHistory] = useState<{ item_type_id: number; makat: number | null; total_sent: number }[]>([]);

    const {
        control,
        handleSubmit,
        reset,
        watch,
        setValue,
        formState: { errors, isValid },
    } = useForm<SendFormValues>({
        mode: "onChange",
        defaultValues: {
            sent_shipment_code: "",
            sent_date: new Date().toISOString().split("T")[0],
            sending_worker_id: null,
            items: [{ item_type_id: null, makat: null, amount: '' }],
        }
    });

    const { fields, append, remove } = useFieldArray({
        control,
        name: "items"
    });

    const items = watch("items");

    const sigCanvas = React.useRef<SignatureCanvas>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch("/api/workers");
                const data = await res.json();
                if (!cancelled && Array.isArray(data)) {
                    setWorkers(data);
                }
            } catch (err) {
                console.error("Error loading workers:", err);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (shipment?.id) {
            fetch(`/api/shipment-history?shipment_id=${shipment.id}`)
                .then(res => res.json())
                .then(data => {
                    if (Array.isArray(data)) {
                        setHistory(data);
                    }
                })
                .catch(err => console.error("Error loading history:", err));
        } else {
            setHistory([]);
        }
    }, [shipment]);

    useEffect(() => {
        if (open && shipment) {
            reset({
                sent_shipment_code: "",
                sent_date: new Date().toLocaleDateString('en-CA', { timeZone: DISPLAY_TIMEZONE }),
                sending_worker_id: null,
                items: [{ item_type_id: null, makat: null, amount: '' }],
            });
        }
    }, [open, shipment, reset]);

    const onSubmit = async (data: SendFormValues) => {
        if (!shipment) return;

        try {
            // Filter valid items
            const validItems = data.items.filter(i => i.item_type_id && Number(i.amount) > 0);
            if (validItems.length === 0) {
                alert("Please add at least one item to send.");
                return;
            }



            const signature_base64 = sigCanvas.current && !sigCanvas.current.isEmpty() ? sigCanvas.current.toDataURL() : null;

            const payload = {
                shipment_id: shipment.id,
                sent_shipment_code: data.sent_shipment_code,
                sent_date: new Date(data.sent_date).toISOString(),
                sending_worker_id: data.sending_worker_id,
                items: validItems,
                signature_base64
            };

            const res = await fetch("/api/shipment-history", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            if (res.ok) {
                onSend(true);
            } else {
                console.error("Failed to send shipment items");
                onSend(false);
            }
        } catch (error) {
            console.error(error);
            onSend(false);
        } finally {
            onClose();
        }
    };

    if (!shipment) return null;

    // Available items options from the shipment
    const availableItems = shipment.shipment_items || [];

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
                שליחת פריטים (Shipment Send)
            </DialogTitle>
            <form onSubmit={handleSubmit(onSubmit)} noValidate>
                <DialogContent>
                    <Alert severity="warning" sx={{ mb: 2 }}>
                        שים לב: ייתכן וישנם פריטים מחוברים (Sub-items)
                    </Alert>
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mt: 0.5 }}>
                        <Box sx={{ width: "100%" }}>
                            <Typography variant="subtitle1">
                                משלוח מקור: {shipment.shipment_code} | לקוח: {shipment.customer_code}
                            </Typography>
                        </Box>

                        <Box sx={{ width: { xs: "100%", sm: "48%" } }}>
                            <Controller
                                name="sent_shipment_code"
                                control={control}
                                rules={{ required: "Required" }}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        label="קוד משלוח יוצא"
                                        fullWidth
                                        required
                                        error={!!errors.sent_shipment_code}
                                        helperText={errors.sent_shipment_code?.message}
                                    />
                                )}
                            />
                        </Box>

                        <Box sx={{ width: { xs: "100%", sm: "48%" } }}>
                            <Controller
                                name="sent_date"
                                control={control}
                                rules={{ required: "Required" }}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        label="תאריך שליחה"
                                        type="date"
                                        fullWidth
                                        required
                                        InputLabelProps={{ shrink: true }}
                                        error={!!errors.sent_date}
                                        helperText={errors.sent_date?.message}
                                    />
                                )}
                            />
                        </Box>

                        <Box sx={{ width: { xs: "100%", sm: "48%" } }}>
                            <Controller
                                name="sending_worker_id"
                                control={control}
                                render={({ field: { onChange, value } }) => (
                                    <Autocomplete
                                        options={workers}
                                        getOptionLabel={(option) => option.worker_name}
                                        value={workers.find((w) => w.worker_id === value) || null}
                                        onChange={(_, newValue) => onChange(newValue?.worker_id ?? null)}
                                        renderInput={(params) => (
                                            <TextField
                                                {...params}
                                                label="עובד מוציא"
                                                error={!!errors.sending_worker_id}
                                            />
                                        )}
                                    />
                                )}
                            />
                        </Box>
                    </Box>

                    {/* Dynamic Items Selection */}
                    <Box sx={{ mt: 3, borderTop: '1px solid #ccc', pt: 2 }}>
                        <Button variant="outlined" onClick={() => append({ item_type_id: null, makat: null, amount: '' })} sx={{ mb: 2 }}>
                            הוסף פריט לשליחה
                        </Button>
                        {fields.map((item, index) => (
                            <Box key={item.id} sx={{ display: 'flex', gap: 2, mb: 1, alignItems: 'center' }}>
                                <Controller
                                    name={`items.${index}` as const}
                                    control={control}
                                    rules={{
                                        validate: (val) => val.item_type_id ? true : "Select an item"
                                    }}
                                    render={({ field: { onChange, value } }) => (
                                        <Autocomplete
                                            options={availableItems}
                                            getOptionLabel={(option) =>
                                                `${option.item_type_desc || 'Unknown'} - Makat: ${option.makat || 'N/A'} (Qty: ${option.quantity})`
                                            }
                                            sx={{ width: 400 }}
                                            // Find the matching option based on item_type_id and makat
                                            value={availableItems.find(opt =>
                                                opt.item_type_id === value.item_type_id && opt.makat == value.makat
                                            ) || null}
                                            onChange={(_, newValue) => {
                                                if (newValue) {
                                                    onChange({
                                                        item_type_id: newValue.item_type_id,
                                                        makat: newValue.makat || null,
                                                        amount: value.amount // Keep typed amount or reset? User didn't specify. Keeping it is safer unless we change item.
                                                    });
                                                } else {
                                                    onChange({ item_type_id: null, makat: null, amount: '' });
                                                }
                                            }}
                                            renderInput={(params) => (
                                                <TextField
                                                    {...params}
                                                    label="בחירת פריט"
                                                    required
                                                    error={!!errors.items?.[index]}
                                                />
                                            )}
                                        />
                                    )}
                                />

                                <Controller
                                    name={`items.${index}.amount` as const}
                                    control={control}
                                    rules={{
                                        validate: (value, formValues) => {
                                            // Allow empty or 0 during input
                                            if (value === '' || value === 0) return true;
                                            
                                            const currentItem = formValues.items[index];
                                            if (!currentItem.item_type_id) return true; // Skip if no item selected yet

                                            const originalItem = availableItems.find(opt =>
                                                opt.item_type_id === currentItem.item_type_id && opt.makat == currentItem.makat
                                            );
                                            const totalReceived = originalItem ? originalItem.quantity : 0;

                                            const sentItem = history.find(h =>
                                                h.item_type_id === currentItem.item_type_id && h.makat == currentItem.makat
                                            );
                                            const previouslySent = sentItem ? sentItem.total_sent : 0;
                                            const maxAllowed = Math.max(0, totalReceived - previouslySent);

                                            if (Number(value) > maxAllowed) {
                                                return `Max allowed is ${maxAllowed}`;
                                            }
                                            return true;
                                        }
                                    }}
                                    render={({ field }) => {
                                        // Calculate max allowed
                                        const currentItem = items[index];
                                        const originalItem = availableItems.find(opt =>
                                            opt.item_type_id === currentItem.item_type_id && opt.makat == currentItem.makat
                                        );
                                        const totalReceived = originalItem ? originalItem.quantity : 0;

                                        const sentItem = history.find(h =>
                                            h.item_type_id === currentItem.item_type_id && h.makat == currentItem.makat
                                        );
                                        const previouslySent = sentItem ? sentItem.total_sent : 0;
                                        const maxAllowed = Math.max(0, totalReceived - previouslySent);

                                        return (
                                            <TextField
                                                {...field}
                                                label={`כמות (Max: ${maxAllowed})`}
                                                type="number"
                                                required
                                                sx={{ width: 140 }}
                                                onChange={(e) => field.onChange(e.target.value === '' ? '' : Number(e.target.value))}
                                                error={!!errors.items?.[index]?.amount}
                                                helperText={errors.items?.[index]?.amount ? (errors.items[index]?.amount?.message || "Invalid amount") : ""}
                                            />
                                        );
                                    }}
                                />
                                <Button color="error" onClick={() => remove(index)}>
                                    מחק
                                </Button>
                            </Box>
                        ))}
                    </Box>

                    {/* Signature Section */}
                    <Box sx={{ mt: 3, borderTop: '1px solid #ccc', pt: 2 }}>
                        <Typography variant="subtitle1" gutterBottom>חתימה (Signature)</Typography>
                        <Box sx={{ border: '1px solid #ccc', borderRadius: 2, overflow: 'hidden', bgcolor: '#fafafa' }}>
                            <SignatureCanvas
                                ref={sigCanvas}
                                canvasProps={{ width: 800, height: 200, className: 'sigCanvas' }}
                                backgroundColor="#fafafa"
                            />
                        </Box>
                        <Button size="small" onClick={() => sigCanvas.current?.clear()} sx={{ mt: 1 }}>
                            נקה חתימה
                        </Button>
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
                            background: "linear-gradient(45deg, #4CAF50, #81C784)",
                            boxShadow: "0 4px 12px rgba(76, 175, 80, 0.2)",
                            "&:hover": {
                                boxShadow: "0 6px 16px rgba(76, 175, 80, 0.3)"
                            }
                        }}
                    >
                        שלח
                    </Button>
                </DialogActions>
            </form>
        </Dialog>
    );
}
