"use client";
import React, { useState, useEffect, useCallback } from "react";
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Button, IconButton, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Snackbar, Alert, Box, InputAdornment, CircularProgress, Typography,
  Switch, FormControlLabel, Select, MenuItem, InputLabel, FormControl
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import SearchIcon from "@mui/icons-material/Search";

interface StationsTableProps {
  typeId: number;
  typeName: string;
}

import { TestStation, TestStationStatus } from "@/types";

interface StationsTableProps {
  typeId: number;
  typeName: string;
}

export default function StationsTable({ typeId, typeName }: StationsTableProps) {
  const [rows, setRows] = useState<TestStation[]>([]);
  const [statuses, setStatuses] = useState<TestStationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  
  // Dialog
  const [openDialog, setOpenDialog] = useState(false);
  const [editingRow, setEditingRow] = useState<TestStation | null>(null);
  const [formData, setFormData] = useState<Partial<TestStation>>({});
  const [saveLoading, setSaveLoading] = useState(false);
  
  // Delete
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [rowToDelete, setRowToDelete] = useState<TestStation | null>(null);

  // Snackbar
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: "success" | "error" }>({
    open: false, message: "", severity: "success"
  });

  const apiUrl = "/api/settings/test-stations";

  // Fetch Statuses
  useEffect(() => {
    fetch("/api/settings/test-station-status")
      .then(res => res.json())
      .then(data => setStatuses(data))
      .catch(err => console.error("Failed to load statuses", err));
  }, []);

  // Fetch Stations when typeId changes
  const fetchData = useCallback(async () => {
    if (!typeId) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}?typeId=${typeId}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (err) { // Keep err usage minimal or log it
       console.error(err);
      setSnackbar({ open: true, message: "שגיאה בטעינת עמדות", severity: "error" });
    } finally {
      setLoading(false);
    }
  }, [typeId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAdd = () => {
    setEditingRow(null);
    setFormData({ 
      test_station_type_id: typeId,
      status: 1, // Default active?
      is_research: false
    });
    setOpenDialog(true);
  };

  const handleEdit = (row: TestStation) => {
    setEditingRow(row);
    setFormData({ ...row });
    setOpenDialog(true);
  };

  const handleSave = async () => {
    if (!formData.test_station_desc?.trim()) {
      setSnackbar({ open: true, message: "תיאור חובה", severity: "error" });
      return;
    }

    setSaveLoading(true);
    try {
      const method = editingRow ? "PUT" : "POST";
      const url = editingRow ? `${apiUrl}/${editingRow.test_station_id}` : apiUrl;
      
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!res.ok) throw new Error("Failed to save");
      const savedRow = await res.json();

      if (editingRow && savedRow) {
        setRows(rows.map(r => r.test_station_id === savedRow.test_station_id ? savedRow : r));
      } else if (savedRow) {
        setRows([...rows, savedRow]);
      }
      setOpenDialog(false);
      setSnackbar({ open: true, message: "נשמר בהצלחה", severity: "success" });
    } catch (err) {
      console.error(err);
      setSnackbar({ open: true, message: "שגיאה בשמירה", severity: "error" });
    } finally {
      setSaveLoading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!rowToDelete) return;
    try {
      const res = await fetch(`${apiUrl}/${rowToDelete.test_station_id}`, { method: "DELETE" });
      if (!res.ok) {
          if (res.status === 409) throw new Error("לא ניתן למחוק כי העמדה בשימוש");
          throw new Error("Failed to delete");
      }
      setRows(rows.filter(r => r.test_station_id !== rowToDelete.test_station_id));
      setSnackbar({ open: true, message: "נמחק בהצלחה", severity: "success" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "שגיאה במחיקה";
      setSnackbar({ open: true, message, severity: "error" });
    } finally {
      setDeleteConfirmOpen(false);
      setRowToDelete(null);
    }
  };

  const filteredRows = rows.filter(r => 
    r.test_station_desc.toLowerCase().includes(searchTerm.toLowerCase())
  );
// ... Rest of the file is mostly generic JSX but let me verify if I need to change anything else
// Returning the same JSX structure but with types available
  return (
    <Box sx={{ p: 2, height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 2, alignItems: "center", flexShrink: 0 }}>
        <Typography variant="h6" fontWeight="bold" sx={{ fontSize: "1rem" }}>
          עמדות עבור: {typeName}
        </Typography>
        <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={handleAdd}>
          הוסף עמדה
        </Button>
      </Box>
      
      <TextField
        size="small"
        placeholder="חיפוש עמדה..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        fullWidth
        sx={{ mb: 2, flexShrink: 0 }}
        InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }}
      />

      <TableContainer sx={{ flexGrow: 1, overflow: "auto", border: "1px solid #eee", borderRadius: 1 }}>
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow>
              <TableCell align="right" sx={{ fontWeight: "bold", bgcolor: "#f5f5f5" }}>תיאור</TableCell>
              <TableCell align="right" sx={{ fontWeight: "bold", bgcolor: "#f5f5f5" }}>סטטוס</TableCell>
              <TableCell align="right" sx={{ fontWeight: "bold", bgcolor: "#f5f5f5" }}>מחקר?</TableCell>
              <TableCell align="center" width={100} sx={{ fontWeight: "bold", bgcolor: "#f5f5f5" }}>פעולות</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
               <TableRow><TableCell colSpan={4} align="center"><CircularProgress size={20} /></TableCell></TableRow>
            ) : filteredRows.length === 0 ? (
                <TableRow><TableCell colSpan={4} align="center">אין עמדות</TableCell></TableRow>
            ) : filteredRows.map(row => (
              <TableRow key={row.test_station_id} hover>
                <TableCell align="right">{row.test_station_desc}</TableCell>
                <TableCell align="right">
                  {statuses.find(s => s.test_station_status_id === row.status)?.test_station_status_desc || row.status}
                </TableCell>
                <TableCell align="right">{row.is_research ? "כן" : "לא"}</TableCell>
                <TableCell align="center">
                  <Box sx={{ display: "flex" }}>
                    <IconButton size="small" color="primary" onClick={() => handleEdit(row)}><EditIcon fontSize="small" /></IconButton>
                    <IconButton size="small" color="error" onClick={() => {
                      setRowToDelete(row);
                      setDeleteConfirmOpen(true);
                    }}><DeleteIcon fontSize="small" /></IconButton>
                  </Box>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Dialogs */}
      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} maxWidth="sm" fullWidth dir="rtl">
        <DialogTitle>{editingRow ? "ערוך עמדה" : "הוסף עמדה"}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
            <TextField
              label="תיאור עמדה"
              fullWidth
              value={formData.test_station_desc || ""}
              onChange={(e) => setFormData({ ...formData, test_station_desc: e.target.value })}
            />
            <FormControl fullWidth>
              <InputLabel>סטטוס</InputLabel>
              <Select
                value={formData.status || ""}
                label="סטטוס"
                onChange={(e) => setFormData({ ...formData, status: Number(e.target.value) })}
              >
                {statuses.map(s => (
                  <MenuItem key={s.test_station_status_id} value={s.test_station_status_id}>
                    {s.test_station_status_desc}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControlLabel
              control={
                <Switch
                  checked={formData.is_research || false}
                  onChange={(e) => setFormData({ ...formData, is_research: e.target.checked })}
                />
              }
              label="עמדת מחקר"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDialog(false)}>ביטול</Button>
          <Button onClick={handleSave} variant="contained" disabled={saveLoading}>שמור</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)} dir="rtl">
        <DialogTitle>מחיקה</DialogTitle>
        <DialogContent>בטוח שברצונך למחוק את העמדה &quot;{rowToDelete?.test_station_desc}&quot;?</DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmOpen(false)}>ביטול</Button>
          <Button onClick={handleDeleteConfirm} color="error">מחק</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar({ ...snackbar, open: false })}>
        <Alert severity={snackbar.severity}>{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  );
}
