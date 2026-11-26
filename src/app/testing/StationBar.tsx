"use client";
import * as React from "react";
import { ArrowLeftRight, History, ScanBarcode, User } from "lucide-react";
import { Box, CircularProgress, SearchableCombobox, Typography } from "@/components/ui";
import WorkerPicker from "@/app/components/WorkerPicker";
import { ACCESS } from "@/lib/auth/roles";
import type { StationLite } from "@/app/lib/testing/contract";

/**
 * The testing screen's top bar (design: מסך בדיקה — עיצוב מחדש כעץ): who and where — the station
 * and the active worker, always on screen — the scan field in the middle, and the station's
 * numbers for today at the end. Replaces the auto-hiding dock: on a station touchscreen nothing
 * that says where you are should hide.
 *
 * The scan field is the page's (its value, keys and focus are page.tsx's); this bar only lays it
 * out. A station is changed in place: "החלפה" turns the name into the all-stations search.
 */
export default function StationBar({
  station, stationTypeName, allStations, typeNameById, onPickStation,
  workerId, workerName, workerLocked, onWorkerChange,
  scanInputRef, scan, counts, onHistory,
}: {
  station: { id: number; name: string } | null;
  stationTypeName: string | null;
  allStations: StationLite[];
  typeNameById: (typeId: number) => string;
  onPickStation: (s: StationLite | null) => void;
  workerId: number | null;
  workerName: string;
  /** The worker comes from the login: shown, not picked. */
  workerLocked: boolean;
  onWorkerChange: (id: number | null) => void;
  /** The scan field's input (the page focuses it whenever no dialog is open). */
  scanInputRef: React.Ref<HTMLInputElement>;
  scan: {
    value: string;
    onChange: (v: string) => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
    loading: boolean;
    /** The last scan landed: the field says so until the next keystroke. */
    landed: string | null;
    placeholder: string;
  };
  /** null while the station's queue has not answered (shown as "—"). */
  counts: { waiting: number | null; inTest: number | null; completedToday: number | null } | null;
  onHistory: (() => void) | null;
}) {
  const [changing, setChanging] = React.useState(false);
  const picking = changing || !station;
  const selected = React.useMemo(() => (station ? allStations.find((s) => s.id === station.id) ?? null : null), [allStations, station]);

  return (
    <header className="tst-bar">
      <div className="tst-frame tst-bar-row">
        <div className="tst-bar-who">
          {picking ? (
            <Box sx={{ width: 280, maxWidth: "70vw" }}>
              <SearchableCombobox<StationLite>
                dense
                ariaLabel="עמדה"
                options={allStations}
                getOptionLabel={(o) => o.name}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                value={selected}
                onChange={(s) => { setChanging(false); onPickStation(s); }}
                placeholder={station ? "חפש עמדה…" : "בחר עמדה כדי להתחיל"}
                noOptionsText="אין עמדה תואמת"
                renderOptionContent={(o) => (
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: "var(--text-body-sm)", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.name}</Typography>
                    <Typography sx={{ fontSize: "var(--text-fine)", color: "var(--color-ink-muted-48)" }}>{typeNameById(o.typeId)}</Typography>
                  </Box>
                )}
              />
            </Box>
          ) : (
            <div style={{ minWidth: 0 }}>
              <div className="tst-bar-label">{stationTypeName || "עמדה"}</div>
              {/* The page's one h1: the station being worked. */}
              <h1 className="tst-bar-name">{station.name}</h1>
            </div>
          )}
          {station && (
            <button type="button" className="tst-btn-quiet" onClick={() => setChanging((c) => !c)} aria-pressed={changing}>
              <ArrowLeftRight size={16} strokeWidth={1.75} aria-hidden />
              {changing ? "ביטול" : "החלפה"}
            </button>
          )}

          {workerLocked ? (
            <span className="tst-worker-chip" title="העובד מזוהה מההתחברות">
              <User size={16} strokeWidth={1.75} aria-hidden />
              {workerName || "עובד"}
            </span>
          ) : (
            <Box sx={{ width: 220 }} className={workerId == null ? "tst-worker-missing" : undefined}>
              <WorkerPicker
                value={workerId}
                onChange={onWorkerChange}
                label="עובד פעיל"
                hideHeader
                size="small"
                // Only who may test: whoever holds the permission /testing needs.
                perm={ACCESS.testing}
                placeholder="בחר עובד…"
              />
            </Box>
          )}
        </div>

        <div className="tst-scanbox" role="search">
          <label htmlFor="tst-scan-input" className="sh-visually-hidden">סריקה או הקלדת מזהה</label>
          <div className="tst-scanbox-field" data-landed={scan.landed ? "" : undefined}>
            <ScanBarcode size={24} strokeWidth={1.75} aria-hidden className="tst-scanbox-icon" />
            <input
              id="tst-scan-input"
              ref={scanInputRef}
              value={scan.value}
              onChange={(e) => scan.onChange(e.target.value)}
              onKeyDown={scan.onKeyDown}
              placeholder={scan.placeholder}
              aria-busy={scan.loading || undefined}
              autoComplete="off"
              spellCheck={false}
              dir="auto"
            />
            {scan.loading ? (
              <CircularProgress size={18} aria-hidden />
            ) : scan.landed && !scan.value ? (
              <span className="tst-scanbox-landed">נסרק <bdi dir="ltr">{scan.landed}</bdi></span>
            ) : (
              <span className="tst-kbd" aria-hidden>Enter</span>
            )}
          </div>
        </div>

        <div className="tst-bar-end">
          {counts && (
            <div className="tst-counts" role="status">
              <strong>{counts.waiting ?? "—"}</strong> בתור
              <span aria-hidden className="tst-sep">·</span>
              <strong>{counts.inTest ?? "—"}</strong> בבדיקה
              <span aria-hidden className="tst-sep">·</span>
              <strong>{counts.completedToday ?? "—"}</strong> הושלמו היום
            </div>
          )}
          {onHistory && (
            <button type="button" className="tst-btn-quiet" onClick={onHistory}>
              <History size={16} strokeWidth={1.75} aria-hidden />
              היסטוריה
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
