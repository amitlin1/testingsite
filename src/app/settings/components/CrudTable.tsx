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
  Typography
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import SearchIcon from "@mui/icons-material/Search";

export interface Column {
  field: string;
  headerName: string;
  width?: string | number;
}

interface CrudTableProps {
  apiUrl: string;
  columns: Column[];
  idField: string;
  nameField: string;
  entityName: string;
}

export default function CrudTable({
  apiUrl,
  columns,
  idField,
  nameField,
  entityName
}: CrudTableProps) {
  // State
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  // Dialog State
  const [openDialog, setOpenDialog] = useState(false);
  const [editingRow, setEditingRow] = useState<any | null>(null);
  const [formData, setFormData] = useState<any>({});
  const [saveLoading, setSaveLoading] = useState(false);

  // Delete Confirm State
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [rowToDelete, setRowToDelete] = useState<any | null>(null);

  // Snackbar State
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: "success" | "error" }>({
    open: false,
    message: "",
    severity: "success",
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl);
      if (!res.ok) throw new Error("Failed to fetch data");
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      showSnackbar("Error loading data", "error");
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const showSnackbar = (message: string, severity: "success" | "error") => {
    setSnackbar({ open: true, message, severity });
  };

  const handleAdd = () => {
    setEditingRow(null);
    setFormData({});
    setOpenDialog(true);
  };

  const handleEdit = (row: any) => {
    setEditingRow(row);
    setFormData({ ...row });
    setOpenDialog(true);
  };

  const handleDeleteClick = (row: any) => {
    setRowToDelete(row);
    setDeleteConfirmOpen(true);
  };

  const handleSave = async () => {
    // Simple validation
    for (const col of columns) {
      if (col.field === idField) continue;
      if (!formData[col.field] || !String(formData[col.field]).trim()) {
        showSnackbar(`${col.headerName} שדה חובה`, "error");
        return;
      }
    }
    const isDuplicate = rows.some(r =>
      r[nameField].toLowerCase().trim() === formData[nameField].toLowerCase().trim() &&
      r[idField] !== editingRow?.[idField] // התעלמות מהשורה הנוכחית בעריכה
    );
    if (isDuplicate) {
      showSnackbar("סוג פריט זה כבר קיים", "error");
      return; // עוצר את התהליך ולא שולח בקשה לשרת
    }

    setSaveLoading(true);
    try {
      const method = editingRow ? "PUT" : "POST";
      const url = editingRow ? `${apiUrl}/${editingRow[idField]}` : apiUrl;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to save");
      }

      const savedRow = await res.json();

      if (editingRow && savedRow) {
        setRows(rows.map(r => r[idField] === savedRow[idField] ? savedRow : r));
        showSnackbar(`${entityName} עודכן בהצלחה`, "success");
      } else {
        setRows([...rows, savedRow]);
        showSnackbar(`${entityName} נוצר בהצלחה`, "success");
      }
      setOpenDialog(false);
    } catch (err: any) {
      showSnackbar(err.message, "error");
    } finally {
      setSaveLoading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!rowToDelete) return;
    try {
      const res = await fetch(`${apiUrl}/${rowToDelete[idField]}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to delete");
      }

      setRows(rows.filter(r => r[idField] !== rowToDelete[idField]));
      showSnackbar(`${entityName} נמחק בהצלחה`, "success");
    } catch (err: any) {
      showSnackbar(err.message, "error");
    } finally {
      setDeleteConfirmOpen(false);
      setRowToDelete(null);
    }
  };

  const filteredRows = rows.filter(row => {
    if (!searchTerm) return true;
    return columns.some(col => {
      const val = row[col.field];
      return String(val).toLowerCase().includes(searchTerm.toLowerCase());
    });
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
          הוסף {entityName}
        </Button>
      </Box>

      {/* Table */}
      <TableContainer sx={{ flex: 1, overflow: "auto", border: "1px solid #eee", borderRadius: 1 }}>
        <Table size="medium" stickyHeader>
          <TableHead>
            <TableRow>
              {columns.map(col => (
                <TableCell key={col.field} align="right" sx={{ fontWeight: "bold", bgcolor: "#f5f5f5" }} width={col.width}>
                  {col.headerName}
                </TableCell>
              ))}
              <TableCell sx={{ fontWeight: "bold", textAlign: "center", width: 120, bgcolor: "#f5f5f5" }}>פעולות</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={columns.length + 1} align="center" sx={{ py: 4 }}>
                  <CircularProgress />
                </TableCell>
              </TableRow>
            ) : filteredRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + 1} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">לא נמצאו נתונים</Typography>
                </TableCell>
              </TableRow>
            ) : (
              filteredRows.map((row) => (
                <TableRow key={row[idField]} hover>
                  {columns.map(col => (
                    <TableCell key={col.field} align="right">
                      {row[col.field]}
                    </TableCell>
                  ))}
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
      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ textAlign: "right" }}>{editingRow ? `ערוך ${entityName}` : `הוסף ${entityName}`}</DialogTitle>
        <DialogContent dir="rtl">
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
            {columns.map(col => {
              if (col.field === idField) return null;
              return (
                <TextField
                  key={col.field}
                  label={col.headerName}
                  value={formData[col.field] || ""}
                  onChange={(e) => setFormData({ ...formData, [col.field]: e.target.value })}
                  fullWidth
                  required
                />
              );
            })}
          </Box>
        </DialogContent>
        <DialogActions sx={{ justifyContent: "flex-start", px: 3, pb: 2, direction: "rtl" }}>
          <Button onClick={() => setOpenDialog(false)}>ביטול</Button>
          <Button onClick={handleSave} variant="contained" disabled={saveLoading}>
            {saveLoading ? "שומר..." : "שמור"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)}>
        <DialogTitle sx={{ textAlign: "right" }}>מחיקת {entityName}</DialogTitle>
        <DialogContent dir="rtl">
          <Typography>
            האם אתה בטוח שברצונך למחוק את {entityName} &quot;{rowToDelete?.[nameField]}&quot;?
          </Typography>
          <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>
            פעולה זו לא ניתנת לביטול.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ justifyContent: "flex-start", px: 3, pb: 2, direction: "rtl" }}>
          <Button onClick={() => setDeleteConfirmOpen(false)}>ביטול</Button>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained">מחק</Button>
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
