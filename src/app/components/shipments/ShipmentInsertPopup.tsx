"use client";
import React, { useEffect, useState, useRef, useCallback } from "react";
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
    IconButton,
    Tooltip,
    Alert
} from "@mui/material";
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import CloseIcon from '@mui/icons-material/Close';
import { useForm, Controller, useFieldArray } from "react-hook-form";
import { NewShipment, Customers } from "@/types";
import SignatureCanvas from 'react-signature-canvas';
import { parseShipmentQr, isValidShipmentQr, convertQrDateToInputFormat } from '@/app/lib/qrParser';

type ShipmentInsertPopupProps = {
    open: boolean;
    onClose: () => void;
    onCreate: (success: boolean) => void;
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
}: ShipmentInsertPopupProps) {
    const [customers, setCustomers] = useState<Customers[]>([]);
    const [workers, setWorkers] = useState<{ worker_id: number; worker_name: string; stokekeeper?: boolean }[]>([]);
    const [itemTypes, setItemTypes] = useState<{ id: number; name: string }[]>([]);
    const [sources, setSources] = useState<{ id: number; desc: string }[]>([]);
    const theme = useTheme();

    const {
        control,
        handleSubmit,
        reset,
        watch,
        setValue,
        formState: { errors, isValid },
    } = useForm<NewShipment>({
        mode: "onChange",
        defaultValues: { ...defaultShipment, shipment_items: [{ item_type_id: 0, quantity: 0 }] }, // Start with one row
    });

    const { fields, append, remove } = useFieldArray({
        control,
        name: "shipment_items"
    });

    const sigCanvas = React.useRef<SignatureCanvas>(null);
    const [sigError, setSigError] = useState(false);

    // Scanner state
    const [scannerOpen, setScannerOpen] = useState(false);
    const [scanError, setScanError] = useState<string | null>(null);
    const [manualBarcodeInput, setManualBarcodeInput] = useState('');
    const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Handle QR scan result
    const handleQrScan = useCallback((decodedText: string) => {
        const parsedData = parseShipmentQr(decodedText);
        
        if (parsedData) {
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
                setValue('shipment_date', new Date(convertedDate));
            }

            setScanError(null);
            setScannerOpen(false);
        } else {
            setScanError('פורמט QR לא תקין');
        }
    }, [customers, setValue]);

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
                    // Map API raw format { id, name, stokekeeper } to expected format { worker_id, worker_name, stokekeeper }
                    setWorkers(Array.isArray(workersData) 
                        ? workersData.map((w: any) => ({ worker_id: w.id, worker_name: w.name, stokekeeper: w.stokekeeper })) 
                        : []
                    );
                    setItemTypes(Array.isArray(typesData) ? typesData : []);
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
    }, []);

    useEffect(() => {
        if (open) {
            reset({ ...defaultShipment, source_id: 1, shipment_items: [{ item_type_id: 0, quantity: 0 }] });
        }
    }, [open, reset]);

    const onSubmit = async (data: NewShipment) => {
        try {
            // Filter out empty rows
            const validItems = data.shipment_items?.filter(i => i.item_type_id && i.quantity > 0) || [];

            if (validItems.length === 0) {
                alert("Must add at least one item with valid type and quantity");
                return;
            }

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

            const res = await fetch("/api/shipments", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            if (res.ok) {
                onCreate(true);
            } else {
                onCreate(false);
            }
        } catch (error) {
            console.error(error);
            onCreate(false);
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
                pb: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
            }}>
                <span>הוספת משלוח חדש</span>
                <Tooltip title="סרוק ברקוד למילוי אוטומטי">
                    <IconButton
                        onClick={() => setScannerOpen(true)}
                        sx={{
                            background: "linear-gradient(45deg, #1976d2, #42a5f5)",
                            color: 'white',
                            '&:hover': {
                                background: "linear-gradient(45deg, #1565c0, #1976d2)",
                            }
                        }}
                    >
                        <QrCodeScannerIcon />
                    </IconButton>
                </Tooltip>
            </DialogTitle>

            {/* QR Scanner Modal */}
            <Dialog
                open={scannerOpen}
                onClose={() => {
                    setScannerOpen(false);
                    setScanError(null);
                    setManualBarcodeInput('');
                }}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>סריקת ברקוד</span>
                    <IconButton onClick={() => {
                        setScannerOpen(false);
                        setScanError(null);
                        setManualBarcodeInput('');
                    }}>
                        <CloseIcon />
                    </IconButton>
                </DialogTitle>
                <DialogContent>
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, py: 4 }}>
                        {scanError && (
                            <Alert severity="error" sx={{ width: '100%' }}>
                                {scanError}
                            </Alert>
                        )}
                        <QrCodeScannerIcon sx={{ fontSize: 80, color: 'text.secondary', opacity: 0.5 }} />
                        <Typography variant="h6" color="text.primary" textAlign="center">
                            נא לסרוק את הברקוד כעת
                        </Typography>
                        <TextField
                            autoFocus
                            fullWidth
                            size="medium"
                            placeholder="המתנה לסריקה... או הזן ידנית"
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
                            InputProps={{
                                sx: { textAlign: 'center', fontSize: '1.2rem' }
                            }}
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
                            sx={{ mt: 1 }}
                        >
                            אישור
                        </Button>
                    </Box>
                </DialogContent>
            </Dialog>

            <form onSubmit={handleSubmit(onSubmit)} noValidate>
                <DialogContent>
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mt: 0.5 }}>
                        <Box sx={{ width: { xs: "100%", sm: "100%" } }}>
                             <Controller
                                name="poc_details"
                                control={control}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        label="פרטי איש קשר (POC Details)"
                                        fullWidth
                                        multiline
                                        rows={2}
                                    />
                                )}
                            />
                        </Box>
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
                                        options={workers.filter(w => w.stokekeeper)}
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
                                rules={{ required: "חובה לבחור מקור" }}
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
                                                required
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
                                        value={value ? new Date(value).toISOString().split("T")[0] : ""}
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
                                        validate: (value) =>
                                            !value || Number(value) > 0 ? true : "Must be > 0",
                                    }}
                                    render={({ field }) => (
                                        <TextField
                                            {...field}
                                            label="מקט"
                                            type="number"
                                            sx={{ width: 130 }}
                                            value={field.value ?? ""}
                                            onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
                                            error={!!errors.shipment_items?.[index]?.makat}
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
                                            if (Number(value) < 1) return "Min 1";
                                            return true;
                                        }
                                    }}
                                    render={({ field }) => (
                                        <TextField
                                            {...field}
                                            label="כמות"
                                            type="number"
                                            required
                                            sx={{ width: 100 }}
                                            value={field.value === 0 ? '' : field.value ?? ''}
                                            onChange={(e) => field.onChange(e.target.value === '' ? 0 : Number(e.target.value))}
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
                            background: "linear-gradient(45deg, #1976d2, #42a5f5)",
                            boxShadow: "0 4px 12px rgba(25, 118, 210, 0.2)",
                            "&:hover": {
                                boxShadow: "0 6px 16px rgba(25, 118, 210, 0.3)"
                            }
                        }}
                    >
                        הוספה
                    </Button>
                </DialogActions>
            </form>
        </Dialog>
    );
}
