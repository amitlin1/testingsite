"use client";
import React, { useState, useEffect, useCallback } from "react";
import {
  Grid, Paper, Typography, Box, Autocomplete, TextField, Button, 
  List, ListItem, IconButton,
  Chip, Snackbar, Alert, GlobalStyles
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import SaveIcon from "@mui/icons-material/Save";

interface Option {
  id: number;
  label: string;
}

interface RouteData {
  test_route_id: number;
  item_type_id: number;
  test_station_type_id: number;
  route_number: number;
  route_steps: number[];
}

export default function TestingRoutesPage() {
  // Options
  const [itemTypes, setItemTypes] = useState<Option[]>([]);
  const [stationTypes, setStationTypes] = useState<Option[]>([]);
  
  // Selection
  const [selectedItemType, setSelectedItemType] = useState<Option | null>(null);
  const [routeNumber, setRouteNumber] = useState<number | null>(null);

  // Route Data
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [currentRoute, setCurrentRoute] = useState<RouteData | null>(null);
  const [steps, setSteps] = useState<number[]>([]);
  const [isNew, setIsNew] = useState(false);

  // Add Step
  const [stepToAdd, setStepToAdd] = useState<Option | null>(null);

  // UI
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: "success" | "error" }>({
    open: false, message: "", severity: "success"
  });

  // Load Options
  useEffect(() => {
    Promise.all([
      fetch("/api/settings/item-types").then(async res => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
      }),
      fetch("/api/settings/test-stations-type").then(async res => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
      })
    ]).then(([items, stations]) => {
      setItemTypes(Array.isArray(items) ? (items as any[]).map((i) => ({ id: i.item_type_id, label: i.item_type_desc })) : []);
      setStationTypes(Array.isArray(stations) ? (stations as any[]).map((s) => ({ id: s.test_station_type_id, label: s.test_type_desc })) : []);
    }).catch(err => {
      console.error("Failed to load options", err);
      setItemTypes([]);
      setStationTypes([]);
    });
  }, []);

  // Load Route
  const loadRoute = useCallback(async () => {
    if (!selectedItemType || routeNumber === null || routeNumber === undefined) return;

    setLoadingRoute(true);
    setSteps([]);
    setCurrentRoute(null);
    setIsNew(false);

    try {
      const res = await fetch(`/api/settings/testing-routes?itemTypeId=${selectedItemType.id}&routeNumber=${routeNumber}`);
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      const data = await res.json();
      
      if (Array.isArray(data) && data.length > 0) {
        const route = data[0];
        setCurrentRoute(route);
        setSteps(route.route_steps || []);
        setIsNew(false);
      } else {
        setCurrentRoute(null);
        setSteps([]);
        setIsNew(true);
      }
    } catch (err) {
      setSnackbar({ open: true, message: "שגיאה בטעינת מסלול", severity: "error" });
    } finally {
      setLoadingRoute(false);
    }
  }, [selectedItemType, routeNumber]);

  useEffect(() => {
    loadRoute();
  }, [loadRoute]);

  // Editor Actions
  const handleAddStep = () => {
    if (stepToAdd) {
      setSteps([...steps, stepToAdd.id]);
      setStepToAdd(null);
    }
  };

  const handleRemoveStep = (index: number) => {
    const newSteps = [...steps];
    newSteps.splice(index, 1);
    setSteps(newSteps);
  };

  const handleMoveStep = (index: number, direction: "up" | "down") => {
    if (direction === "up" && index > 0) {
      const newSteps = [...steps];
      [newSteps[index - 1], newSteps[index]] = [newSteps[index], newSteps[index - 1]];
      setSteps(newSteps);
    } else if (direction === "down" && index < steps.length - 1) {
      const newSteps = [...steps];
      [newSteps[index + 1], newSteps[index]] = [newSteps[index], newSteps[index + 1]];
      setSteps(newSteps);
    }
  };

  const handleSave = async () => {
    if (!selectedItemType || routeNumber === null || routeNumber === undefined) return;
    
    try {
      const body = {
        item_type_id: selectedItemType.id,
        route_number: routeNumber,
        route_steps: steps
      };

      let url = "/api/settings/testing-routes";
      let method = "POST";

      if (!isNew && currentRoute) {
        url = `/api/settings/testing-routes/${currentRoute.test_route_id}`;
        method = "PUT";
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to save");
      }
      
      const saved = await res.json();
      setCurrentRoute(saved);
      setIsNew(false);
      setSnackbar({ open: true, message: "מסלול נשמר בהצלחה", severity: "success" });
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || "שגיאה בשמירה", severity: "error" });
    }
  };

  const getStationName = (id: number) => {
    return stationTypes.find(s => s.id === id)?.label || `ID ${id}`;
  };

  return (
    <>
      <GlobalStyles 
        styles={{ 
          html: { overflow: "hidden", margin: 0, padding: 0, height: "100%", width: "100%" }, 
          body: { overflow: "hidden", margin: 0, padding: 0, height: "100%", width: "100%" },
          "#__next": { height: "100%", width: "100%" } 
        }} 
      />
      
      {/* 
        Root Layout Override 
        Using position: fixed to breakout of parent containers (like SettingsLayout) 
        that enforce max-width or padding. 
      */}
      <Box sx={{ 
        position: "fixed",
        top: { xs: "56px", sm: "64px" }, // Adjust for Navbar height
        left: 0,
        right: 0,
        bottom: 0,
        width: "100vw",
        // Height is implicitly defined by top/bottom, ensuring full viewport usage
        overflow: "hidden",
        direction: "rtl",
        bgcolor: "background.default",
        zIndex: 100, // Ensure it sits above parent background but below AppBar (usually 1100)
        display: "flex", 
        flexDirection: "column",
        m: 0,
        p: 0,
      }}>
        
        {/* Page Header */}
        <Box sx={{ 
          textAlign: "center", 
          flexShrink: 0,
          width: "100%", 
          p: 1,
          borderBottom: "1px solid",
          borderColor: "divider"
        }}>
            <Typography variant="h5" sx={{ fontWeight: 700, color: "#333", fontSize: "1.4rem" }}>
              ניהול מסלולי בדיקה
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: "0.8rem" }}>
              הגדרת סדר התחנות לפי סוג פריט ומספר מסלול
            </Typography>
        </Box>

        {/* Main Content Grid Container */}
        <Box sx={{ 
          flex: 1, 
          overflow: "hidden", 
          width: "100%", 
          p: 0 
        }}>
          <Grid container spacing={0} sx={{ height: "100%", minHeight: 0, width: "100%", m: 0 }}>
            
            {/* Right Panel: Selection */}
            <Grid size={{ xs: 12, md: 4 }} sx={{ height: "100%", minHeight: 0 }}>
              <Paper 
                elevation={0} 
                square 
                sx={{ 
                  p: 2, 
                  height: "100%", 
                  display: "flex", 
                  flexDirection: "column",
                  overflow: "hidden",
                  borderLeft: "1px solid", // Separator for RTL
                  borderColor: "divider"
                }}
              >
                <Typography variant="h6" sx={{ fontSize: "1rem", mb: 2, fontWeight: 600, borderBottom: "1px solid #eee", pb: 1 }}>
                  בחירת מסלול
                </Typography>
                
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2, overflowY: "auto", flex: 1, px: 1 }}>
                  <Autocomplete
                    options={itemTypes}
                    getOptionLabel={(option) => option.label}
                    isOptionEqualToValue={(option, value) => option.id === value.id}
                    value={selectedItemType}
                    onChange={(_, newValue) => setSelectedItemType(newValue)}
                    renderInput={(params) => <TextField {...params} label="סוג פריט" size="small" variant="outlined" />}
                  />
                  
                  <TextField
                    label="מספר מסלול"
                    type="number"
                    size="small"
                    variant="outlined"
                    value={routeNumber ?? ""}
                    onChange={(e) => {
                      const val = e.target.value === "" ? null : parseInt(e.target.value, 10);
                      setRouteNumber(isNaN(val as number) ? null : val);
                    }}
                    inputProps={{ min: 1 }}
                  />

                  {selectedItemType && routeNumber !== null && routeNumber !== undefined && (
                    <Alert 
                      severity={isNew ? "info" : "success"} 
                      variant="outlined"
                      sx={{ mt: 1, py: 0, alignItems: "center", '& .MuiAlert-message': { padding: '4px 0' } }}
                    >
                      {loadingRoute ? "טוען..." : isNew ? "לא נמצא - צור חדש" : "מסלול קיים נטען"}
                    </Alert>
                  )}
                </Box>
              </Paper>
            </Grid>

            {/* Left Panel: Editor */}
            <Grid size={{ xs: 12, md: 8 }} sx={{ height: "100%", minHeight: 0 }}>
              <Paper 
                elevation={0} 
                square 
                sx={{ 
                  p: 2, 
                  height: "100%", 
                  display: "flex", 
                  flexDirection: "column",
                  overflow: "hidden"
                }}
              >
                {/* Header Row */}
                <Box sx={{ 
                  display: "flex", 
                  justifyContent: "space-between", 
                  alignItems: "center", 
                  mb: 2, 
                  borderBottom: "1px solid #eee", 
                  pb: 1,
                  minHeight: "40px",
                  flexShrink: 0
                }}>
                  <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 600 }}>
                    עריכת שלבים
                  </Typography>
                  <Button 
                    variant="contained" 
                    color="primary"
                    startIcon={<SaveIcon />} 
                    onClick={handleSave}
                    disabled={!selectedItemType || routeNumber === null || routeNumber === undefined || loadingRoute}
                    size="small"
                    sx={{ px: 2 }}
                  >
                    שמור
                  </Button>
                </Box>

                {(!selectedItemType || routeNumber === null || routeNumber === undefined) ? (
                  <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", flex: 1, opacity: 0.5, flexDirection: "column", gap: 1 }}>
                    <Box sx={{ fontSize: "3rem", opacity: 0.2 }}>📋</Box>
                    <Typography variant="body2">נא לבחור סוג פריט ומספר מסלול</Typography>
                  </Box>
                ) : (
                  <Box sx={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", minHeight: 0 }}>
                    {/* Add Step Row */}
                    <Box sx={{ display: "flex", gap: 1, mb: 2, flexShrink: 0 }}>
                      <Autocomplete
                        options={stationTypes}
                        getOptionLabel={(option) => option.label}
                        isOptionEqualToValue={(option, value) => option.id === value.id}
                        value={stepToAdd}
                        onChange={(_, newValue) => setStepToAdd(newValue)}
                        renderInput={(params) => <TextField {...params} label="הוסף שלב (סוג עמדה)" size="small" />}
                        sx={{ flexGrow: 1 }}
                      />
                      <Button 
                        variant="outlined" 
                        onClick={handleAddStep} 
                        disabled={!stepToAdd} 
                        size="small" 
                        sx={{ minWidth: "80px" }}
                      >
                        הוסף
                      </Button>
                    </Box>

                    {/* Scrollable List */}
                    <Box sx={{ 
                      flex: 1, 
                      overflowY: "auto", 
                      border: "1px solid #eee", 
                      borderRadius: 1,
                      bgcolor: "#fafafa",
                      px: 1
                    }}>
                      <List dense sx={{ p: 0 }}>
                        {steps.map((stepId, index) => (
                          <ListItem key={index} divider sx={{ py: 1, '&:last-child': { borderBottom: 'none' } }}>
                            <Box sx={{ display: "flex", alignItems: "center", width: "100%", gap: 1.5 }}>
                               <Chip 
                                 label={index + 1} 
                                 color="primary" 
                                 size="small" 
                                 sx={{ minWidth: "30px", height: "24px", fontWeight: "bold" }} 
                               />
                               <Typography sx={{ flexGrow: 1, fontSize: "0.9rem", fontWeight: 500 }}>
                                 {getStationName(stepId)}
                               </Typography>
                               
                               <Box sx={{ display: "flex" }}>
                                 <IconButton size="small" onClick={() => handleMoveStep(index, "up")} disabled={index === 0}>
                                   <ArrowUpwardIcon fontSize="small" />
                                 </IconButton>
                                 <IconButton size="small" onClick={() => handleMoveStep(index, "down")} disabled={index === steps.length - 1}>
                                   <ArrowDownwardIcon fontSize="small" />
                                 </IconButton>
                                 <IconButton size="small" color="error" onClick={() => handleRemoveStep(index)} sx={{ ml: 1 }}>
                                   <DeleteIcon fontSize="small" />
                                 </IconButton>
                               </Box>
                            </Box>
                          </ListItem>
                        ))}
                        {steps.length === 0 && (
                          <Typography color="text.secondary" align="center" sx={{ py: 4, fontSize: "0.875rem" }}>
                            אין שלבים במסלול זה
                          </Typography>
                        )}
                      </List>
                    </Box>
                  </Box>
                )}
              </Paper>
            </Grid>
          </Grid>
        </Box>

        <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar({ ...snackbar, open: false })}>
          <Alert severity={snackbar.severity}>{snackbar.message}</Alert>
        </Snackbar>
      </Box>
    </>
  );
}
