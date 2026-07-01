"use client";
import React, { useEffect, useState, useRef, useCallback } from "react";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    Box,
    Typography,
    useTheme,
    alpha,
    IconButton,
    Tooltip,
    Alert
} from "@mui/material";
import SearchableCombobox from "../common/SearchableCombobox";
import FieldLabel from "../common/FieldLabel";
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import CloseIcon from '@mui/icons-material/Close';
import LockIcon from '@mui/icons-material/Lock';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { Card, Stack } from "@mui/material";
import { useForm, Controller, useFieldArray } from "react-hook-form";
import { NewShipment, Customers, Shipment } from "@/types";
import SignatureCanvas from 'react-signature-canvas';
import { parseShipmentQr, isValidShipmentQr, convertQrDateToInputFormat } from '@/app/lib/qrParser';

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

    // When a shipment is filled from a scanned barcode its details are locked for
    // manual editing — only the fields the barcode does not provide stay editable.
    const [scanned, setScanned] = useState(false);

    // Duplicate-shipment dialog (shown when a scanned shipment already exists).
    const [duplicate, setDuplicate] = useState<Shipment | null>(null);

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
            setValue('shipment_date', new Date(convertedDate));
        }

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
            setScanned(false);
            setDuplicate(null);
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
        >
            <DialogTitle sx={{
                fontWeight: 700,
                color: "text.primary",
                borderBottom: `1px solid ${theme.palette.divider}`,
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
                            bgcolor: "primary.main",
                            color: 'white',
                            '&:hover': { bgcolor: "primary.dark" },
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

            {/* Duplicate shipment dialog — same template as the testing page station-move message */}
            <Dialog
                open={!!duplicate}
                onClose={() => setDuplicate(null)}
                PaperProps={{ sx: { borderRadius: 3, p: 2, minWidth: 400 } }}
            >
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <ErrorOutlineIcon color="error" fontSize="large" />
                    <Typography variant="h6" component="span" fontWeight="bold">
                        המשלוח כבר קיים במערכת
                    </Typography>
                </DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        <Box sx={{ p: 2, bgcolor: alpha(theme.palette.error.main, 0.1), borderRadius: 2 }}>
                            <Typography variant="body1" fontWeight="600" color="error.main">
                                לא ניתן לקלוט את המשלוח — קיים כבר משלוח עם אותם הפרטים.
                            </Typography>
                        </Box>
                        {duplicate && (
                            <Card variant="outlined" sx={{ p: 2, bgcolor: "#f8f9fa" }}>
                                <Stack spacing={1}>
                                    <Typography variant="body2" color="text.secondary">
                                        מס׳ משלוח: <strong>{duplicate.shipment_code}</strong>
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        קוד לקוח: <strong>{duplicate.customer_code}</strong>
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        תאריך קבלה: <strong>{new Date(duplicate.shipment_date).toLocaleDateString("he-IL")}</strong>
                                    </Typography>
                                </Stack>
                            </Card>
                        )}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={() => setDuplicate(null)}
                        variant="contained"
                        color="error"
                        size="large"
                        sx={{ borderRadius: 2, px: 4 }}
                    >
                        אישור
                    </Button>
                </DialogActions>
            </Dialog>

            <form onSubmit={handleSubmit(onSubmit)} noValidate>
                <DialogContent>
                    {scanned && (
                        <Alert
                            severity="info"
                            icon={<LockIcon fontSize="inherit" />}
                            sx={{ mb: 2, borderRadius: 2 }}
                        >
                            הנתונים מולאו מסריקת ברקוד ונעולים לעריכה. ניתן להזין ידנית רק את שדות הפריטים שאינם כלולים בברקוד.
                        </Alert>
                    )}
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mt: 0.5 }}>
                        <Box sx={{ width: "100%" }}>
                             <FieldLabel>פרטי איש קשר (POC Details)</FieldLabel>
                             <Controller
                                name="poc_details"
                                control={control}
                                render={({ field }) => (
                                    <TextField
                                        {...field}
                                        placeholder="פרטי איש קשר"
                                        fullWidth
                                        size="small"
                                        multiline
                                        rows={2}
                                        disabled={scanned}
                                    />
                                )}
                            />
                        </Box>
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
                                        disabled={scanned}
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
                        </Box>
                        <Box sx={{ width: { xs: "100%", sm: "48%" } }}>
                            <FieldLabel>עובד מקבל</FieldLabel>
                            <Controller
                                name="recieving_worker_id"
                                control={control}
                                render={({ field: { onChange, value } }) => (
                                    <SearchableCombobox<{ worker_id: number; worker_name: string; stokekeeper?: boolean }>
                                        options={workers.filter(w => w.stokekeeper)}
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
                            <FieldLabel required>מקור</FieldLabel>
                            <Controller
                                name="source_id"
                                control={control}
                                rules={{ required: "חובה לבחור מקור" }}
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
                                        disabled={scanned}
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
                                        validate: (value) =>
                                            !value || Number(value) > 0 ? true : "Must be > 0",
                                    }}
                                    render={({ field }) => (
                                        <TextField
                                            {...field}
                                            placeholder="מקט"
                                            type="number"
                                            size="small"
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
                                            placeholder="כמות"
                                            type="number"
                                            required
                                            size="small"
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
                    {/* Auto-calculated total = Σ quantities */}
                    <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                            סה״כ כמות: <Box component="span" sx={{ color: 'primary.main', fontVariantNumeric: 'tabular-nums' }}>{watch("amount") || 0}</Box>
                        </Typography>
                    </Box>
                    {/* Signature Section — compact */}
                    <Box sx={{ mt: 2, borderTop: `1px solid ${theme.palette.divider}`, pt: 1.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                            <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.secondary' }}>חתימה</Typography>
                            <Button size="small" onClick={() => sigCanvas.current?.clear()}>נקה חתימה</Button>
                        </Box>
                        <Box sx={{ border: `1px solid ${theme.palette.divider}`, borderRadius: 2, overflow: 'hidden', bgcolor: '#fafafa' }}>
                            <SignatureCanvas
                                ref={sigCanvas}
                                canvasProps={{ width: 800, height: 120, className: 'sigCanvas' }}
                                backgroundColor="#fafafa"
                            />
                        </Box>
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
                        הוספה
                    </Button>
                </DialogActions>
            </form>
        </Dialog>
    );
}
