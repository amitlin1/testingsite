"use client";
import React, { useState, useEffect, useCallback } from "react";
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Button, IconButton, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Snackbar, Alert, Box, InputAdornment, CircularProgress, Typography
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import SearchIcon from "@mui/icons-material/Search";

interface StationTypesTableProps {
  selectedId: number | null;
  onSelect: (id: number, name: string) => void;
}

export default function StationTypesTable({ selectedId, onSelect }: StationTypesTableProps) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  // Dialog
  const [openDialog, setOpenDialog] = useState(false);
  const [editingRow, setEditingRow] = useState<any | null>(null);
  const [formData, setFormData] = useState<any>({});
  const [saveLoading, setSaveLoading] = useState(false);

  // Delete
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [rowToDelete, setRowToDelete] = useState<any | null>(null);

  // Snackbar
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: "success" | "error" }>({
    open: false, message: "", severity: "success"
  });

  const apiUrl = "/api/settings/test-stations-type";

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setSnackbar({ open: true, message: "שגיאה בטעינת נתונים", severity: "error" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSave = async () => {
    if (!formData.test_type_desc?.trim()) {
      setSnackbar({ open: true, message: "תיאור חובה", severity: "error" });
      return;
    }

    setSaveLoading(true);
    try {
      const method = editingRow ? "PUT" : "POST";
      const url = editingRow ? `${apiUrl}/${editingRow.test_station_type_id}` : apiUrl;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!res.ok) throw new Error("Failed to save");
      const savedRow = await res.json();

      if (editingRow && savedRow) {
        setRows(rows.map(r => r.test_station_type_id === savedRow.test_station_type_id ? savedRow : r));
        if (selectedId === savedRow.test_station_type_id) {
          onSelect(savedRow.test_station_type_id, savedRow.test_type_desc);
        }
      } else {
        setRows([...rows, savedRow]);
      }
      setOpenDialog(false);
      setSnackbar({ open: true, message: "נשמר בהצלחה", severity: "success" });
    } catch (err) {
      setSnackbar({ open: true, message: "שגיאה בשמירה", severity: "error" });
    } finally {
      setSaveLoading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!rowToDelete) return;
    try {
      const res = await fetch(`${apiUrl}/${rowToDelete.test_station_type_id}`, { method: "DELETE" });
      if (!res.ok) {
        // Check for 409
        if (res.status === 409) throw new Error("לא ניתן למחוק כי קיימות עמדות משויכות");
        throw new Error("Failed to delete");
      }
      setRows(rows.filter(r => r.test_station_type_id !== rowToDelete.test_station_type_id));
      if (selectedId === rowToDelete.test_station_type_id) {
        onSelect(0, ""); // Deselect
      }
      setSnackbar({ open: true, message: "נמחק בהצלחה", severity: "success" });
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || "שגיאה במחיקה", severity: "error" });
    } finally {
      setDeleteConfirmOpen(false);
      setRowToDelete(null);
    }
  };

  const filteredRows = rows.filter(r =>
    r.test_type_desc.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Box sx={{ p: 2, height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 2, alignItems: "center", flexShrink: 0 }}>
        <Typography variant="h6" fontWeight="bold" sx={{ fontSize: "1rem" }}>סוגי עמדות</Typography>
        <Button variant="contained" size="small" startIcon={<AddIcon sx={{ ml: 0.5 }} />} onClick={() => {
          setEditingRow(null);
          setFormData({});
          setOpenDialog(true);
        }}>
          הוסף
        </Button>
      </Box>

      <TextField
        size="small"
        placeholder="חיפוש..."
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
              <TableCell align="center" width={80} sx={{ fontWeight: "bold", bgcolor: "#f5f5f5" }}>פעולות</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={2} align="center"><CircularProgress size={20} /></TableCell></TableRow>
            ) : filteredRows.map(row => (
              <TableRow
                key={row.test_station_type_id}
                hover
                selected={selectedId === row.test_station_type_id}
                onClick={() => onSelect(row.test_station_type_id, row.test_type_desc)}
                sx={{ cursor: "pointer" }}
              >
                <TableCell align="right">{row.test_type_desc}</TableCell>
                <TableCell align="center" onClick={(e) => e.stopPropagation()}>
                  <Box sx={{ display: "flex" }}>
                    <IconButton size="small" color="primary" onClick={() => {
                      setEditingRow(row);
                      setFormData({ ...row });
                      setOpenDialog(true);
                    }}><EditIcon fontSize="small" /></IconButton>
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
        <DialogTitle>{editingRow ? "ערוך סוג" : "הוסף סוג"}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="תיאור סוג עמדה"
            fullWidth
            value={formData.test_type_desc || ""}
            onChange={(e) => setFormData({ ...formData, test_type_desc: e.target.value })}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDialog(false)}>ביטול</Button>
          <Button onClick={handleSave} variant="contained" disabled={saveLoading}>שמור</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)} dir="rtl">
        <DialogTitle>מחיקה</DialogTitle>
        <DialogContent>בטוח שברצונך למחוק?</DialogContent>
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
