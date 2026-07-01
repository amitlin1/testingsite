"use client";
import * as React from "react";
import {
  Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Autocomplete, TextField, Skeleton, Box, Toolbar, Stack, IconButton, Button,
  Fab, Snackbar, Alert, Chip, alpha, LinearProgress, Typography
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import { TableVirtuoso } from "react-virtuoso";
import ItemDialog from "./ItemDialog";
import InsertPopup from "./insertPopup";
import BarcodeDialog from "./BarcodeDialog";
import QrCodeIcon from '@mui/icons-material/QrCode';
import { ItemRow, StatusOption, NewItem, ItemTypeOption, Customers, Shipment } from "@/types";
import { Grid, InputAdornment, Tooltip, Divider } from "@mui/material";
import FilterListIcon from '@mui/icons-material/FilterList';
import RefreshIcon from '@mui/icons-material/Refresh';
import InventoryIcon from '@mui/icons-material/Inventory'; // New icon for management
import TuneIcon from '@mui/icons-material/Tune';

export default function ItemTable() {
  const [rows, setRows] = React.useState<ItemRow[]>([]);
  const [statuses, setStatuses] = React.useState<StatusOption[]>([]);
  const [itemTypes, setItemTypes] = React.useState<ItemTypeOption[]>([]);
  const [customers, setCustomers] = React.useState<Customers[]>([]);
  const [shipments, setShipments] = React.useState<Shipment[]>([]);

  const [loading, setLoading] = React.useState(true);
  const [selected, setSelected] = React.useState<ItemRow | null>(null);

  // new: control insert popup
  const [insertOpen, setInsertOpen] = React.useState(false);

  // snackbar state to display result of insert
  const [snackbarOpen, setSnackbarOpen] = React.useState(false);
  const [snackbarMessage, setSnackbarMessage] = React.useState("");
  const [snackbarSeverity, setSnackbarSeverity] = React.useState<'success' | 'error'>('success');

  // filtering state
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<StatusOption | null>(null);
  const [typeFilter, setTypeFilter] = React.useState<ItemTypeOption | null>(null);
  const [shipmentFilter, setShipmentFilter] = React.useState<Shipment | null>(null);

  // Barcode dialog state
  const [barcodeOpen, setBarcodeOpen] = React.useState(false);
  const [barcodeItem, setBarcodeItem] = React.useState<{ id: number; sourceId?: number | null; serial?: string } | null>(null);

  const handleOpenBarcode = (e: React.MouseEvent, row: ItemRow) => {
    e.stopPropagation(); // Prevent row click
    setBarcodeItem({ id: row.item_id, sourceId: row.source_id || null, serial: row.serial_no || undefined });
    setBarcodeOpen(true);
  };

  // load items (can be reused to refresh table after popup closes)
  const loadItems = React.useCallback(async () => {
    try {
      setLoading(true);
      const r = await fetch("/api/items");
      if (!r.ok) {
        throw new Error(`HTTP error! status: ${r.status}`);
      }
      const items = await r.json();
      setRows(Array.isArray(items) ? items : []);
    } catch (e) {
      // keep previous rows on error
      console.error("Failed to load items", e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // initial load: items + statuses + customers + itemTypes
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [r1, r2, r3, r4, r5] = await Promise.all([
          fetch("/api/items"),
          fetch("/api/statuses"),
          fetch("/api/customers"),
          fetch("/api/itemTypes"),
          fetch("/api/shipments")
        ]);
        const items = r1.ok ? await r1.json() : [];
        const stats = r2.ok ? await r2.json() : [];
        const custs = r3.ok ? await r3.json() : [];
        const types = r4.ok ? await r4.json() : [];
        const ships = r5.ok ? await r5.json() : [];
        console.log("Fetched shipments in ItemTable:", ships);
        if (cancelled) return;
        setRows(Array.isArray(items) ? items : []);
        setStatuses(Array.isArray(stats) ? stats : []);
        setCustomers(Array.isArray(custs) ? custs : []);
        setItemTypes(Array.isArray(types) ? types : []);
        setShipments(Array.isArray(ships) ? ships : []);
        setLoading(false);
      } catch (error) {
        console.error("Error loading data:", error);
        if (!cancelled) {
          setRows([]);
          setStatuses([]);
          setCustomers([]);
          setItemTypes([]);
          setShipments([]);
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleStatusChange = async (row: ItemRow, newStatus: StatusOption | null) => {
    if (!newStatus) return;
    await fetch(`/api/items/${row.item_id}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statusId: newStatus.id }),
    });
    setRows((prev) =>
      prev.map((r) =>
        r.item_id === row.item_id
          ? { ...r, current_status: newStatus.id, item_status_desc: newStatus.label }
          : r
      )
    );
  };

  // derived list of item types for filtering
  const typeOptions = React.useMemo(() => {
    if (!Array.isArray(rows)) return [];
    const sett = new Set<string>();
    rows.forEach((r) => sett.add(r.item_type_desc ?? "-"));
    return Array.from(sett);
  }, [rows]);

  const getStatusColor = (statusId: number | null) => {
    if (!statusId) return "#757575";
    switch (statusId) {
      case 1: return "#1976d2"; // Blue
      case 2: return "#ff9800"; // Orange
      case 3: return "#4caf50"; // Green
      case 4: return "#ffeb3b"; // Yellow
      case 5: return "#9c27b0"; // Purple
      default: return "#757575"; // Grey
    }
  };

  // filtered rows
  const filteredRows = React.useMemo(() => {
    if (!Array.isArray(rows)) return [];
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (q) {
        const name = `${row.model ?? ""} ${row.customer_code ?? ""}`.toLowerCase();
        const serial = (row.serial_no ?? "").toString().toLowerCase();
        if (!name.includes(q) && !serial.includes(q)) return false;
      }

      if (statusFilter) {
        if (row.current_status !== statusFilter.id) {
          return false;
        }
      } else {
        // Default: hide items with status 3 (finished/green) unless explicitly filtered
        if (row.current_status === 3) return false;
      }

      if (typeFilter) {
        if (row.item_type_id !== typeFilter.item_type_id) return false;
      }

      if (shipmentFilter) {
        if (row.shipment_id !== shipmentFilter.id) return false;
      }
      return true;
    });
  }, [rows, search, statusFilter, typeFilter, shipmentFilter]);

  const clearFilters = () => {
    setSearch("");
    setStatusFilter(null);
    setTypeFilter(null);
    setShipmentFilter(null);
  };

  // create handler for InsertPopup — now receives success boolean and optional created item
  const displaySnackbar = (data: NewItem, success: boolean) => {
    // only display snackbar based on success — do not mutate local rows here.
    if (success) {
      setSnackbarMessage("Listing created successfully");
      setSnackbarSeverity("success");
    } else {
      setSnackbarMessage("Failed to create listing on server");
      setSnackbarSeverity("error");
    }
    setSnackbarOpen(true);
  };

  // close handler for the insert popup — closes popup and refreshes items
  const closeInsertPopup = () => {
    setInsertOpen(false);
    // refresh items after popup closes (either cancel or create)
    loadItems();
  };

  if (loading) {
    return (
      <Paper sx={{ height: 600, p: 2 }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} variant="rectangular" height={50} sx={{ my: 1 }} />
        ))}
      </Paper>
    );
  }

  return (
    <>
      <Paper
        elevation={0}
        sx={{
          p: 3,
          mb: 3,
          borderRadius: 4,
          background: 'linear-gradient(145deg, #ffffff 0%, #f5f7fa 100%)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.05)',
          border: '1px solid rgba(255,255,255,0.6)'
        }}
      >
        <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 3 }}>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Box sx={{
              p: 1,
              borderRadius: 2,
              bgcolor: alpha('#1976d2', 0.1),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <InventoryIcon color="primary" />
            </Box>
            <Typography variant="h5" fontWeight="700" color="#1e293b" sx={{ letterSpacing: '-0.5px' }}>
              ניהול פריטים
            </Typography>
          </Stack>
          <Box sx={{ flexGrow: 1 }} />
          {/* Refresh button hidden as requested
          <Tooltip title="רענן נתונים">
             <IconButton onClick={loadItems} size="small" sx={{ bgcolor: 'white', border: '1px solid #e0e0e0' }}>
                <RefreshIcon />
             </IconButton>
          </Tooltip>
          */}
          <Button
            variant="contained"
            color="primary"
            startIcon={<AddIcon />}
            onClick={() => setInsertOpen(true)}
            sx={{
              borderRadius: 3,
              px: 4,
              py: 1,
              textTransform: 'none',
              fontWeight: 600,
              fontSize: '1rem',
              boxShadow: '0 4px 14px 0 rgba(25, 118, 210, 0.39)',
              transition: 'transform 0.2s',
              '&:hover': {
                transform: 'scale(1.02)',
                boxShadow: '0 6px 20px 0 rgba(25, 118, 210, 0.39)',
              }
            }}
          >
            הוסף פריט
          </Button>
        </Stack>

        <Divider sx={{ mb: 2 }} />

        <Grid container spacing={2}>
          {/* Search */}
          <Grid size={{ xs: 12, md: 3 }}>
            <TextField
              fullWidth
              size="small"
              placeholder="חיפוש חופשי (שם, סדורי...)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              InputProps={{
                startAdornment: <InputAdornment position="start"><SearchIcon color="action" /></InputAdornment>,
                endAdornment: search ? (
                  <IconButton size="small" onClick={() => setSearch("")} edge="end"><ClearIcon fontSize="small" /></IconButton>
                ) : null
              }}
              sx={{ bgcolor: 'white', '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
            />
          </Grid>

          {/* Filters */}
          <Grid size={{ xs: 12, md: 2 }}>
            <Autocomplete
              size="small"
              options={statuses}
              getOptionLabel={(o) => o.label}
              value={statusFilter}
              onChange={(_, v) => setStatusFilter(v)}
              renderInput={(params) => <TextField {...params} InputLabelProps={{ shrink: true }} label="סטטוס" sx={{ bgcolor: 'white', '& .MuiOutlinedInput-root': { borderRadius: 2 } }} />}
            />
          </Grid>

          <Grid size={{ xs: 12, md: 2 }}>
            <Autocomplete
              size="small"
              options={itemTypes}
              getOptionLabel={(o) => o.item_type_desc}
              value={typeFilter}
              onChange={(_, v) => setTypeFilter(v)}
              renderInput={(params) => <TextField {...params} InputLabelProps={{ shrink: true }} label="סוג פריט" sx={{ bgcolor: 'white', '& .MuiOutlinedInput-root': { borderRadius: 2 } }} />}
            />
          </Grid>

          <Grid size={{ xs: 12, md: 3 }}>
            <Autocomplete
              size="small"
              options={shipments}
              getOptionLabel={(o) => `${o.shipment_code} - ${o.customer_name} (${new Date(o.shipment_date).toLocaleDateString()})`}
              value={shipmentFilter}
              onChange={(_, v) => setShipmentFilter(v)}
              renderInput={(params) => <TextField {...params} label="משלוח" sx={{ bgcolor: 'white', '& .MuiOutlinedInput-root': { borderRadius: 2 } }} />}
            />
          </Grid>

          <Grid size={{ xs: 12, md: 2 }}>
            <Button
              variant="outlined"
              color="inherit"
              onClick={clearFilters}
              startIcon={<ClearIcon />}
              fullWidth
              sx={{ height: 40, borderRadius: 2, borderColor: '#bdbdbd', color: '#757575' }}
            >
              נקה הכל
            </Button>
          </Grid>
        </Grid>
      </Paper>

      <Paper sx={{ height: '70vh', p: 1 }}>
        <TableVirtuoso
          data={filteredRows}
          components={{
            Scroller: TableContainer,
            Table: (props) => <Table {...props} stickyHeader aria-label="items table" />,
            TableHead,
            TableRow,
            TableBody,
          }}
          fixedHeaderContent={() => (
            <TableRow>
              {[
                { id: 'barcode', label: 'ברקוד', width: 60 },
                { id: 'type', label: 'סוג מוצר', width: 100 },
                { id: 'serial', label: 'מס\' סיריאלי', width: 100 },
                { id: 'makat', label: 'מקט', width: 80 },
                { id: 'model', label: 'דגם', width: 100 },
                { id: 'manufacturer', label: 'יצרן', width: 100 },
                { id: 'man_no', label: 'מס\' יצרן', width: 100 },
                { id: 'shipment_code', label: 'מס\' משלוח', width: 100 },
                { id: 'customer', label: 'לקוח', width: 90 },
                { id: 'status', label: 'סטטוס', width: 100 },
                { id: 'progress', label: 'התקדמות', width: 150 },
                { id: 'date', label: 'תאריך קליטה', width: 140 },
              ].map((head) => (
                <TableCell
                  key={head.id}
                  style={{
                    backgroundColor: '#f8fafc',
                    color: '#475569',
                    fontWeight: 700,
                    fontSize: '0.875rem',
                    borderBottom: '2px solid #e2e8f0',
                    width: head.width
                  }}
                >
                  {head.label}
                </TableCell>
              ))}
            </TableRow>
          )}
          itemContent={(_, row) => (
            <>
              <TableCell>
                <IconButton size="small" onClick={(e) => handleOpenBarcode(e, row)}>
                  <QrCodeIcon />
                </IconButton>
              </TableCell>
              <TableCell onClick={() => setSelected(row)}>{row.item_type_desc ?? "-"}</TableCell>
              <TableCell onClick={() => setSelected(row)}>{row.serial_no ?? "-"}</TableCell>
              <TableCell onClick={() => setSelected(row)}>{row.makat ?? "-"}</TableCell>
              <TableCell onClick={() => setSelected(row)}>{row.model ?? "-"}</TableCell>
              <TableCell onClick={() => setSelected(row)}>{row.manufacturer_name}</TableCell>
              <TableCell onClick={() => setSelected(row)}>{row.manufacturer_no}</TableCell>
              <TableCell onClick={() => setSelected(row)}>{row.shipment_code}</TableCell>
              <TableCell onClick={() => setSelected(row)}>{row.customer_code}</TableCell>
              <TableCell onClick={() => setSelected(row)}>
                {row.item_status_desc ? (
                  <Chip
                    label={row.item_status_desc}
                    size="small"
                    sx={{
                      borderRadius: 4,
                      fontWeight: 600,
                      fontSize: "0.75rem",
                      bgcolor: alpha(getStatusColor(row.current_status), 0.1),
                      color: getStatusColor(row.current_status),
                    }}
                  />
                ) : (
                  "-"
                )}
              </TableCell>
              <TableCell onClick={() => setSelected(row)}>
                {(() => {
                  if (row.parent_item_id !== null && row.parent_item_id !== undefined) {
                    return (
                      <Typography variant="body2" color="text.secondary">
                        -
                      </Typography>
                    );
                  }

                  const currentStep = row.current_route_step || 0;
                  const totalSteps = row.total_steps || 0;

                  let pct = 0;
                  let text = "-";

                  if (row.current_status === 3 || row.is_finished) {
                    pct = 100;
                    text = totalSteps > 0 ? `${totalSteps}/${totalSteps}` : "Finished";
                  } else if (totalSteps > 0) {
                    // Calculate percentage based on current step
                    // If step 1 of 5, we show it as "Step 1" and maybe 1/5th filled?
                    // Let's use simple logic: currentStep / totalSteps
                    pct = Math.min((currentStep / totalSteps) * 100, 100);
                    text = `${currentStep}/${totalSteps}`;
                  }

                  // Determine color
                  let barColor = '#1976d2'; // Default Blue
                  if (pct >= 100) barColor = 'green';
                  else if (pct >= 50) barColor = '#ff9800'; // Orange

                  return (
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <Box sx={{ width: '100%', mr: 1 }}>
                        <LinearProgress
                          variant="determinate"
                          value={pct}
                          sx={{
                            height: 10,
                            borderRadius: 5,
                            '& .MuiLinearProgress-bar': {
                              backgroundColor: barColor
                            }
                          }}
                        />
                      </Box>
                      <Box sx={{ minWidth: 35 }}>
                        <Typography variant="body2" color="text.secondary">
                          {text}
                        </Typography>
                      </Box>
                    </Box>
                  );
                })()}
              </TableCell>
              <TableCell onClick={() => setSelected(row)}>{row.created_at ? new Date(row.created_at).toLocaleString("he-IL") : "-"}</TableCell>
            </>
          )}
        />
      </Paper>

      {selected && (
        <ItemDialog
          itemId={selected.item_id}
          statusLabel={selected.item_status_desc ?? ""}
          onClose={() => setSelected(null)}
        />
      )}

      {/* Barcode Dialog */}
      {barcodeItem && (
        <BarcodeDialog
          open={barcodeOpen}
          onClose={() => setBarcodeOpen(false)}
          itemId={barcodeItem.id}
          sourceId={barcodeItem.sourceId}
          itemSerial={barcodeItem.serial}
        />
      )}

      {/* Insert popup */}
      <InsertPopup
        open={insertOpen}
        onClose={closeInsertPopup}
        onCreate={displaySnackbar}
      />

      <Snackbar
        open={snackbarOpen}
        autoHideDuration={4000}
        onClose={() => setSnackbarOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setSnackbarOpen(false)} severity={snackbarSeverity} sx={{ width: '100%' }}>
          {snackbarMessage}
        </Alert>
      </Snackbar>
    </>
  );
}
