'use client'
import React, { useEffect, useState, useRef } from 'react'
import { Dialog, DialogTitle, DialogContent, Box, IconButton, Typography, TextField, Button } from "@/components/ui"
import AddItemDialog, { type NewItemForm, type SubItemForm, type Option } from "@/components/AddItemDialog"
import { NewItem, ItemTypeOption, Customers, Shipment } from '@/types'
import { Close as CloseIcon } from "@/components/ui/icons"
import { QrCodeScanner as QrCodeScannerIcon } from "@/components/ui/icons"
import { parseItemQr, ParsedItemData } from '@/app/lib/itemQrParser'
import { apiFetch } from "@/lib/api/client"

type TestingRoute = {
    test_route_id: number;
    item_type_id: number;
    route_number: number;
    route_steps: number[];
    route_name?: string;
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

/**
 * Container for the redesigned add-item popup. Renders the presentational
 * <AddItemDialog> (Shifthouse chrome) and owns all data flow: loading options,
 * fetching shipment items, filtering routes by item-type, the QR scanner +
 * batch logic, shipment auto-fill, and the POST to /api/items. External writes
 * into the dialog's form (QR autofill, shipment auto-fill, batch continuation)
 * go through `initialForm` + a remount `key`.
 */
export default function InsertPopup({ open, onClose, onCreate }: InsertPopupProps) {
    const [customers, setCustomers] = useState<Customers[]>([]);
    const [itemTypes, setItemTypes] = useState<ItemTypeOption[]>([]);
    const [shipments, setShipments] = useState<Shipment[]>([]);
    const [testingRoutes, setTestingRoutes] = useState<TestingRoute[]>([]);
    const [shipmentItems, setShipmentItems] = useState<ShipmentItem[]>([]);
    const [loadingShipmentItems, setLoadingShipmentItems] = useState(false);

    // latest form (lifted out of AddItemDialog via onFormChange)
    const [form, setForm] = useState<NewItemForm | null>(null);

    // seed = external writes into the dialog form; bump key to re-seed (remount)
    const [seedForm, setSeedForm] = useState<Partial<NewItemForm> | undefined>(undefined);
    const [seedKey, setSeedKey] = useState(0);
    const seed = (partial: Partial<NewItemForm>) => { setSeedForm(partial); setSeedKey((k) => k + 1); };
    const prevShipmentRef = useRef<string>("");

    // batch (driven by QR scan of a quantity > 1)
    const [pendingBatchItems, setPendingBatchItems] = useState<ParsedItemData[]>([]);
    const [currentBatchIndex, setCurrentBatchIndex] = useState(0);

    // scanner dialog
    const [scannerOpen, setScannerOpen] = useState(false);
    const [scanError, setScanError] = useState<string | null>(null);
    const [manualBarcodeInput, setManualBarcodeInput] = useState('');
    const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const selectedShipmentId = form?.shipment ? Number(form.shipment) : null;

    // base data on mount
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [customersRes, itemTypesRes] = await Promise.all([
                    apiFetch("/api/customers"),
                    apiFetch("/api/itemTypes"),
                ]);
                const customersData = customersRes.ok ? await customersRes.json() : [];
                const itemTypesData = itemTypesRes.ok ? await itemTypesRes.json() : [];
                if (!cancelled) {
                    setCustomers(Array.isArray(customersData) ? customersData : []);
                    setItemTypes(Array.isArray(itemTypesData) ? itemTypesData : []);
                }
                const shipmentsRes = await apiFetch("/api/shipments");
                const shipmentsData = await shipmentsRes.json();
                if (!cancelled) {
                    // Exclude finished shipments — can't add items to a shipment that already left.
                    const openShipments = Array.isArray(shipmentsData) ? shipmentsData.filter((s: Shipment) => !s.is_sent) : [];
                    setShipments(openShipments);
                }
                const routesRes = await apiFetch("/api/testing-routes");
                const routesData = await routesRes.json();
                if (!cancelled) setTestingRoutes(Array.isArray(routesData) ? routesData : []);
            } catch (error) {
                console.error("Error loading base data:", error);
                if (!cancelled) { setCustomers([]); setItemTypes([]); }
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // reset transient state whenever the popup opens OR closes. Resetting on
    // close too clears `seedForm` before the next open, so a reopened dialog
    // never seeds stale data (the child's open-effect runs before this one).
    useEffect(() => {
        setForm(null);
        setSeedForm(undefined);
        setPendingBatchItems([]);
        setCurrentBatchIndex(0);
        prevShipmentRef.current = "";
    }, [open]);

    // fetch the shipment's items whenever the selected shipment changes
    useEffect(() => {
        if (selectedShipmentId) {
            setLoadingShipmentItems(true);
            apiFetch(`/api/shipments/${selectedShipmentId}/items`)
                .then((res) => res.json())
                .then((data) => setShipmentItems(Array.isArray(data) ? data : []))
                .catch((err) => { console.error("Error fetching shipment items:", err); setShipmentItems([]); })
                .finally(() => setLoadingShipmentItems(false));
        } else {
            setShipmentItems([]);
        }
    }, [selectedShipmentId]);

    // ---- derived options for the dialog ----
    const selectedShipment = shipments.find((s) => s.id === selectedShipmentId);

    const shipmentOptions: Option[] = shipments.map((s) => ({
        value: String(s.id),
        label: `${s.shipment_code} | ${new Date(s.shipment_date).toLocaleDateString("he-IL")} | ${s.customer_code}`,
    }));

    const customerOptions: Option[] = customers.map((c) => ({
        value: String(c.id),
        label: c.customer_code ? `${c.name} (${c.customer_code})` : c.name,
    }));

    const filteredItemTypes = React.useMemo(() => {
        if (shipmentItems.length > 0) {
            return itemTypes.filter((it) => shipmentItems.some((si) => si.item_type_id === it.item_type_id));
        }
        if (selectedShipment?.item_type_id) {
            return itemTypes.filter((it) => it.item_type_id === selectedShipment.item_type_id);
        }
        return itemTypes;
    }, [selectedShipment, itemTypes, shipmentItems]);

    const itemTypeOptions: Option[] = filteredItemTypes.map((it) => ({ value: String(it.item_type_id), label: it.item_type_desc }));

    // routes filtered by the currently selected item-type (resolved from form)
    const routeOptions: Option[] = React.useMemo(() => {
        const itId = form?.itemType ? Number(form.itemType) : null;
        return testingRoutes
            .filter((r) => r.item_type_id === itId)
            .map((r) => ({ value: String(r.route_number), label: `מסלול ${r.route_number}` }));
    }, [testingRoutes, form?.itemType]);

    // ---- form change: track it + shipment auto-fill (customer/makat) ----
    const handleFormChange = React.useCallback((f: NewItemForm) => {
        setForm(f);
        if (f.shipment && f.shipment !== prevShipmentRef.current) {
            prevShipmentRef.current = f.shipment;
            const ship = shipments.find((s) => String(s.id) === f.shipment);
            if (ship) {
                seed({
                    ...f,
                    customer: ship.customer_id != null ? String(ship.customer_id) : "",
                    makat: ship.makat != null ? String(ship.makat) : "",
                    itemType: "",
                    routeNumber: "",
                });
            }
        } else if (!f.shipment && prevShipmentRef.current) {
            prevShipmentRef.current = "";
        }
    }, [shipments]);

    // ---- QR scan → fill fields (+ batch mode) ----
    const handleQrScan = React.useCallback((decodedText: string) => {
        if (!form?.shipment) { setScanError('יש לבחור משלוח תחילה'); return; }
        const parsed = parseItemQr(decodedText);
        if (!parsed) { setScanError('פורמט QR לא תקין או לא מתאים לפריט'); return; }

        const base: NewItemForm = {
            ...form,
            manufacturer: parsed.manufacturer ?? form.manufacturer,
            manufacturerNo: parsed.manufacturerNo ?? form.manufacturerNo,
            makat: parsed.makat != null ? String(parsed.makat) : form.makat,
            model: parsed.model || form.model,
        };

        if (parsed.serialNumber) {
            seed({ ...base, serialNumber: parsed.serialNumber });
            setPendingBatchItems([]);
            setCurrentBatchIndex(0);
            setScanError(null);
            setScannerOpen(false);
        } else {
            const batchSize = parsed.qtyToTest;
            if (batchSize > 0) {
                seed({ ...base, serialNumber: "" });
                setPendingBatchItems(Array(batchSize).fill(parsed));
                setCurrentBatchIndex(1);
                setScanError(null);
                setScannerOpen(false);
                alert(`זוהתה קבוצה של ${batchSize} פריטים. נא להזין מספר סריאלי עבור פריט 1.`);
            } else {
                setScanError('כמות לבדיקה לא תקינה (0)');
            }
        }
    }, [form]);

    const handleScanClick = () => {
        if (!form?.shipment) { alert('יש לבחור משלוח לפני הסריקה'); return; }
        setScannerOpen(true);
    };

    // ---- submit → build NewItem + POST + batch continuation ----
    const handleSubmit = async (f: NewItemForm, subItems: SubItemForm[]) => {
        const num = (v: string) => (v ? Number(v) : null);
        const payload: NewItem = {
            customer: num(f.customer),
            itemType: num(f.itemType),
            serialNumber: f.serialNumber || null,
            makat: f.makat ? Number(f.makat) : null,
            model: f.model || undefined,
            manufacturer: f.manufacturer || undefined,
            manufacturerNo: f.manufacturerNo || undefined,
            shipment: num(f.shipment),
            routeNumber: f.routeNumber ? Number(f.routeNumber) : 1,
            subItems: subItems.map((sub) => ({
                customer: num(f.customer),
                itemType: num(sub.itemType),
                serialNumber: sub.serialNumber || null,
                makat: sub.makat ? Number(sub.makat) : null,
                model: sub.model || undefined,
                manufacturer: sub.manufacturer || undefined,
                manufacturerNo: sub.manufacturerNo || undefined,
                shipment: num(f.shipment),
                routeNumber: 1,
            })),
        };

        try {
            const res = await apiFetch("/api/items", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const success = res.ok;

            if (success && pendingBatchItems.length > 0 && currentBatchIndex < pendingBatchItems.length) {
                // stay open, advance to the next item in the batch, keep fields, clear serial
                setCurrentBatchIndex((prev) => prev + 1);
                seed({ ...f, serialNumber: "" });
                onCreate(payload, true);
            } else {
                onCreate(payload, success);
                if (currentBatchIndex >= pendingBatchItems.length) {
                    setPendingBatchItems([]);
                    setCurrentBatchIndex(0);
                    onClose();
                }
            }
        } catch (error) {
            console.log(error);
            onCreate(payload, false);
            onClose();
        }
    };

    return (
        <>
            <AddItemDialog
                key={seedKey}
                open={open}
                onClose={onClose}
                onSubmit={handleSubmit}
                onScan={handleScanClick}
                shipmentOptions={shipmentOptions}
                customerOptions={customerOptions}
                itemTypeOptions={itemTypeOptions}
                routeOptions={routeOptions}
                shipmentItems={shipmentItems}
                loadingShipmentItems={loadingShipmentItems}
                batchIndex={currentBatchIndex}
                batchTotal={pendingBatchItems.length}
                onFormChange={handleFormChange}
                initialForm={seedForm}
            />

            {/* Scanner Dialog */}
            <Dialog
                open={scannerOpen}
                onClose={() => { setScannerOpen(false); setScanError(null); setManualBarcodeInput(''); }}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>סריקת פריט</span>
                    <IconButton onClick={() => { setScannerOpen(false); setScanError(null); setManualBarcodeInput(''); }}>
                        <CloseIcon />
                    </IconButton>
                </DialogTitle>
                <DialogContent>
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, py: 4 }}>
                        {scanError && (
                            <Box sx={{ width: '100%', p: 2, bgcolor: 'rgba(191,53,53,0.08)', color: 'var(--color-destructive)', borderRadius: 'var(--r-sm)', textAlign: 'center' }}>
                                {scanError}
                            </Box>
                        )}
                        <QrCodeScannerIcon sx={{ fontSize: 80, color: 'var(--color-ink-muted-48)', opacity: 0.5 }} />
                        <Typography variant="h6" textAlign="center">נא לסרוק את הברקוד כעת</Typography>
                        <TextField
                            autoFocus
                            fullWidth
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
    );
}
