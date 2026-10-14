"use client";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { Snackbar, Alert, Button, IconButton, TextField, Skeleton, Tag } from "@/components/ui";
import SearchableCombobox from "@/app/components/common/SearchableCombobox";
import { ArrowUp, ArrowDown, X, Plus, Save, Route } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { useDraftStore } from "../../lib/draftStore";
import { routeRefFrom } from "../../lib/routeQuery";
import type { RouteRef } from "../../lib/routeQuery";

/**
 * The "שלבי המסלול" tab (route-fields spec §5.13, §3.5): the old page's "בחירת מסלול" and "עריכת
 * שלבים" cards, moved as they were — every class, text and aria-label — with three changes:
 *
 * 1. Every step carries its uid: the state is { uid, typeId }[], so a move or a removal carries the
 *    uid along with no mapping code. A loaded route pairs step_uids[i] with route_steps[i] (all
 *    null when the lengths differ — a route a script inserted); an added step has uid null and the
 *    server mints one. The save sends route_steps AND step_uids, and takes the uids back from the
 *    answer. A uid is never derived from an index (spec §11.3).
 * 2. The item type + route number picker is the way to a NEW route ("מסלול חדש — ייווצר בשמירה"):
 *    it shows the route the URL names, and a complete pair goes to the URL (onRouteChange), so the
 *    whole page follows. A half-filled pair — or a route number the URL cannot hold (below 1) —
 *    stays local, and is loaded and saved here exactly as the old page did.
 * 3. After a save the page reloads what depends on the steps (the route list, the fields context:
 *    the map's columns follow the new steps).
 */

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
  /** Parallel to route_steps (spec §3.5); another length = a route without uids. */
  step_uids?: string[] | null;
}

/** One step of the route: its station type, and its uid (null = added here, not saved yet). */
type Step = { uid: string | null; typeId: number };

/** The route's steps with their uids: step_uids[i] belongs to route_steps[i]; when the two do not
 *  line up, no step has a uid (the server infers them on save). */
function stepsOf(route: RouteData): Step[] {
  const typeIds = route.route_steps || [];
  const uids = Array.isArray(route.step_uids) && route.step_uids.length === typeIds.length ? route.step_uids : null;
  return typeIds.map((typeId, i) => ({ uid: uids ? uids[i] || null : null, typeId }));
}

/** The picker while it holds a pair the URL does not (half-filled, or a number the URL cannot
 *  name). */
type PickDraft = { typeId: number | null; number: number | null };

const refKey = (ref: RouteRef | null) => (ref ? `${ref.type}:${ref.route}` : "");

export type RouteStepsTabProps = {
  /** The route the URL names (null = none). */
  route: RouteRef | null;
  /** Every item type (kits too), for the picker. */
  itemTypes: Option[];
  /** Every station type, for the step names and "הוסף שלב (סוג עמדה)". */
  stationTypes: Option[];
  /** A complete item type + route number pair was picked. */
  onRouteChange: (ref: RouteRef) => void;
  /** The steps were saved (the route may be new). */
  onSaved: () => void;
};

export default function RouteStepsTab({ route, itemTypes, stationTypes, onRouteChange, onSaved }: RouteStepsTabProps) {
  const store = useDraftStore();

  // Selection: the URL's route, or the picker's own pair while it is being edited. The pick lives
  // until the URL's route changes — because the pick went to the URL, or another route was chosen
  // elsewhere — so a pick left on one route never comes back when the admin returns to it.
  const baseKey = refKey(route);
  const [pick, setPick] = useState<PickDraft | null>(null);
  const [pickBase, setPickBase] = useState(baseKey);
  if (pickBase !== baseKey) {
    setPickBase(baseKey);
    setPick(null);
  }
  const editing = pickBase === baseKey ? pick : null;
  const selectedTypeId = editing ? editing.typeId : route?.type ?? null;
  const routeNumber = editing ? editing.number : route?.route ?? null;
  const selectedItemType = selectedTypeId == null ? null : itemTypes.find((t) => t.id === selectedTypeId) ?? null;

  const changePick = (typeId: number | null, number: number | null) => {
    setPick({ typeId, number });
    // A pair the URL can hold goes to it, so the whole page follows; any other pair stays here.
    const next = routeRefFrom(typeId, number);
    if (next) onRouteChange(next);
  };

  // Route Data
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [routeError, setRouteError] = useState(false);
  const [currentRoute, setCurrentRoute] = useState<RouteData | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);

  // Add Step
  const [stepToAdd, setStepToAdd] = useState<Option | null>(null);

  // UI
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: "success" | "error" }>({
    open: false, message: "", severity: "success"
  });

  // The selection a save answers to: a reply that lands after the admin moved on is not applied.
  const selectionKey = selectedTypeId != null && routeNumber != null ? `${selectedTypeId}:${routeNumber}` : "";
  const selectionRef = useRef(selectionKey);
  useEffect(() => { selectionRef.current = selectionKey; }, [selectionKey]);

  // Load Route
  const loadRoute = useCallback(async () => {
    if (selectedTypeId == null || routeNumber === null || routeNumber === undefined) return;
    // Typing a route number asks for every number on the way ("1", "12"): only the answer for the
    // pair still selected may land, or a save would PUT to another route's id.
    const loadingFor = `${selectedTypeId}:${routeNumber}`;
    const current = () => selectionRef.current === loadingFor;

    setLoadingRoute(true);
    setRouteError(false);
    setSteps([]);
    setCurrentRoute(null);
    setIsNew(false);

    try {
      const res = await apiFetch(`/api/settings/testing-routes?itemTypeId=${selectedTypeId}&routeNumber=${routeNumber}`);
      if (!current()) return;
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      const data = await res.json();
      if (!current()) return;

      if (Array.isArray(data) && data.length > 0) {
        const route = data[0];
        setCurrentRoute(route);
        setSteps(stepsOf(route));
        setIsNew(false);
      } else {
        setCurrentRoute(null);
        setSteps([]);
        setIsNew(true);
      }
    } catch {
      if (current()) setRouteError(true);
    } finally {
      if (current()) setLoadingRoute(false);
    }
  }, [selectedTypeId, routeNumber]);

  useEffect(() => {
    loadRoute();
  }, [loadRoute]);

  // Editor Actions — on { uid, typeId } steps: the uid moves with its step.
  const handleAddStep = () => {
    if (stepToAdd) {
      setSteps([...steps, { uid: null, typeId: stepToAdd.id }]);
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
    if (selectedTypeId == null || routeNumber === null || routeNumber === undefined) return;
    const savingFor = selectionKey;

    setSaving(true);
    try {
      // Field edits still waiting for their autosave go first: a step save prunes the route's
      // draft on the server (spec §3.5), and a later autosave would meet its newer draft_rev.
      await store.flushAll();

      const body = {
        item_type_id: selectedTypeId,
        route_number: routeNumber,
        route_steps: steps.map((s) => s.typeId),
        step_uids: steps.map((s) => s.uid),
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

      const saved: RouteData = await res.json();
      if (selectionRef.current === savingFor) {
        setCurrentRoute(saved);
        // The server's uids: a step added here has one now, and the next save must send it.
        setSteps(stepsOf(saved));
        setIsNew(false);
      }
      setSnackbar({ open: true, message: "מסלול נשמר בהצלחה", severity: "success" });
      onSaved();
    } catch (err: any) {
      setSnackbar({ open: true, message: err.message || "שמירת המסלול נכשלה. נסה שוב.", severity: "error" });
    } finally {
      setSaving(false);
    }
  };

  const getStationName = (id: number) => {
    return stationTypes.find(s => s.id === id)?.label || `ID ${id}`;
  };

  const hasSelection = selectedTypeId != null && routeNumber !== null && routeNumber !== undefined;

  return (
    <div>
      {/* selection card */}
      <div className="settings-card" style={{ overflow: "visible" }}>
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
              onChange={(newValue) => changePick(newValue ? newValue.id : null, newValue ? routeNumber : null)}
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
                changePick(selectedTypeId, isNaN(val as number) ? null : val);
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
                    {steps.map((step, index) => {
                      const name = getStationName(step.typeId);
                      return (
                        // The uid is the step's identity; a step added here (no uid yet) is keyed
                        // by its place until the save gives it one. Never an index-derived uid.
                        <div key={step.uid ?? `new-${index}`} className="route-step">
                          <span className="route-step__num">{index + 1}</span>
                          <span style={{ flex: 1, fontSize: "var(--text-body-sm)", fontWeight: 600, color: "var(--color-ink)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: "var(--space-xs)" }}>
                            {name}
                            {stationTypes.find((t) => t.id === step.typeId)?.packageLevel && (
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
