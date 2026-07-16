"use client";
import React, { useState, useEffect, useCallback } from "react";
import { Box, Snackbar, Alert } from "@/components/ui";
import SearchableCombobox from "@/app/components/common/SearchableCombobox";
import { ArrowUp, ArrowDown, X, Plus, Save, Route } from "lucide-react";
import SettingsToolbar from "../components/SettingsToolbar";

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

  const hasSelection = !!selectedItemType && routeNumber !== null && routeNumber !== undefined;

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", direction: "rtl" }}>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <Box sx={{ maxWidth: 1180, mx: "auto", px: 1, py: 1 }}>
          <SettingsToolbar
            title="מסלולי בדיקה"
            subtitle="הגדרת סדר העמדות לפי סוג פריט ומספר מסלול."
          />

          {/* selection card */}
          <Box sx={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: "16px", mt: 3, overflow: "hidden" }}>
            <Box sx={{ px: 2.25, py: 1.75, borderBottom: "1px solid #e0e0e0", fontSize: 16, fontWeight: 700, color: "#1d1d1f" }}>
              בחירת מסלול
            </Box>
            <Box sx={{ p: 2.25, display: "flex", gap: 2, alignItems: "flex-end", flexWrap: "wrap" }}>
              <Box sx={{ minWidth: 240, flex: 1, maxWidth: 360 }}>
                <SearchableCombobox<Option>
                  options={itemTypes}
                  getOptionLabel={(option) => option.label}
                  isOptionEqualToValue={(option, value) => option.id === value.id}
                  value={selectedItemType}
                  onChange={(newValue) => setSelectedItemType(newValue)}
                  floatingLabel="סוג פריט"
                />
              </Box>
              <Box sx={{ width: 180 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#333", marginBottom: 8 }}>מספר מסלול</label>
                <input
                  className="shx-input"
                  type="number"
                  min={1}
                  value={routeNumber ?? ""}
                  onChange={(e) => {
                    const val = e.target.value === "" ? null : parseInt(e.target.value, 10);
                    setRouteNumber(isNaN(val as number) ? null : val);
                  }}
                  placeholder="מספר מסלול"
                  style={{ height: 42, borderRadius: 8, fontSize: 15 }}
                />
              </Box>
              {hasSelection && (
                <Box
                  sx={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 0.75,
                    height: 42,
                    px: 1.5,
                    fontSize: 13,
                    fontWeight: 600,
                    borderRadius: "9999px",
                    color: isNew ? "#7a7a7a" : "#0066cc",
                    background: isNew ? "#f5f5f7" : "rgba(0,102,204,0.08)",
                    border: `1px solid ${isNew ? "#e0e0e0" : "rgba(0,102,204,0.2)"}`,
                  }}
                >
                  {loadingRoute ? "טוען…" : isNew ? "מסלול חדש — ייווצר בשמירה" : "מסלול קיים נטען"}
                </Box>
              )}
            </Box>
          </Box>

          {/* editor card */}
          <Box sx={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: "16px", mt: 2.5, overflow: "hidden" }}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1.5, flexWrap: "wrap", px: 2.25, py: 1.75, borderBottom: "1px solid #e0e0e0" }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
                <Box component="span" sx={{ display: "flex", color: "#0066cc" }}><Route size={20} strokeWidth={1.75} /></Box>
                <Box component="span" sx={{ fontSize: 16, fontWeight: 700, color: "#1d1d1f" }}>עריכת שלבים</Box>
              </Box>
              <button
                className="shx-btn shx-btn-primary"
                onClick={handleSave}
                disabled={!hasSelection || loadingRoute}
              >
                <Save size={18} strokeWidth={2} />שמור
              </button>
            </Box>

            <Box sx={{ p: 2.25 }}>
              {!hasSelection ? (
                <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1.25, py: 8, color: "#7a7a7a", textAlign: "center" }}>
                  <Route size={34} strokeWidth={1.5} color="#0066cc" />
                  <Box sx={{ fontSize: 15, color: "#1d1d1f", fontWeight: 600 }}>בחר סוג פריט ומספר מסלול</Box>
                  <Box sx={{ fontSize: 13 }}>שלבי המסלול יופיעו כאן לעריכה.</Box>
                </Box>
              ) : (
                <>
                  <Box sx={{ fontSize: 13, fontWeight: 600, color: "#333", mb: 1.25 }}>שלבי המסלול · לפי הסדר</Box>
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 1, maxWidth: 560 }}>
                    {steps.map((stepId, index) => (
                      <Box
                        key={index}
                        sx={{ display: "flex", alignItems: "center", gap: 1.5, background: "#fafafc", border: "1px solid #e0e0e0", borderRadius: "10px", p: "10px 12px" }}
                      >
                        <Box sx={{ width: 26, height: 26, borderRadius: "9999px", background: "#0066cc", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                          {index + 1}
                        </Box>
                        <Box sx={{ flex: 1, fontSize: 14, fontWeight: 600, color: "#1d1d1f", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {getStationName(stepId)}
                        </Box>
                        <StepBtn title="הקדם" disabled={index === 0} onClick={() => handleMoveStep(index, "up")}>
                          <ArrowUp size={15} strokeWidth={1.9} />
                        </StepBtn>
                        <StepBtn title="אחר" disabled={index === steps.length - 1} onClick={() => handleMoveStep(index, "down")}>
                          <ArrowDown size={15} strokeWidth={1.9} />
                        </StepBtn>
                        <StepBtn title="הסר" danger onClick={() => handleRemoveStep(index)}>
                          <X size={15} strokeWidth={1.9} />
                        </StepBtn>
                      </Box>
                    ))}
                    {steps.length === 0 && (
                      <Box sx={{ fontSize: 13, color: "#9a9aa0", py: 1 }}>אין שלבים. הוסף עמדה למסלול.</Box>
                    )}

                    {/* add-step row */}
                    <Box sx={{ display: "flex", gap: 1, alignItems: "flex-end", mt: 0.75, flexWrap: "wrap" }}>
                      <Box sx={{ flex: 1, minWidth: 220, maxWidth: 340 }}>
                        <SearchableCombobox<Option>
                          options={stationTypes}
                          getOptionLabel={(option) => option.label}
                          isOptionEqualToValue={(option, value) => option.id === value.id}
                          value={stepToAdd}
                          onChange={(newValue) => setStepToAdd(newValue)}
                          floatingLabel="הוסף שלב (סוג עמדה)"
                        />
                      </Box>
                      <button
                        onClick={handleAddStep}
                        disabled={!stepToAdd}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 6, height: 42,
                          background: "#fff", border: "1.5px dashed #c7c7cf", borderRadius: 10,
                          padding: "0 16px", fontSize: 14, fontWeight: 600,
                          color: stepToAdd ? "#0066cc" : "#9a9aa0",
                          cursor: stepToAdd ? "pointer" : "not-allowed",
                        }}
                      >
                        <Plus size={16} strokeWidth={2} />הוסף שלב
                      </button>
                    </Box>
                  </Box>
                </>
              )}
            </Box>
          </Box>
        </Box>
      </Box>

      <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar({ ...snackbar, open: false })}>
        <Alert severity={snackbar.severity}>{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  );
}

function StepBtn({ children, onClick, title, disabled, danger }: { children: React.ReactNode; onClick: () => void; title: string; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 28, height: 28, border: "1px solid #e0e0e0", borderRadius: 7,
        background: "#fff", color: danger ? "#bf3535" : "#7a7a7a",
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.4 : 1, flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}
