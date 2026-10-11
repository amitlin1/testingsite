"use client";
import React, { useState, useEffect, useCallback } from "react";
import { Snackbar, Alert, Button, IconButton, TextField, Skeleton, Tag } from "@/components/ui";
import SearchableCombobox from "@/app/components/common/SearchableCombobox";
import { ArrowUp, ArrowDown, X, Plus, Save, Route } from "lucide-react";
import SettingsToolbar from "../components/SettingsToolbar";
import { apiFetch } from "@/lib/api/client";

interface Option {
  id: number;
  label: string;
  /** Station types only: a package-level (opening / closing) station type. */
  packageLevel?: boolean;
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
  // A failed options load is not "no item types": it gets a band and a retry.
  const [optionsError, setOptionsError] = useState(false);

  // Selection
  const [selectedItemType, setSelectedItemType] = useState<Option | null>(null);
  const [routeNumber, setRouteNumber] = useState<number | null>(null);

  // Route Data
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [routeError, setRouteError] = useState(false);
  const [currentRoute, setCurrentRoute] = useState<RouteData | null>(null);
  const [steps, setSteps] = useState<number[]>([]);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);

  // Add Step
  const [stepToAdd, setStepToAdd] = useState<Option | null>(null);

  // UI
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: "success" | "error" }>({
    open: false, message: "", severity: "success"
  });

  // Load Options
  const loadOptions = useCallback(() => {
    setOptionsError(false);
    Promise.all([
      apiFetch("/api/settings/item-types").then(async res => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
      }),
      apiFetch("/api/settings/test-stations-type").then(async res => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        return res.json();
      })
    ]).then(([items, stations]) => {
      setItemTypes(Array.isArray(items) ? (items as any[]).map((i) => ({ id: i.item_type_id, label: i.item_type_desc })) : []);
      setStationTypes(Array.isArray(stations) ? (stations as any[]).map((s) => ({ id: s.test_station_type_id, label: s.test_type_desc, packageLevel: s.package_level === true })) : []);
    }).catch(err => {
      console.error("Failed to load options", err);
      setItemTypes([]);
      setStationTypes([]);
      setOptionsError(true);
    });
  }, []);

  useEffect(() => { loadOptions(); }, [loadOptions]);

  // Load Route
  const loadRoute = useCallback(async () => {
    if (!selectedItemType || routeNumber === null || routeNumber === undefined) return;

    setLoadingRoute(true);
    setRouteError(false);
    setSteps([]);
    setCurrentRoute(null);
    setIsNew(false);

    try {
      const res = await apiFetch(`/api/settings/testing-routes?itemTypeId=${selectedItemType.id}&routeNumber=${routeNumber}`);
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
    } catch {
      setRouteError(true);
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

    setSaving(true);
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

      const res = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "שמירת המסלול נכשלה. בדוק את החיבור לשרת ונסה שוב.");
      }

      const saved = await res.json();
      setCurrentRoute(saved);
      setIsNew(false);
      setSnackbar({ open: true, message: "מסלול נשמר בהצלחה", severity: "success" });
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || "שמירת המסלול נכשלה. נסה שוב.", severity: "error" });
    } finally {
      setSaving(false);
    }
  };

  const getStationName = (id: number) => {
    return stationTypes.find(s => s.id === id)?.label || `ID ${id}`;
  };

  const hasSelection = !!selectedItemType && routeNumber !== null && routeNumber !== undefined;

  // The settings layout owns the frame (scroll, padding, 1180 column).
  return (
    <div dir="rtl">
      <SettingsToolbar
        title="מסלולי בדיקה"
        subtitle="הגדרת סדר העמדות לפי סוג פריט ומספר מסלול."
      />

      {optionsError && (
        <div className="settings-card settings-error" style={{ marginTop: "var(--space-lg)" }}>
          <Alert severity="error">טעינת סוגי הפריטים והעמדות נכשלה, ולכן אי אפשר לבחור מסלול. בדוק את החיבור לשרת ונסה שוב.</Alert>
          <Button variant="outlined" color="inherit" size="small" onClick={loadOptions}>נסה שוב</Button>
        </div>
      )}

      {/* selection card */}
      <div className="settings-card" style={{ marginTop: "var(--space-lg)", overflow: "visible" }}>
        <div className="settings-card__head" style={{ paddingInline: 18 }}>
          <span className="settings-card__title">בחירת מסלול</span>
        </div>
        <div style={{ padding: 18, display: "flex", gap: "var(--space-md)", alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ minWidth: 240, flex: 1, maxWidth: 360 }}>
            <SearchableCombobox<Option>
              options={itemTypes}
              getOptionLabel={(option) => option.label}
              isOptionEqualToValue={(option, value) => option.id === value.id}
              value={selectedItemType}
              onChange={(newValue) => {
                setSelectedItemType(newValue);
                if (!newValue) setRouteNumber(null);
              }}
              label="סוג פריט"
              placeholder="בחר סוג פריט…"
            />
          </div>
          <div style={{ width: 180 }}>
            <TextField
              label="מספר מסלול"
              type="number"
              fullWidth
              value={routeNumber ?? ""}
              onChange={(e) => {
                const val = e.target.value === "" ? null : parseInt(e.target.value, 10);
                setRouteNumber(isNaN(val as number) ? null : val);
              }}
              placeholder="לדוגמה: 1"
              inputProps={{ min: 1, dir: "ltr", style: { textAlign: "right" } }}
            />
          </div>
          {hasSelection && (
            <div style={{ minHeight: 40, display: "flex", alignItems: "center" }} aria-live="polite">
              {loadingRoute ? (
                <Skeleton variant="rounded" width={150} height={24} aria-label="טוען מסלול" />
              ) : routeError ? null : (
                <Tag tone={isNew ? "neutral" : "primary"} size="md">
                  {isNew ? "מסלול חדש — ייווצר בשמירה" : "מסלול קיים נטען"}
                </Tag>
              )}
            </div>
          )}
        </div>
      </div>

      {/* editor card */}
      <div className="settings-card" style={{ marginTop: "var(--space-ml)", overflow: "visible" }}>
        <div className="settings-card__head" style={{ paddingInline: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ display: "flex", color: "var(--color-ink-muted-48)" }}><Route size={20} strokeWidth={1.75} aria-hidden /></span>
            <span className="settings-card__title">עריכת שלבים</span>
          </div>
          <Button
            onClick={handleSave}
            disabled={!hasSelection || loadingRoute || routeError}
            loading={saving}
            startIcon={<Save size={18} strokeWidth={2} aria-hidden />}
          >
            שמור
          </Button>
        </div>

        <div style={{ padding: 18 }}>
          {!hasSelection ? (
            <div className="settings-empty" style={{ padding: "48px 0" }}>
              <Route size={34} strokeWidth={1.5} color="var(--color-ink-muted-48)" aria-hidden />
              <div className="settings-empty__title">בחר סוג פריט ומספר מסלול</div>
              <div>שלבי המסלול יופיעו כאן לעריכה.</div>
            </div>
          ) : routeError ? (
            <div className="settings-error" style={{ padding: 0 }}>
              <Alert severity="error">טעינת המסלול נכשלה. בדוק את החיבור לשרת ונסה שוב.</Alert>
              <Button variant="outlined" color="inherit" size="small" onClick={loadRoute}>נסה שוב</Button>
            </div>
          ) : (
            <>
              <div className="sh-field-label" style={{ marginBottom: 10 }}>שלבי המסלול · לפי הסדר</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)", maxWidth: 560 }}>
                {loadingRoute ? (
                  // While the route loads its steps are unknown — never "no steps".
                  <div aria-busy="true" aria-label="טוען שלבים" style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
                    {[0, 1, 2].map((i) => (
                      <Skeleton key={i} variant="rounded" height={48} />
                    ))}
                  </div>
                ) : (
                  <>
                    {steps.map((stepId, index) => {
                      const name = getStationName(stepId);
                      return (
                        <div key={index} className="route-step">
                          <span className="route-step__num">{index + 1}</span>
                          <span style={{ flex: 1, fontSize: "var(--text-body-sm)", fontWeight: 600, color: "var(--color-ink)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: "var(--space-xs)" }}>
                            {name}
                            {stationTypes.find((t) => t.id === stepId)?.packageLevel && (
                              // design/Settings.dc.html — a package-level step (opening / closing) is marked on the route.
                              <Tag tone="primary">עמדה ברמת מארז</Tag>
                            )}
                          </span>
                          <IconButton size="small" className="route-step__btn" title={`הקדם את ${name}`} disabled={index === 0} onClick={() => handleMoveStep(index, "up")}>
                            <ArrowUp size={15} strokeWidth={1.9} aria-hidden />
                          </IconButton>
                          <IconButton size="small" className="route-step__btn" title={`אחר את ${name}`} disabled={index === steps.length - 1} onClick={() => handleMoveStep(index, "down")}>
                            <ArrowDown size={15} strokeWidth={1.9} aria-hidden />
                          </IconButton>
                          <IconButton size="small" className="route-step__btn route-step__btn--danger" title={`הסר את ${name} מהמסלול`} onClick={() => handleRemoveStep(index)}>
                            <X size={15} strokeWidth={1.9} aria-hidden />
                          </IconButton>
                        </div>
                      );
                    })}
                    {steps.length === 0 && (
                      <div style={{ fontSize: "var(--text-small)", color: "var(--color-ink-muted-48)", padding: "var(--space-xs) 0" }}>אין שלבים. הוסף עמדה למסלול.</div>
                    )}
                  </>
                )}

                {/* add-step row */}
                <div style={{ display: "flex", gap: "var(--space-xs)", alignItems: "flex-end", marginTop: 6, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 220, maxWidth: 340 }}>
                    <SearchableCombobox<Option>
                      options={stationTypes}
                      getOptionLabel={(option) => option.label}
                      isOptionEqualToValue={(option, value) => option.id === value.id}
                      value={stepToAdd}
                      onChange={(newValue) => setStepToAdd(newValue)}
                      label="הוסף שלב (סוג עמדה)"
                      placeholder="בחר סוג עמדה…"
                      disabled={loadingRoute}
                    />
                  </div>
                  <button type="button" className="route-add" onClick={handleAddStep} disabled={!stepToAdd || loadingRoute}>
                    <Plus size={16} strokeWidth={2} aria-hidden />הוסף שלב
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar({ ...snackbar, open: false })}>
        <Alert severity={snackbar.severity}>{snackbar.message}</Alert>
      </Snackbar>
    </div>
  );
}
