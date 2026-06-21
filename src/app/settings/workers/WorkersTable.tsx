"use client";
import React, { useState, useEffect, useCallback } from "react";
import {
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  Snackbar,
  Box,
  InputAdornment,
  CircularProgress,
  Typography,
  FormControlLabel,
  Checkbox
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import SearchIcon from "@mui/icons-material/Search";

import { Worker } from "@/types";

export default function WorkersTable() {
  const [rows, setRows] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  
  // Dialog State
  const [openDialog, setOpenDialog] = useState(false);
  const [editingRow, setEditingRow] = useState<Worker | null>(null);
  const [formData, setFormData] = useState<Partial<Worker>>({});
  const [saveLoading, setSaveLoading] = useState(false);
  
  // Form validation errors
  const [errors, setErrors] = useState<{ worker_id?: string; worker_name?: string }>({});
  
  // Delete Confirm State
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [rowToDelete, setRowToDelete] = useState<Worker | null>(null);

  // Snackbar State
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: "success" | "error" }>({
    open: false,
    message: "",
    severity: "success",
  });

  const apiUrl = "/api/settings/workers";

  const showSnackbar = (message: string, severity: "success" | "error") => {
    setSnackbar({ open: true, message, severity });
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl);
      if (!res.ok) throw new Error("Failed to fetch data");
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      showSnackbar("שגיאה בטעינת נתונים", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);


  const validateForm = (): boolean => {
    const newErrors: { worker_id?: string; worker_name?: string } = {};

    // Validate worker_id (only required for new workers)
    if (!editingRow) {
      if (!formData.worker_id || String(formData.worker_id).trim() === "") {
        newErrors.worker_id = "מזהה עובד הוא שדה חובה";
      } else {
        const idValue = String(formData.worker_id).trim();
        // Check if it's a valid integer (no decimals)
        if (!/^\d+$/.test(idValue)) {
          newErrors.worker_id = "מזהה עובד חייב להיות מספר שלם";
        } else {
          const numValue = parseInt(idValue, 10);
          if (isNaN(numValue) || numValue <= 0) {
            newErrors.worker_id = "מזהה עובד חייב להיות מספר חיובי";
          }
        }
      }
    }

    // Validate worker_name
    if (!formData.worker_name || String(formData.worker_name).trim() === "") {
      newErrors.worker_name = "שם עובד הוא שדה חובה";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleAdd = () => {
    setEditingRow(null);
    setFormData({});
    setErrors({});
    setOpenDialog(true);
  };

  const handleEdit = (row: Worker) => {
    setEditingRow(row);
    setFormData({ ...row });
    setErrors({});
    setOpenDialog(true);
  };

  const handleDeleteClick = (row: Worker) => {
    setRowToDelete(row);
    setDeleteConfirmOpen(true);
  };

  const handleSave = async () => {
    if (!validateForm()) {
      return;
    }

    setSaveLoading(true);
    try {
      const method = editingRow ? "PUT" : "POST";
      const url = editingRow ? `${apiUrl}/${editingRow.worker_id}` : apiUrl;
      
      // Prepare data: trim worker_name, ensure worker_id is number for POST
      const payload: Partial<Worker> = {
        worker_name: String(formData.worker_name).trim(),
        stokekeeper: !!formData.stokekeeper,
      };

      // Only include worker_id for POST (new workers)
      if (!editingRow) {
        payload.worker_id = parseInt(String(formData.worker_id).trim(), 10);
      }
      
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "שגיאה בשמירה");
      }

      const savedRow = await res.json();
      
      if (editingRow && savedRow) {
        setRows(rows.map(r => r.worker_id === savedRow.worker_id ? savedRow : r));
        showSnackbar("עובד עודכן בהצלחה", "success");
      } else {
        setRows([...rows, savedRow]);
        showSnackbar("עובד נוצר בהצלחה", "success");
      }
      setOpenDialog(false);
      setFormData({});
      setErrors({});
    } catch (err: any) {
      showSnackbar(err.message || "שגיאה בשמירה", "error");
    } finally {
      setSaveLoading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!rowToDelete) return;
    try {
      const res = await fetch(`${apiUrl}/${rowToDelete.worker_id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "שגיאה במחיקה");
      }

      setRows(rows.filter(r => r.worker_id !== rowToDelete.worker_id));
      showSnackbar("עובד נמחק בהצלחה", "success");
    } catch (err: any) {
      showSnackbar(err.message || "שגיאה במחיקה", "error");
    } finally {
      setDeleteConfirmOpen(false);
      setRowToDelete(null);
    }
  };

  const filteredRows = rows.filter(row => {
    if (!searchTerm) return true;
    const searchLower = searchTerm.toLowerCase();
    return (
      String(row.worker_id).toLowerCase().includes(searchLower) ||
      String(row.worker_name || "").toLowerCase().includes(searchLower)
    );
  });

  return (
    <Paper 
      elevation={0} 
      square
      sx={{ 
        flex: 1, 
        display: "flex", 
        flexDirection: "column", 
        m: 0, 
        p: 2, 
        borderRadius: 0,
        boxSizing: "border-box",
        overflow: "hidden"
      }}
    >
      {/* Toolbar */}
      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 2, gap: 2, flexShrink: 0 }}>
        <TextField
          size="small"
          placeholder="חיפוש..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          }}
          sx={{ maxWidth: 300 }}
        />
        <Button variant="contained" startIcon={<AddIcon />} onClick={handleAdd}>
          הוסף עובד
        </Button>
      </Box>

      {/* Table */}
      <TableContainer sx={{ flex: 1, overflow: "auto", border: "1px solid #eee", borderRadius: 1 }}>
        <Table size="medium" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell align="right" sx={{ fontWeight: "bold", bgcolor: "#f5f5f5" }} width={80}>
                מזהה עובד
              </TableCell>
              <TableCell align="right" sx={{ fontWeight: "bold", bgcolor: "#f5f5f5" }}>
                שם עובד
              </TableCell>
              <TableCell align="center" sx={{ fontWeight: "bold", width: 100, bgcolor: "#f5f5f5" }}>
                מחסנאי
              </TableCell>
              <TableCell align="center" sx={{ fontWeight: "bold", width: 120, bgcolor: "#f5f5f5" }}>
                פעולות
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} align="center" sx={{ py: 4 }}>
                  <CircularProgress />
                </TableCell>
              </TableRow>
            ) : filteredRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">לא נמצאו נתונים</Typography>
                </TableCell>
              </TableRow>
            ) : (
              filteredRows.map((row) => (
                <TableRow key={row.worker_id} hover>
                  <TableCell align="right">{row.worker_id}</TableCell>
                  <TableCell align="right">{row.worker_name}</TableCell>
                  <TableCell align="center">{row.stokekeeper ? "✓" : ""}</TableCell>
                  <TableCell align="center">
                    <IconButton size="small" color="primary" onClick={() => handleEdit(row)}>
                      <EditIcon />
                    </IconButton>
                    <IconButton size="small" color="error" onClick={() => handleDeleteClick(row)}>
                      <DeleteIcon />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Edit/Add Dialog */}
      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} maxWidth="sm" fullWidth dir="rtl">
        <DialogTitle sx={{ textAlign: "right" }}>
          {editingRow ? "ערוך עובד" : "הוסף עובד"}
        </DialogTitle>
        <DialogContent dir="rtl">
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
            {/* Worker ID field */}
            <TextField
              label="מזהה עובד"
              value={formData.worker_id || ""}
              onChange={(e) => {
                const value = e.target.value;
                // Only allow digits
                if (value === "" || /^\d+$/.test(value)) {
                  setFormData({ ...formData, worker_id: value ? Number(value) : undefined });
                  // Clear error when user starts typing
                  if (errors.worker_id) {
                    setErrors({ ...errors, worker_id: undefined });
                  }
                }
              }}
              fullWidth
              required={!editingRow}
              disabled={!!editingRow}
              error={!!errors.worker_id}
              helperText={errors.worker_id}
              inputProps={{
                inputMode: 'numeric',
                pattern: '[0-9]*'
              }}
            />
            
            {/* Worker Name field */}
            <TextField
              label="שם עובד"
              value={formData.worker_name || ""}
              onChange={(e) => {
                setFormData({ ...formData, worker_name: e.target.value });
                // Clear error when user starts typing
                if (errors.worker_name) {
                  setErrors({ ...errors, worker_name: undefined });
                }
              }}
              fullWidth
              required
              error={!!errors.worker_name}
              helperText={errors.worker_name}
            />

            {/* Stokekeeper checkbox */}
            <FormControlLabel
              control={
                <Checkbox
                  checked={!!formData.stokekeeper}
                  onChange={(e) => setFormData({ ...formData, stokekeeper: e.target.checked })}
                />
              }
              label="מחסנאי (Store Keeper)"
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ justifyContent: "flex-start", px: 3, pb: 2, direction: "rtl" }}>
          <Button onClick={() => {
            setOpenDialog(false);
            setFormData({});
            setErrors({});
          }}>
            ביטול
          </Button>
          <Button onClick={handleSave} variant="contained" disabled={saveLoading}>
            {saveLoading ? "שומר..." : "שמור"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)} dir="rtl">
        <DialogTitle sx={{ textAlign: "right" }}>מחיקת עובד</DialogTitle>
        <DialogContent dir="rtl">
          <Typography>
            האם אתה בטוח שברצונך למחוק את העובד &quot;{rowToDelete?.worker_name}&quot;?
          </Typography>
          <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>
            פעולה זו לא ניתנת לביטול.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ justifyContent: "flex-start", px: 3, pb: 2, direction: "rtl" }}>
          <Button onClick={() => setDeleteConfirmOpen(false)}>ביטול</Button>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained">
            מחק
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Alert onClose={() => setSnackbar({ ...snackbar, open: false })} severity={snackbar.severity}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Paper>
  );
}

