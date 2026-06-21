'use client'
import React, { useEffect, useState, useRef } from 'react'
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    Autocomplete,
    Box,
    IconButton,
    Divider,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    Typography,
    Chip,
    LinearProgress,
    alpha,
    Skeleton
} from '@mui/material'
import { useForm, Controller, useFieldArray } from 'react-hook-form'
import { NewItem, ItemTypeOption, Customers, Shipment } from '@/types'
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import InventoryIcon from '@mui/icons-material/Inventory';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import CloseIcon from '@mui/icons-material/Close';
import { parseItemQr, ParsedItemData } from '@/app/lib/itemQrParser';

type TestingRoute = {
    test_route_id: number;
    item_type_id: number;
    route_number: number;
    route_steps: number[];
    route_name?: string; // Added optional just in case
};

type ShipmentItem = {
    id: number;
    shipment_id: number;
    item_type_id: number;
    item_type_desc: string;
    total_quantity: number;
    sample_count: number;
    makat: number | null;
};

type InsertPopupProps = {
    open: boolean
    onClose: () => void
    onCreate: (data: NewItem, success: boolean) => void
}

const newItem: NewItem = {
    customer: null,
    itemType: null,
    serialNumber: null,
    makat: null,
    model: undefined,
    manufacturer: undefined,
    manufacturerNo: undefined,
    shipment: null,
    routeNumber: 1,
    subItems: []
}

export default function InsertPopup({
    open,
    onClose,
    onCreate,
}: InsertPopupProps) {
    const [customers, setCustomers] = useState<Customers[]>([]);
    const [itemTypes, setItemTypes] = useState<ItemTypeOption[]>([]);
    const [shipments, setShipments] = useState<Shipment[]>([]);
    const [testingRoutes, setTestingRoutes] = useState<TestingRoute[]>([]);
    const [shipmentItems, setShipmentItems] = useState<ShipmentItem[]>([]);
    const [loadingShipmentItems, setLoadingShipmentItems] = useState(false);

    // QR Scanner state
    const [scannerOpen, setScannerOpen] = useState(false);
    const [scanError, setScanError] = useState<string | null>(null);
    const [manualBarcodeInput, setManualBarcodeInput] = useState('');
    const [pendingBatchItems, setPendingBatchItems] = useState<ParsedItemData[]>([]);
    const [currentBatchIndex, setCurrentBatchIndex] = useState(0);
    const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const { control, handleSubmit, reset, getValues, watch, setValue, formState: { errors, isValid } } = useForm<NewItem>({
        mode: 'onChange',
        defaultValues: newItem,
    })

    const { fields, append, remove } = useFieldArray({
        control,
        name: "subItems"
    });

    const selectedShipmentId = watch("shipment");
    const selectedItemType = watch("itemType");
    const selectedShipment = shipments.find(s => s.id === selectedShipmentId);

    // Fetch shipment items when shipment is selected
    useEffect(() => {
        if (selectedShipmentId) {
            setLoadingShipmentItems(true);
            fetch(`/api/shipments/${selectedShipmentId}/items`)
                .then(res => res.json())
                .then(data => {
                    setShipmentItems(Array.isArray(data) ? data : []);
                })
                .catch(err => {
                    console.error("Error fetching shipment items:", err);
                    setShipmentItems([]);
                })
                .finally(() => setLoadingShipmentItems(false));
        } else {
            setShipmentItems([]);
        }
    }, [selectedShipmentId]);

    const filteredItemTypes = React.useMemo(() => {
        // If we have shipment items, use those item types
        if (shipmentItems.length > 0) {
            return itemTypes.filter(it =>
                shipmentItems.some(si => si.item_type_id === it.item_type_id)
            );
        }
        // Fallback to old behavior
        if (selectedShipment?.item_type_id) {
            return itemTypes.filter(it => it.item_type_id === selectedShipment.item_type_id);
        }
        return itemTypes;
    }, [selectedShipment, itemTypes, shipmentItems]);

    // Fetch customers and itemTypes when component mounts
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [customersRes, itemTypesRes] = await Promise.all([
                    fetch("/api/customers"),
                    fetch("/api/itemTypes")
                ]);
                const customersData = customersRes.ok ? await customersRes.json() : [];
                const itemTypesData = itemTypesRes.ok ? await itemTypesRes.json() : [];
                if (!cancelled) {
                    setCustomers(Array.isArray(customersData) ? customersData : []);
                    setItemTypes(Array.isArray(itemTypesData) ? itemTypesData : []);
                }
                const shipmentsRes = await fetch("/api/shipments");
                const shipmentsData = await shipmentsRes.json();
                if (!cancelled) {
                    setShipments(Array.isArray(shipmentsData) ? shipmentsData : []);
                }
                const routesRes = await fetch("/api/testing-routes");
                const routesData = await routesRes.json();
                if (!cancelled) {
                    setTestingRoutes(Array.isArray(routesData) ? routesData : []);
                }
            } catch (error) {
                console.error("Error loading customers/itemTypes:", error);
                if (!cancelled) {
                    setCustomers([]);
                    setItemTypes([]);
                }
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // Handle QR scan result
    const handleQrScan = React.useCallback((decodedText: string) => {
        if (!selectedShipmentId) {
            setScanError('יש לבחור משלוח תחילה');
            return;
        }

        const parsedData = parseItemQr(decodedText);

        if (parsedData) {
            // Populate common fields
            setValue('manufacturer', parsedData.manufacturer);
            setValue('manufacturerNo', parsedData.manufacturerNo);
            setValue('makat', Number(parsedData.makat));
            if (parsedData.model) {
                setValue('model', parsedData.model);
            }

            // Check if serial number exists
            if (parsedData.serialNumber) {
                // Single item mode
                setValue('serialNumber', parsedData.serialNumber);
                setPendingBatchItems([]);
                setCurrentBatchIndex(0);
                setScanError(null);
                setScannerOpen(false);
            } else {
                // Batch mode
                // Create placeholder items
                const batchSize = parsedData.qtyToTest;
                if (batchSize > 0) {
                    const batch = Array(batchSize).fill(parsedData);
                    setPendingBatchItems(batch);
                    setCurrentBatchIndex(1); // 1-based index for display
                    setValue('serialNumber', ''); // Clear serial for first entry
                    setScanError(null);
                    setScannerOpen(false);
                    // Use standard alert for now, or could use a toast if available
                    alert(`זוהתה קבוצה של ${batchSize} פריטים. נא להזין מספר סריאלי עבור פריט 1.`);
                } else {
                    setScanError('כמות לבדיקה לא תקינה (0)');
                }
            }
        } else {
            setScanError('פורמט QR לא תקין או לא מתאים לפריט');
        }
    }, [selectedShipmentId, setValue, selectedShipmentId]); // Added dependency

    const onSubmit = async (data: NewItem) => {
        // Prepare main item
        const payload: NewItem = {
            customer: data.customer,
            itemType: data.itemType,
            serialNumber: data.serialNumber || null,
            makat: data.makat ? Number(data.makat) : null,
            model: data.model || undefined,
            manufacturer: data.manufacturer || undefined,
            manufacturerNo: data.manufacturerNo || undefined,
            shipment: data.shipment,
            routeNumber: data.routeNumber,
            subItems: data.subItems?.map(sub => ({
                customer: data.customer, // Inherit customer from main? Usually yes.
                itemType: sub.itemType,
                serialNumber: sub.serialNumber || null,
                makat: sub.makat ? Number(sub.makat) : null,
                model: sub.model || undefined,
                manufacturer: sub.manufacturer || undefined,
                manufacturerNo: sub.manufacturerNo || undefined,
                shipment: data.shipment, // Inherit shipment
                routeNumber: 1 // Default route for sub-items? Or allow selection? Assuming 1 for simplicity or same logic as main.
            }))
        }

        try {
            const res = await fetch("/api/items", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            // success is boolean from current request
            const success = res.ok;

            // Batch logic
            if (success && pendingBatchItems.length > 0 && currentBatchIndex < pendingBatchItems.length) {
                // Stay open, increment index
                setCurrentBatchIndex(prev => prev + 1);
                // Reset serial, keep other fields
                // We keep manufacturer, makat, etc. from the form state (which are governed by react-hook-form)
                // We only need to clear serial number for the next item
                setValue('serialNumber', '');

                // Notify parent of success, but don't close dialog
                onCreate(payload, true);

                // Optional: alert or toast for next item?
                // For now, the UI title update is the indicator
            } else {
                // Normal flow or end of batch
                if (success) {
                    onCreate(payload, true);
                } else {
                    onCreate(payload, false);
                }

                if (currentBatchIndex >= pendingBatchItems.length) {
                    // End of batch or no batch
                    setPendingBatchItems([]);
                    setCurrentBatchIndex(0);
                    onClose();
                }
            }
        } catch (error) {
            console.log(error)
            onCreate(payload, false);
            onClose();
        }
    }

    useEffect(() => {
        if (open) {
            reset(newItem);
            setPendingBatchItems([]);
            setCurrentBatchIndex(0);
        }
    }, [open, reset])

    return (
        <>
            <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
                <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Typography variant="h6">הוסף פריט חדש לבדיקה</Typography>
                        {pendingBatchItems.length > 0 && (
                            <Chip
                                label={`פריט ${currentBatchIndex} מתוך ${pendingBatchItems.length}`}
                                color="secondary"
                                size="small"
                            />
                        )}
                    </Box>
                    <Box>
                        <IconButton
                            onClick={() => {
                                const shipment = getValues('shipment');
                                if (!shipment) {
                                    alert('יש לבחור משלוח לפני הסריקה');
                                    return;
                                }
                                setScannerOpen(true);
                            }}
                            color="primary"
                            // Disable if no shipment selected? logic inside onClick is better for feedback
                            title={"סרוק ברקוד"}
                        >
                            <QrCodeScannerIcon />
                        </IconButton>
                    </Box>
                </DialogTitle>
                <form onSubmit={handleSubmit(onSubmit)} noValidate>
                    <DialogContent>
                        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mt: 0.5 }}>
                            {/* Shipment */}
                            <Box sx={{ width: "100%" }}>
                                <Controller
                                    name="shipment"
                                    control={control}
                                    rules={{ required: 'Required' }}
                                    render={({ field: { onChange, value, ref, onBlur } }) => (
                                        <Autocomplete
                                            options={shipments}
                                            getOptionLabel={(option) => `${option.shipment_code} | ${new Date(option.shipment_date).toLocaleDateString("he-IL")} | ${option.customer_code}`}
                                            value={shipments.find(s => s.id === value) || null}
                                            onChange={(_, newValue) => {
                                                onChange(newValue?.id ?? null);
                                                if (newValue) {
                                                    reset({
                                                        ...getValues(),
                                                        shipment: newValue.id,
                                                        customer: newValue.customer_id,
                                                        makat: newValue.makat,
                                                        itemType: null
                                                    });
                                                }
                                            }}
                                            renderInput={(params) =>
                                                <TextField {...params} label="בחר משלוח" required inputRef={ref} onBlur={onBlur} error={!!errors.shipment} helperText={errors.shipment?.message} />
                                            }
                                        />
                                    )}
                                />
                            </Box>

                            {/* Shipment Items Table - Beautiful Display */}
                            {selectedShipmentId && (
                                <Box sx={{ width: '100%', mt: 1 }}>
                                    <Paper
                                        elevation={0}
                                        sx={{
                                            background: (theme) => alpha(theme.palette.primary.main, 0.03),
                                            border: '1px solid',
                                            borderColor: (theme) => alpha(theme.palette.primary.main, 0.15),
                                            borderRadius: 2,
                                            overflow: 'hidden'
                                        }}
                                    >
                                        <Box sx={{
                                            px: 2,
                                            py: 1.5,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 1,
                                            background: (theme) => `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.08)} 0%, ${alpha(theme.palette.secondary.main, 0.05)} 100%)`,
                                            borderBottom: '1px solid',
                                            borderColor: (theme) => alpha(theme.palette.primary.main, 0.1)
                                        }}>
                                            <InventoryIcon sx={{ color: 'primary.main', fontSize: 20 }} />
                                            <Typography variant="subtitle2" fontWeight={600} color="primary.main">
                                                פריטים במשלוח
                                            </Typography>
                                            {shipmentItems.length > 0 && (
                                                <Chip
                                                    label={`${shipmentItems.length} סוגים`}
                                                    size="small"
                                                    color="primary"
                                                    variant="outlined"
                                                    sx={{ ml: 'auto', height: 24 }}
                                                />
                                            )}
                                        </Box>

                                        {loadingShipmentItems ? (
                                            <Box sx={{ p: 2 }}>
                                                <Skeleton variant="rectangular" height={40} sx={{ borderRadius: 1, mb: 1 }} />
                                                <Skeleton variant="rectangular" height={40} sx={{ borderRadius: 1 }} />
                                            </Box>
                                        ) : shipmentItems.length > 0 ? (
                                            <TableContainer sx={{ overflowX: 'hidden' }}>
                                                <Table size="small" sx={{ tableLayout: 'fixed' }}>
                                                    <TableHead>
                                                        <TableRow sx={{ '& th': { fontWeight: 600, color: 'text.secondary', fontSize: '0.8rem' } }}>
                                                            <TableCell>סוג פריט</TableCell>
                                                            <TableCell align="center">מק"ט</TableCell>
                                                            <TableCell align="center">כמות כוללת</TableCell>
                                                            <TableCell align="center">כמות מדגם</TableCell>
                                                            <TableCell align="center" sx={{ width: 120 }}>התקדמות</TableCell>
                                                        </TableRow>
                                                    </TableHead>
                                                    <TableBody>
                                                        {shipmentItems.map((item) => {
                                                            const progress = item.total_quantity > 0
                                                                ? Math.round((item.sample_count / item.total_quantity) * 100)
                                                                : 0;
                                                            const progressColor = progress >= 100 ? 'success' : progress >= 50 ? 'warning' : 'primary';
                                                            const isSelected = selectedItemType === item.item_type_id;

                                                            return (
                                                                <TableRow
                                                                    key={item.id}
                                                                    onClick={() => {
                                                                        setValue('itemType', item.item_type_id, { shouldValidate: true });
                                                                        if (item.makat) {
                                                                            setValue('makat', item.makat, { shouldValidate: true });
                                                                        }
                                                                    }}
                                                                    sx={{
                                                                        cursor: 'pointer',
                                                                        transition: 'all 0.2s ease',
                                                                        bgcolor: isSelected
                                                                            ? (theme) => alpha(theme.palette.primary.main, 0.12)
                                                                            : 'transparent',
                                                                        borderRight: isSelected ? '3px solid' : 'none',
                                                                        borderColor: 'primary.main',
                                                                        '&:hover': {
                                                                            bgcolor: (theme) => alpha(theme.palette.primary.main, isSelected ? 0.15 : 0.06),
                                                                            transform: 'scale(1.005)'
                                                                        },
                                                                        '&:last-child td': { border: 0 }
                                                                    }}
                                                                >
                                                                    <TableCell>
                                                                        <Typography variant="body2" fontWeight={500}>
                                                                            {item.item_type_desc}
                                                                        </Typography>
                                                                    </TableCell>
                                                                    <TableCell align="center">
                                                                        <Chip
                                                                            label={item.makat || '-'}
                                                                            size="small"
                                                                            variant="outlined"
                                                                            sx={{
                                                                                fontSize: '0.75rem',
                                                                                height: 22,
                                                                                bgcolor: 'background.paper'
                                                                            }}
                                                                        />
                                                                    </TableCell>
                                                                    <TableCell align="center">
                                                                        <Typography variant="body2" fontWeight={600} color="text.secondary">
                                                                            {item.total_quantity}
                                                                        </Typography>
                                                                    </TableCell>
                                                                    <TableCell align="center">
                                                                        <Chip
                                                                            label={item.sample_count}
                                                                            size="small"
                                                                            color={progress >= 100 ? 'success' : 'default'}
                                                                            sx={{
                                                                                fontWeight: 600,
                                                                                height: 24,
                                                                                minWidth: 40
                                                                            }}
                                                                        />
                                                                    </TableCell>
                                                                    <TableCell align="center">
                                                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                                            <LinearProgress
                                                                                variant="determinate"
                                                                                value={Math.min(progress, 100)}
                                                                                color={progressColor}
                                                                                sx={{
                                                                                    flex: 1,
                                                                                    height: 8,
                                                                                    borderRadius: 4,
                                                                                    bgcolor: (theme) => alpha(theme.palette.grey[300], 0.5)
                                                                                }}
                                                                            />
                                                                            <Typography
                                                                                variant="caption"
                                                                                fontWeight={600}
                                                                                color={progressColor === 'success' ? 'success.main' : 'text.secondary'}
                                                                                sx={{ minWidth: 35, textAlign: 'right' }}
                                                                            >
                                                                                {progress}%
                                                                            </Typography>
                                                                        </Box>
                                                                    </TableCell>
                                                                </TableRow>
                                                            );
                                                        })}
                                                    </TableBody>
                                                </Table>
                                            </TableContainer>
                                        ) : (
                                            <Box sx={{ p: 3, textAlign: 'center' }}>
                                                <Typography variant="body2" color="text.secondary">
                                                    אין פריטים מוגדרים למשלוח זה
                                                </Typography>
                                            </Box>
                                        )}
                                    </Paper>
                                </Box>
                            )}

                            {/* Customer */}
                            <Box sx={{ width: { xs: "100%", sm: "48%" } }}>
                                <Controller
                                    name="customer"
                                    control={control}
                                    rules={{ required: 'Required' }}
                                    render={({ field: { onChange, value, ref, onBlur } }) => (
                                        <Autocomplete
                                            options={customers}
                                            getOptionLabel={(option) => option.customer_code}
                                            value={customers.find(c => c.id === value) || null}
                                            onChange={(_, newValue) => onChange(newValue?.id ?? null)}
                                            renderInput={(params) => <TextField {...params} inputRef={ref} onBlur={onBlur} label="לקוח" required error={!!errors.customer} helperText={errors.customer?.message} />}
                                        />
                                    )}
                                />
                            </Box>

                            {/* Item Type */}
                            <Box sx={{ width: { xs: "100%", sm: "48%" } }}>
                                <Controller
                                    name="itemType"
                                    control={control}
                                    rules={{ required: 'Required' }}
                                    render={({ field: { onChange, value, ref, onBlur } }) => (
                                        <Autocomplete
                                            options={filteredItemTypes}
                                            getOptionLabel={(option) => option.item_type_desc}
                                            value={filteredItemTypes.find(it => it.item_type_id === value) || null}
                                            onChange={(_, newValue) => {
                                                onChange(newValue?.item_type_id ?? null);
                                                // Reset route
                                                const currentVals = getValues();
                                                reset({ ...currentVals, itemType: newValue?.item_type_id ?? null, routeNumber: 1, subItems: currentVals.subItems });
                                            }}
                                            renderInput={(params) => <TextField {...params} inputRef={ref} onBlur={onBlur} label="סוג פריט" required error={!!errors.itemType} helperText={errors.itemType?.message} />}
                                        />
                                    )}
                                />
                            </Box>

                            {/* Route Number */}
                            <Box sx={{ width: { xs: "100%", sm: "48%" } }}>
                                <Controller
                                    name="routeNumber"
                                    control={control}
                                    rules={{ required: 'Required' }}
                                    render={({ field: { onChange, value, ref, onBlur } }) => {
                                        const currentItemType = getValues("itemType");
                                        const availableRoutes = testingRoutes.filter(r => r.item_type_id === currentItemType);
                                        return (
                                            <Autocomplete
                                                options={availableRoutes}
                                                getOptionLabel={(option) => `מסלול ${option.route_number}`}
                                                value={availableRoutes.find(r => r.route_number === value) || null}
                                                onChange={(_, newValue) => onChange(newValue?.route_number ?? 1)}
                                                disabled={!currentItemType}
                                                renderInput={(params) => <TextField {...params} inputRef={ref} onBlur={onBlur} label="מסלול בדיקה" required error={!!errors.routeNumber} helperText={errors.routeNumber?.message} />}
                                            />
                                        );
                                    }}
                                />
                            </Box>

                            {/* Serial */}
                            <Box sx={{ width: { xs: "100%", sm: "48%" } }}>
                                <Controller
                                    name="serialNumber"
                                    control={control}
                                    rules={{ required: 'Required' }}
                                    render={({ field }) => (
                                        <TextField {...field} label="מס' סיריאלי" required fullWidth value={field.value ?? ''} onChange={e => field.onChange(e.target.value || null)} error={!!errors.serialNumber} helperText={errors.serialNumber?.message} />
                                    )}
                                />
                            </Box>

                            {/* Makat */}
                            <Box sx={{ width: { xs: "100%", sm: "48%" } }}>
                                <Controller
                                    name="makat"
                                    control={control}
                                    rules={{ required: 'Required' }}
                                    render={({ field }) => (
                                        <TextField {...field} label="מקט" type="number" required fullWidth value={field.value ?? ''} onChange={e => field.onChange(e.target.value === '' ? null : Number(e.target.value))} error={!!errors.makat} helperText={errors.makat?.message} />
                                    )}
                                />
                            </Box>

                            {/* Model */}
                            <Box sx={{ width: { xs: "100%", sm: "48%" } }}>
                                <Controller
                                    name="model"
                                    control={control}
                                    rules={{ required: 'Required', maxLength: 50 }}
                                    render={({ field }) => (
                                        <TextField {...field} label="מודל" required fullWidth value={field.value || ''} error={!!errors.model} helperText={errors.model?.message} />
                                    )}
                                />
                            </Box>

                            {/* Manufacturer */}
                            <Box sx={{ width: { xs: "100%", sm: "48%" } }}>
                                <Controller
                                    name="manufacturer"
                                    control={control}
                                    rules={{ required: 'Required', maxLength: 50 }}
                                    render={({ field }) => (
                                        <TextField {...field} label="יצרן" required fullWidth value={field.value || ''} error={!!errors.manufacturer} helperText={errors.manufacturer?.message} />
                                    )}
                                />
                            </Box>

                            {/* Manufacturer No */}
                            <Box sx={{ width: { xs: "100%", sm: "48%" } }}>
                                <Controller
                                    name="manufacturerNo"
                                    control={control}
                                    rules={{ required: 'Required' }}
                                    render={({ field }) => (
                                        <TextField {...field} label="מס' יצרן" required fullWidth value={field.value ?? ''} onChange={e => field.onChange(e.target.value === '' ? null : e.target.value)} error={!!errors.manufacturerNo} helperText={errors.manufacturerNo?.message} />
                                    )}
                                />
                            </Box>
                        </Box>

                        {/* SUB ITEMS SECTION */}
                        <Box sx={{ mt: 3 }}>
                            <Divider textAlign="left">פריטים מחוברים (Sub-items)</Divider>
                            <Box sx={{ mt: 2 }}>
                                {fields.map((item, index) => (
                                    <Box key={item.id} sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', mb: 2, p: 2, border: '1px dashed grey', borderRadius: 1 }}>
                                        <Box sx={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                                            {/* Item Type */}
                                            <Box sx={{ width: '45%' }}>
                                                <Controller
                                                    name={`subItems.${index}.itemType` as any}
                                                    control={control}
                                                    rules={{ required: 'Required' }}
                                                    render={({ field: { onChange, value } }) => (
                                                        <Autocomplete
                                                            options={itemTypes}
                                                            getOptionLabel={(o) => o.item_type_desc}
                                                            value={itemTypes.find(it => it.item_type_id === value) || null}
                                                            onChange={(_, n) => onChange(n?.item_type_id ?? null)}
                                                            renderInput={(params) => <TextField {...params} label="סוג פריט" size="small" required error={!!errors.subItems?.[index]?.itemType} />}
                                                        />
                                                    )}
                                                />
                                            </Box>
                                            <Box sx={{ width: '45%' }}>
                                                <Controller
                                                    name={`subItems.${index}.serialNumber` as any}
                                                    control={control}
                                                    rules={{ required: 'Required' }}
                                                    render={({ field }) => (
                                                        <TextField {...field} label="מס' סיריאלי" size="small" fullWidth required value={field.value ?? ''} onChange={e => field.onChange(e.target.value || null)} error={!!errors.subItems?.[index]?.serialNumber} />
                                                    )}
                                                />
                                            </Box>
                                            <Box sx={{ width: '45%' }}>
                                                <Controller
                                                    name={`subItems.${index}.makat` as any}
                                                    control={control}
                                                    rules={{ required: 'Required' }}
                                                    render={({ field }) => (
                                                        <TextField {...field} label="מקט" type="number" size="small" fullWidth required value={field.value ?? ''} onChange={e => field.onChange(e.target.value === '' ? null : Number(e.target.value))} error={!!errors.subItems?.[index]?.makat} />
                                                    )}
                                                />
                                            </Box>
                                            <Box sx={{ width: '45%' }}>
                                                <Controller
                                                    name={`subItems.${index}.model` as any}
                                                    control={control}
                                                    render={({ field }) => (
                                                        <TextField {...field} label="מודל" size="small" fullWidth value={field.value || ''} />
                                                    )}
                                                />
                                            </Box>
                                            <Box sx={{ width: '45%' }}>
                                                <Controller
                                                    name={`subItems.${index}.manufacturer` as any}
                                                    control={control}
                                                    render={({ field }) => (
                                                        <TextField {...field} label="יצרן" size="small" fullWidth value={field.value || ''} />
                                                    )}
                                                />
                                            </Box>
                                            <Box sx={{ width: '45%' }}>
                                                <Controller
                                                    name={`subItems.${index}.manufacturerNo` as any}
                                                    control={control}
                                                    render={({ field }) => (
                                                        <TextField {...field} label="מס' יצרן" size="small" fullWidth value={field.value ?? ''} onChange={e => field.onChange(e.target.value === '' ? null : e.target.value)} />
                                                    )}
                                                />
                                            </Box>
                                        </Box>
                                        <IconButton onClick={() => remove(index)} color="error">
                                            <DeleteIcon />
                                        </IconButton>
                                    </Box>
                                ))}
                                <Button
                                    variant="outlined"
                                    startIcon={<AddIcon />}
                                    onClick={() => {
                                        const mainItem = getValues();
                                        const requiredFields: (keyof NewItem)[] = ['customer', 'itemType', 'serialNumber', 'makat', 'model', 'manufacturer', 'manufacturerNo', 'shipment', 'routeNumber'];
                                        const isMainItemValid = requiredFields.every(field => {
                                            const val = mainItem[field];
                                            return val !== null && val !== undefined && val !== '';
                                        });

                                        if (!isMainItemValid) {
                                            alert("אנא מלא את פרטי הפריט הראשי לפני הוספת פריטים מחוברים");
                                            return;
                                        }

                                        append({
                                            ...newItem,
                                            subItems: undefined,
                                            manufacturer: mainItem.manufacturer,
                                            manufacturerNo: mainItem.manufacturerNo
                                        });
                                    }}
                                >
                                    הוסף פריט מחובר
                                </Button>
                            </Box>
                        </Box>

                    </DialogContent>
                    <DialogActions>
                        <Button onClick={onClose}>ביטול</Button>
                        <Button type="submit" disabled={!isValid} variant="contained">
                            {pendingBatchItems.length > 0 ? `הוסף פריט (${currentBatchIndex}/${pendingBatchItems.length})` : 'הוסף פריט'}
                        </Button>
                    </DialogActions>
                </form>
            </Dialog>

            {/* Scanner Dialog */}
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
                    <span>סריקת פריט</span>
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
                            <Box sx={{ width: '100%', p: 2, bgcolor: 'error.light', color: 'error.contrastText', borderRadius: 1 }}>
                                {scanError}
                            </Box>
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
                                    if (val.trim() && parseItemQr(val.trim())) {
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
        </>
    )
}