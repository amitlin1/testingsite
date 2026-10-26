"use client";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useUrlState, useUrlTextField } from "@/lib/hooks/useUrlState";
import SearchableCombobox from "../components/common/SearchableCombobox";
import {
  Typography,
  TextField,
  Box,
  Button,
  Stack,
  Skeleton,
  MenuItem,
  Menu,
  InputAdornment,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Snackbar,
  CircularProgress,
} from "@/components/ui";
import "./testing.css";
import { toneOfStatus, TONE_DOT } from "@/app/lib/status-tones";
import { useGlobalScanner } from "./useGlobalScanner";
import {TestStationType, TestStation, ItemRow, StationLite} from "../../types";
import { apiFetch } from "@/lib/api/client";
import { newActionId } from "@/app/lib/metrics/action-id";
import { useTokenWorkerId } from "@/lib/hooks/useTokenWorkerId";
import { useSession } from "next-auth/react";
import { isAdmin } from "@/lib/auth/roles";
// Icons
import { Search as SearchIcon } from "@/components/ui/icons";
import { Clear as ClearIcon } from "@/components/ui/icons";
import { Science as ScienceIcon } from "@/components/ui/icons";
import { CheckCircleOutline as CheckCircleOutlineIcon } from "@/components/ui/icons";
import { Inventory as InventoryIcon } from "@/components/ui/icons";
import { AccessTime as AccessTimeIcon } from "@/components/ui/icons";
import { History as HistoryIcon } from "@/components/ui/icons";
import { PlayArrowRounded as PlayArrowRoundedIcon } from "@/components/ui/icons";
import { QrCode as QrCodeIcon } from "@/components/ui/icons";
import { TrendingUp as TrendingUpIcon } from "@/components/ui/icons";
import { Star as StarIcon } from "@/components/ui/icons";
import { Check as CheckIcon } from "@/components/ui/icons";
import { Queue as QueueIcon } from "@/components/ui/icons";
// MoreVertIcon removed
import { getStartTestDialog, hasStartTestDialog } from "./tests-popups/mainPopUp";
import StationHistoryDialog from "../components/StationHistoryDialog";
import TestingDock from "../components/testing/TestingDock";
import type { PackageView } from "@/app/lib/packages/read";
import PackageIdText from "../components/packages/PackageIdText";
import PackageQueueCard from "../components/testing/PackageQueueCard";
import PackageOpenWizard from "./tests-popups/PackageOpenWizard";
import PackageCloseWizard from "./tests-popups/PackageCloseWizard";
import { ITEM_STATES, seq2 } from "../components/packages/packageUi";

/**
 * Which package wizard a box needs at a package-level station
 * (docs/packages/PLAN.md §4): the closing type is the LAST step of the
 * package route; any other package-level step is the opening one.
 */
const packageKindOf = (it: ItemRow): "open" | "close" => {
  const total = it.route_steps?.length ?? 0;
  return total > 1 && (it.current_route_step ?? 1) >= total ? "close" : "open";
};

// Item / station types now live in src/types (ItemRow, TestStation, TestStationType, StationLite).

// Custom hook for live elapsed time display
function useElapsedTime(createdAt: string | null | undefined): string {
  const [elapsed, setElapsed] = React.useState<string>("");

  React.useEffect(() => {
    if (!createdAt) {
      setElapsed("");
      return;
    }
    const startTime = new Date(createdAt).getTime();
    if (isNaN(startTime)) {
      setElapsed("");
      return;
    }

    const updateElapsed = () => {
      const now = Date.now();
      const diff = Math.floor((now - startTime) / 1000);
      if (diff < 0) {
        setElapsed("");
        return;
      }
      const hours = Math.floor(diff / 3600);
      const minutes = Math.floor((diff % 3600) / 60);
      const seconds = diff % 60;
      setElapsed(`${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`);
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [createdAt]);

  return elapsed;
}

/** Start-test failed (someone else took the item, or the server refused). */
const START_FAILED_ITEM = "לא ניתן להתחיל בדיקה — ייתכן שפריט זה כבר נתפס על ידי עובד אחר.";
const START_FAILED_PACKAGE = "לא ניתן להתחיל את המארז — ייתכן שהוא כבר נתפס על ידי עובד אחר.";
/** The station queue could not be loaded (network / server). */
const QUEUE_LOAD_FAILED = "לא ניתן לטעון את התור של העמדה. בדוק את החיבור ונסה שוב.";
/** Scanner fallback: auto-submit after this pause when the scan sends no Enter. */
const SCAN_IDLE_SUBMIT_MS = 700;

/** The page's one empty-state shape (artboard: 64px circle, 17/600 line, 14 hint). */
function EmptyState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <Box sx={{ textAlign: "center", py: "64px", color: "var(--color-ink-muted-48)" }}>
      <Box sx={{ width: 64, height: 64, borderRadius: "var(--r-pill)", bgcolor: "var(--color-canvas)", border: "1px solid var(--color-hairline)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--color-primary)", mb: "14px" }}>
        {icon}
      </Box>
      <Typography sx={{ fontSize: "var(--text-lead)", color: "var(--color-ink)", fontWeight: 600, mb: "6px" }}>{title}</Typography>
      <Typography sx={{ fontSize: "var(--text-body-sm)" }}>{hint}</Typography>
    </Box>
  );
}

// --- Item Row Strip (option 3a: queue rank + step progress) ---
// The status reads once per row: a dot in the status tone (status-tones map)
// beside its label in ink. Rank, steps and timer stay neutral (HI-5: the
// artboard's item card has no coloured side stripe).
function ItemCard({
  item,
  rank,
  onAddTestResult,
  onStartTest,
  onRefresh,
  onStartError,
  highlighted = false,
  priority = false,
  hasWizard = false,
}: {
  item: ItemRow;
  rank: number;
  onAddTestResult: (item: ItemRow) => void;
  onStartTest: (itemId: number) => Promise<void>;
  onRefresh: () => void;
  /** Shows a start-test failure in the page's error toast. */
  onStartError: (message: string) => void;
  highlighted?: boolean;
  priority?: boolean;
  hasWizard?: boolean;
}) {
  const baseTimeString =
    item.current_status === 1 || item.current_status === 5
      ? item.processing_start_time
      : item.current_status === 2 || item.current_status === 4
        ? item.queue_start_time
        : null;

  const elapsedTime = useElapsedTime(baseTimeString);
  const isInTest = item.current_status === 1 || item.current_status === 5;
  const isWaiting = item.current_status === 2 || item.current_status === 4;
  // Package model: an item inside a box carries the box's view (siblings and
  // where each one is) — design/Testing Screen Packages.dc.html, item strip.
  const pkg = item.package_id != null ? item.package ?? null : null;
  const siblings = pkg ? pkg.items.filter((s) => String(s.item_id) !== String(item.item_id)) : [];

  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const handleMenuClick = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
  };
  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const statusDot = TONE_DOT[toneOfStatus(item.current_status)];

  const isActionable = isWaiting || isInTest;

  // Steps come from the item's real testing route.
  const totalSteps = Math.max(item.route_steps?.length || 1, 1);
  const currentStep = item.current_route_step ?? 1;
  // White numerals need a dark fill: warning-ink for the priority row (the
  // plain amber is 3.2:1), the rail ink for an actionable one; a finished row's
  // rank recedes to muted on parchment.
  const rankTone = priority
    ? { bg: "var(--color-warning-ink)", fg: "var(--color-on-primary)" }
    : isActionable
      ? { bg: "var(--color-nav-bg)", fg: "var(--color-on-primary)" }
      : { bg: "var(--color-canvas-parchment)", fg: "var(--color-ink-muted-48)" };

  // The mini-strip says each box item's state by colour; its name carries the
  // same in words (e.g. "2 בבדיקה, 1 ממתין") for anyone who can't tell them apart.
  const pkgSummary = React.useMemo(() => {
    if (!pkg) return "";
    const counts = new Map<string, number>();
    for (const s of pkg.items) counts.set(s.state_label, (counts.get(s.state_label) ?? 0) + 1);
    return `מצב פריטי המארז: ${[...counts].map(([label, n]) => `${n} ${label}`).join(", ")}`;
  }, [pkg]);

  return (
      <Box
        sx={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: "15px",
          bgcolor: "var(--color-canvas)",
          borderRadius: "14px",
          padding: "14px 16px",
          border: highlighted
            ? "1.5px solid var(--color-primary)"
            : priority
              ? "1.5px solid var(--color-status-late)"
              : "1px solid var(--color-hairline)",
          boxShadow: highlighted
            ? "0 0 0 3px color-mix(in srgb, var(--color-primary) 18%, transparent)"
            : priority
              ? "0 0 0 3px color-mix(in srgb, var(--color-status-late) 10%, transparent)"
              : "none",
          transition: "border-color var(--dur-fast) ease, box-shadow var(--dur-fast) ease",
        }}
      >
        {/* Priority ribbon — the longest-waiting item */}
        {priority && (
            <Box
                sx={{
                    position: "absolute",
                    top: -10,
                    insetInlineStart: 58,
                    zIndex: 3,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                    bgcolor: "var(--color-warning-ink)",
                    color: "var(--color-on-primary)",
                    fontSize: "var(--text-micro)",
                    fontWeight: 700,
                    borderRadius: "var(--r-pill)",
                    padding: "3px 10px",
                    whiteSpace: "nowrap",
                }}
            >
                <StarIcon sx={{ fontSize: 12 }} aria-hidden />
                ממתין הכי הרבה
            </Box>
        )}

        {/* "נסרק" — the artboard's solid action-blue pill, like the ribbon above. */}
        {highlighted && (
            <Box
                role="status"
                sx={{
                    position: "absolute",
                    top: -10,
                    insetInlineEnd: 18,
                    zIndex: 3,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                    bgcolor: "var(--color-primary)",
                    color: "var(--color-on-primary)",
                    fontSize: "var(--text-micro)",
                    fontWeight: 600,
                    borderRadius: "var(--r-pill)",
                    padding: "4px 10px",
                    whiteSpace: "nowrap",
                }}
            >
                <QrCodeIcon sx={{ fontSize: 13 }} aria-hidden />
                נסרק
            </Box>
        )}

        {/* Queue rank circle */}
        <Box
            sx={{
                width: 38,
                height: 38,
                flexShrink: 0,
                borderRadius: "var(--r-pill)",
                bgcolor: rankTone.bg,
                color: rankTone.fg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "var(--text-body)",
                fontWeight: 700,
                fontVariantNumeric: "tabular-nums",
            }}
        >
            {rank}
        </Box>

        {/* ID + status, type · model line, package strip */}
        <Box sx={{ minWidth: 0, flex: 1 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: "9px", flexWrap: "wrap" }}>
                <PackageIdText id={item.item_id} size={17} headColor="var(--color-ink)" weight={700} letterSpacing="var(--ls-caption)" />
                <Box sx={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "var(--text-fine)", fontWeight: 600, color: "var(--color-ink)", whiteSpace: "nowrap" }}>
                    <Box aria-hidden sx={{ width: 7, height: 7, borderRadius: "var(--r-pill)", bgcolor: statusDot }} />
                    {item.item_status_desc || "סטטוס לא ידוע"}
                </Box>
            </Box>
            <Typography sx={{ fontSize: "var(--text-small)", color: "var(--color-ink-muted-48)", mt: "3px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {[item.item_type_desc, item.model].filter(Boolean).join(" · ")} · מק״ט {item.makat}
            </Typography>
            {pkg && (
                <Box sx={{ display: "flex", alignItems: "center", gap: "8px", mt: "6px", fontSize: "var(--text-fine)", color: "var(--color-ink-muted-48)", whiteSpace: "nowrap", overflow: "hidden" }}>
                    <InventoryIcon sx={{ fontSize: 14 }} aria-hidden />
                    <span>פריט {seq2(item.package_seq)} מתוך {seq2(pkg.items.length)} · {pkg.item_type_desc}</span>
                    <Box role="img" aria-label={pkgSummary} title={pkgSummary} sx={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                        {pkg.items.map((s) => (
                            <Box key={s.item_id} title={`${seq2(s.package_seq)} · ${s.item_type_desc} · ${s.state_label}`} sx={{ width: 16, height: 7, borderRadius: "3px", bgcolor: String(s.item_id) === String(item.item_id) ? "var(--color-primary)" : ITEM_STATES[s.state].color }} />
                        ))}
                    </Box>
                </Box>
            )}
        </Box>

        {/* Step progress */}
        <Box sx={{ flexShrink: 0, width: 150 }}>
            <Typography sx={{ fontSize: "var(--text-fine)", fontWeight: 700, color: "var(--color-ink-muted-70)", mb: "5px" }}>
                {/* "a / b" isolated LTR — in RTL it would read "b / a". */}
                שלב <bdi dir="ltr">{currentStep} / {totalSteps}</bdi>
            </Typography>
            <Box aria-hidden sx={{ display: "flex", gap: "4px" }}>
                {Array.from({ length: totalSteps }, (_, i) => (
                    <Box key={i} sx={{ flex: 1, height: 5, borderRadius: "var(--r-pill)", bgcolor: i < currentStep ? "var(--color-ink-muted-48)" : "var(--color-hairline)" }} />
                ))}
            </Box>
        </Box>

        {/* Timer — neutral; the status already reads in the dot */}
        <Box sx={{ flexShrink: 0, fontSize: "var(--text-body)", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "var(--color-ink)", minWidth: 82, textAlign: "center" }}>
            {elapsedTime || "—"}
        </Box>

        {/* Package slot — fixed width so the columns stay aligned. An item in a
            box gets the box icon; the menu lists the other items in the same
            package and where each one is (replaces the old parent/accessory
            "connected items" menu — docs/packages/PLAN.md §9.14). */}
        {pkg ? (
            <IconButton
                onClick={handleMenuClick}
                title="פריטים באותו מארז"
                aria-haspopup="menu"
                aria-expanded={Boolean(anchorEl)}
                className="tst-pkg-btn"
            >
                <InventoryIcon sx={{ fontSize: 18 }} aria-hidden />
            </IconButton>
        ) : (
            <Box sx={{ width: 40, flexShrink: 0 }} />
        )}

        {/* Same-package items menu */}
        <Menu
             anchorEl={anchorEl}
             open={Boolean(anchorEl)}
             onClose={handleMenuClose}
             anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
             transformOrigin={{ vertical: 'top', horizontal: 'right' }}
             marginThreshold={0}
             PaperProps={{ sx: { minWidth: 260 } }}
        >
           <MenuItem disabled dense sx={{ opacity: "1 !important" }}>
              <Box>
                  <Typography sx={{ fontSize: "var(--text-fine)", fontWeight: 700, color: "var(--color-ink-muted-48)" }}>פריטים באותו מארז</Typography>
                  {pkg && <Box sx={{ mt: "2px" }}><PackageIdText id={pkg.item_id} size={13} headColor="var(--color-ink)" /></Box>}
              </Box>
           </MenuItem>
           {siblings.length === 0 ? (
               <MenuItem disabled dense><Typography variant="caption">אין פריטים נוספים במארז</Typography></MenuItem>
           ) : (
               siblings.map((s) => (
                 <MenuItem key={s.item_id} onClick={handleMenuClose} dense>
                    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ gap: 1 }}>
                       <Box sx={{ width: 26, height: 26, borderRadius: "7px", bgcolor: "var(--color-canvas-parchment)", color: "var(--color-ink-muted-48)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "var(--text-fine)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{seq2(s.package_seq)}</Box>
                       <Box>
                           <Typography variant="subtitle2">{s.item_type_desc}</Typography>
                           {/* State in words, its colour on a dot (amber text would fail contrast). */}
                           <Typography variant="caption" sx={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
                               <Box component="span" aria-hidden sx={{ width: 6, height: 6, borderRadius: "var(--r-pill)", bgcolor: ITEM_STATES[s.state].color }} />
                               {s.state_label}{s.station_name ? ` · ${s.station_name}` : ""}
                           </Typography>
                       </Box>
                    </Stack>
                 </MenuItem>
               ))
           )}
        </Menu>

        {/* Action — the row's CTA; a finished row shows its status instead */}
        {isActionable ? (
            <Button
                className="tst-cta"
                onClick={async () => {
                  if (isWaiting) {
                    // start-test is the only call that flips the item to "in
                    // test" — it must run before the wizard opens too, or the
                    // item stays "waiting" while the wizard is open and a
                    // second worker can start (and submit) it independently.
                    try {
                      await onStartTest(item.item_id);
                    } catch (err) {
                      onRefresh();
                      onStartError(err instanceof Error ? err.message : START_FAILED_ITEM);
                      return;
                    }
                    if (hasWizard) {
                      // Station-type wizard runs the intake in place of the plain start.
                      onAddTestResult(item);
                    } else {
                      onRefresh();
                    }
                  } else if (isInTest) {
                    onAddTestResult(item);
                  }
                }}
                startIcon={<PlayArrowRoundedIcon sx={{ fontSize: 16 }} aria-hidden />}
            >
              {isWaiting ? (item.current_status === 4 ? "התחל מחקר" : "התחל בדיקה") : "המשך בדיקה"}
            </Button>
        ) : (
            <Box className="tst-cta-done">
              <CheckCircleOutlineIcon sx={{ fontSize: 18 }} aria-hidden />
              הושלם
            </Box>
        )}
      </Box>
  );
}

// --- A box in a package-level queue (opening / closing station) ---
// Owns the live timer the card shows and the same start-then-open-wizard
// handshake ItemCard uses: start-test (group start, PLAN §4) must lock the
// box and its items before the wizard opens.
function PackageQueueEntry({
  item,
  kind,
  onAddTestResult,
  onStartTest,
  onRefresh,
  onStartError,
}: {
  item: ItemRow;
  kind: "open" | "close";
  onAddTestResult: (item: ItemRow) => void;
  onStartTest: (itemId: number) => Promise<void>;
  onRefresh: () => void;
  /** Shows a start-test failure in the page's error toast. */
  onStartError: (message: string) => void;
}) {
  const isInTest = item.current_status === 1;
  const elapsed = useElapsedTime(isInTest ? item.processing_start_time : item.queue_start_time);
  const [starting, setStarting] = React.useState(false);
  if (!item.package) return null;
  return (
    <PackageQueueCard
      pkg={item.package}
      kind={kind}
      wait={elapsed}
      inTest={isInTest}
      disabled={starting}
      onStart={async () => {
        if (isInTest) { onAddTestResult(item); return; }
        setStarting(true);
        try {
          await onStartTest(item.item_id);
        } catch (err) {
          onRefresh();
          onStartError(err instanceof Error ? err.message : START_FAILED_PACKAGE);
          return;
        } finally {
          setStarting(false);
        }
        onAddTestResult(item);
      }}
    />
  );
}

// --- "ממתין לפריטי המארז" banner above a closing station's queue ---
function BlockedPackagesBanner({ packages }: { packages: PackageView[] }) {
  return (
    <Box role="status" sx={{ mb: "18px", border: "1px solid var(--color-warning-border)", bgcolor: "var(--color-warning-bg)", borderRadius: "var(--r-md)", padding: "14px 18px" }}>
      <Typography sx={{ fontSize: "var(--text-body)", fontWeight: 700, color: "var(--color-warning-ink)" }}>
        {packages.length === 1 ? "מארז אחד ממתין לפריטים לפני הסגירה" : `${packages.length} מארזים ממתינים לפריטים לפני הסגירה`}
      </Typography>
      <Typography sx={{ fontSize: "var(--text-small)", color: "var(--color-warning-ink)", mt: "2px" }}>
        המארז ייכנס לתור כשכל הפריטים שלו יסיימו את המסלול. הפריטים החסרים ומיקומם:
      </Typography>
      <Box sx={{ display: "flex", flexDirection: "column", gap: "8px", mt: "12px" }}>
        {packages.map((p) => (
          <Box key={p.item_id} sx={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", bgcolor: "var(--color-canvas)", border: "1px solid var(--color-warning-border)", borderRadius: "var(--r-sm)", padding: "9px 12px" }}>
            <PackageIdText id={p.item_id} size={14} headColor="var(--color-ink)" />
            <Typography sx={{ fontSize: "var(--text-small)", fontWeight: 600, color: "var(--color-ink)" }}>{p.item_type_desc}</Typography>
            <Typography sx={{ fontSize: "var(--text-small)", color: "var(--color-ink-muted-48)" }}>{p.customer_name ?? p.customer_code ?? ""}</Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", marginInlineStart: "auto" }}>
              {p.blocked_by.map((b) => (
                <Box key={b.item_id} sx={{ fontSize: "var(--text-fine)", color: "var(--color-warning-ink)", bgcolor: "var(--color-warning-bg)", border: "1px solid var(--color-warning-border)", borderRadius: "var(--r-pill)", padding: "3px 10px", whiteSpace: "nowrap" }}>
                  {seq2(b.package_seq)} · {b.item_type_desc} · {b.station_name ?? "במסלול"}
                </Box>
              ))}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

// Queue-priority helpers: waiting first (longest wait first), then in-test,
// then anything else.
const rankOf = (it: ItemRow) =>
  it.current_status === 2 || it.current_status === 4 ? 0
  : it.current_status === 1 || it.current_status === 5 ? 1 : 2;
const baseTimeOf = (it: ItemRow) =>
  new Date(it.queue_start_time || it.processing_start_time || 0).getTime();

// --- Summary strip tile ---
function SummaryTile({
  icon,
  iconBg,
  iconColor,
  value,
  label,
  valueColor = "var(--color-ink)",
}: {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  value: React.ReactNode;
  label: string;
  valueColor?: string;
}) {
  return (
    <Box sx={{ bgcolor: "var(--color-canvas)", border: "1px solid var(--color-hairline)", borderRadius: "var(--r-card)", padding: "16px 18px", display: "flex", alignItems: "center", gap: "14px" }}>
      <Box aria-hidden sx={{ width: 44, height: 44, flexShrink: 0, borderRadius: "var(--r-md)", bgcolor: iconBg, color: iconColor, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {icon}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: "var(--text-kpi)", fontWeight: 700, letterSpacing: "var(--ls-display)", lineHeight: 1, color: valueColor, fontVariantNumeric: "tabular-nums" }}>
          {value}
        </Typography>
        <Typography sx={{ fontSize: "var(--text-small)", color: "var(--color-ink-muted-48)", mt: "5px" }}>{label}</Typography>
      </Box>
    </Box>
  );
}

// --- Main Page Component ---
/** Every filter of the screen lives in the URL: a refresh keeps the station
 *  and the filters, and other screens deep link in (/testing?item=<id> from
 *  the packages screen, ?station= from the command palette). */
const URL_DEFAULTS = { station: "", item: "", q: "", customer: "", shipment: "", itype: "" };

async function getJson<T>(url: string): Promise<T> {
  const res = await apiFetch(url);
  if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
  return res.json() as Promise<T>;
}

type FilterOption = { value: string; label: string };

/** A queue filter: empty = everything (the placeholder says so); × goes back to it. */
function QueueFilter({ value, onChange, options, allLabel, disabled }: { value: string; onChange: (v: string) => void; options: FilterOption[]; allLabel: string; disabled?: boolean }) {
  return (
    <SearchableCombobox<FilterOption>
      dense
      width={180}
      disabled={disabled}
      options={options}
      value={options.find((o) => o.value === value) ?? null}
      onChange={(o) => onChange(o ? o.value : "")}
      getOptionLabel={(o) => o.label}
      isOptionEqualToValue={(a, b) => a.value === b.value}
      placeholder={allLabel}
      ariaLabel={allLabel}
    />
  );
}

/** Distinct options from the queue on screen, keeping a selected value that left it. */
function optionsOf(items: ItemRow[], key: (it: ItemRow) => number | null | undefined, label: (it: ItemRow) => string | null | undefined, selected: string): FilterOption[] {
  const map = new Map<string, string>();
  for (const it of items) {
    const k = key(it);
    if (k == null) continue;
    if (!map.has(String(k))) map.set(String(k), (label(it) ?? "").trim() || String(k));
  }
  if (selected && !map.has(selected)) map.set(selected, `${selected} · לא בתור`);
  return [...map.entries()].map(([value, l]) => ({ value, label: l })).sort((a, b) => a.label.localeCompare(b.label, "he"));
}

function TestingPageView() {
  const queryClient = useQueryClient();
  const [url, setUrl] = useUrlState(URL_DEFAULTS);
  const stationId = Number(url.station) || null;

  // Station types and the flat station list (the dock's all-stations search).
  const stationTypesQ = useQuery({ queryKey: ["testing", "station-types"], queryFn: () => getJson<TestStationType[]>("/api/testing/stations"), staleTime: 5 * 60_000 });
  const stationTypes = React.useMemo(() => (Array.isArray(stationTypesQ.data) ? stationTypesQ.data : []), [stationTypesQ.data]);
  const allStationsQ = useQuery({ queryKey: ["stations"], queryFn: () => getJson<StationLite[]>("/api/stations"), staleTime: 5 * 60_000 });
  const allStations = React.useMemo(() => (Array.isArray(allStationsQ.data) ? allStationsQ.data : []), [allStationsQ.data]);

  // The station is the URL's; its type follows from the station list.
  const stationLite = stationId != null ? allStations.find((s) => s.id === stationId) ?? null : null;
  const selectedStation = React.useMemo<TestStation | null>(
    () => (stationLite ? { test_station_id: stationLite.id, test_station_desc: stationLite.name, test_station_type_id: stationLite.typeId, status: 0, is_research: false } : null),
    [stationLite],
  );
  const selectedStationType = selectedStation ? stationTypes.find((t) => t.id === selectedStation.test_station_type_id) ?? null : null;

  // Package model (docs/packages/PLAN.md §4): opening / closing station types
  // queue boxes, not items — the grid, the wizards and the empty texts switch
  // on this flag (design/Testing Screen Packages.dc.html).
  const packageLevel = !!selectedStationType?.packageLevel;

  // The station's queue. Polled, refreshed on focus and after every action;
  // a refresh of the same station keeps its list on screen (ST-7), a newly
  // picked station shows skeletons until its own queue answers.
  const itemsQ = useQuery({
    queryKey: ["testing", "items", stationId],
    enabled: stationId != null,
    queryFn: () => getJson<ItemRow[]>(`/api/testing/items?stationId=${stationId}`),
    refetchInterval: 20_000,
  });
  const items = React.useMemo(() => (Array.isArray(itemsQ.data) ? itemsQ.data : []), [itemsQ.data]);
  const itemsLoading = itemsQ.isFetching;
  // A failed queue load is an error with "נסה שוב", never an empty queue (ST-1).
  const itemsError = itemsQ.isError && !itemsQ.data ? QUEUE_LOAD_FAILED : null;

  // "Completed today" — item_route_history rows for this station since local midnight.
  const completedQ = useQuery({
    queryKey: ["testing", "completed-today", stationId],
    enabled: stationId != null,
    refetchInterval: 60_000,
    queryFn: async () => {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const data = await getJson<{ count?: number }>(`/api/testing/completed-today?stationId=${stationId}&since=${encodeURIComponent(startOfDay.toISOString())}`);
      return typeof data?.count === "number" ? data.count : 0;
    },
  });
  const completedToday = completedQ.data ?? null;

  // Boxes held before this closing station because items are still out.
  const blockedQ = useQuery({
    queryKey: ["testing", "blocked", stationId],
    enabled: stationId != null && packageLevel,
    queryFn: () => getJson<PackageView[]>(`/api/testing/blocked-packages?stationId=${stationId}`),
  });
  const blockedPackages = packageLevel && Array.isArray(blockedQ.data) ? blockedQ.data : [];

  const handleRefreshItems = React.useCallback(() => {
    if (stationId == null) return;
    for (const k of ["items", "completed-today", "blocked"]) queryClient.invalidateQueries({ queryKey: ["testing", k, stationId] });
  }, [queryClient, stationId]);

  // The search / scan field and the three queue filters.
  const writeQ = React.useCallback((v: string) => setUrl({ q: v }), [setUrl]);
  const [filterText, setFilterText] = useUrlTextField(url.q, writeQ);
  const filterRef = React.useRef<HTMLInputElement>(null);
  const customerOptions = React.useMemo(() => optionsOf(items, (it) => it.customer_id, (it) => it.customer_name ?? it.customer_code, url.customer), [items, url.customer]);
  const shipmentOptions = React.useMemo(() => optionsOf(items, (it) => it.shipment_id, (it) => it.shipment_code, url.shipment), [items, url.shipment]);
  const itemTypeOptions = React.useMemo(() => optionsOf(items, (it) => it.item_type_id, (it) => it.item_type_desc, url.itype), [items, url.itype]);
  const anyFilter = !!(filterText || url.customer || url.shipment || url.itype);
  const clearFilters = () => { setFilterText(""); setUrl({ q: "", customer: "", shipment: "", itype: "" }); };

  const [startError, setStartError] = React.useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [selectedItem, setSelectedItem] = React.useState<ItemRow | null>(null);
  // Tracks whether the currently-open test dialog actually submitted a result.
  // start-test locks the item into "in test"/"in research" before the dialog
  // opens; if it's closed any other way (X button, backdrop, Escape) the item
  // must be released back to waiting instead of staying locked forever.
  const dialogSubmittedRef = React.useRef(false);
  const [historyDialogOpen, setHistoryDialogOpen] = React.useState(false);
  const [nextStationDialogOpen, setNextStationDialogOpen] = React.useState(false);
  const [nextStationInfo, setNextStationInfo] = React.useState<{
    isLastStation: boolean;
    nextStation?: {
      testStationId: number;
      testStationDesc: string;
      stationTypeId: number;
      routeStep: number;
    };
    finishedFromResearch?: boolean;
    finishedAtStep?: number;
  } | null>(null);
  const [researchDialogOpen, setResearchDialogOpen] = React.useState(false);
  const [researchStationInfo, setResearchStationInfo] = React.useState<{
    stationId: number;
    stationDesc: string;
    stationTypeId: number;
    stationTypeName: string;
    currentLoad: number;
  } | null>(null);

  // Page-level "who's working" picker — single source of truth for any action
  // taken from this page (finish test, file upload, replace, edit). Persisted
  // to localStorage so a refresh doesn't lose the choice. Smart-card auth will
  // replace this in the future.
  const WORKER_STORAGE_KEY = "testing-page:active-worker-id";
  const [activeWorkerId, setActiveWorkerId] = React.useState<number | null>(null);
  // Auth: the logged-in user's worker id, from their Keycloak employeeNumber.
  const tokenWorkerId = useTokenWorkerId();
  const { data: authSession } = useSession();
  // Same rule as the shipment worker fields (useShipmentWorker): everyone
  // starts as themselves; only a manager may switch to another worker.
  const workerLocked = tokenWorkerId != null && !isAdmin(authSession?.roles ?? []);
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(WORKER_STORAGE_KEY);
      if (raw) {
        const parsed = parseInt(raw, 10);
        if (!Number.isNaN(parsed)) setActiveWorkerId(parsed);
      }
    } catch {
      /* ignore */
    }
  }, []);
  // When the token carries a worker id, THAT is the active worker on load — it
  // overrides any manual / localStorage choice. A non-manager stays on it
  // (workerLocked); a manager may then switch. Falls back to the manual picker
  // when the user has no employeeNumber.
  React.useEffect(() => {
    if (tokenWorkerId == null) return;
    setActiveWorkerId(tokenWorkerId);
    try {
      window.localStorage.setItem(WORKER_STORAGE_KEY, String(tokenWorkerId));
    } catch {
      /* ignore */
    }
  }, [tokenWorkerId]);
  const handleWorkerChange = (workerId: number | null) => {
    setActiveWorkerId(workerId);
    try {
      if (workerId == null) window.localStorage.removeItem(WORKER_STORAGE_KEY);
      else window.localStorage.setItem(WORKER_STORAGE_KEY, String(workerId));
    } catch {
      /* ignore */
    }
  };
  // Resolve the worker_name for downstream consumers (OnlyOffice user.name etc.).
  const workersQ = useQuery({
    queryKey: ["workers-directory"],
    // Only once a worker is chosen — as before the move to React Query.
    enabled: activeWorkerId != null,
    staleTime: 5 * 60_000,
    queryFn: () => getJson<Array<{ worker_id: number; worker_name: string }>>("/api/workers-directory"),
  });
  const activeWorkerName = React.useMemo(() => {
    if (activeWorkerId == null || !Array.isArray(workersQ.data)) return "";
    return workersQ.data.find((w) => w.worker_id === activeWorkerId)?.worker_name ?? "";
  }, [activeWorkerId, workersQ.data]);

  // Barcode scanner state
  const [scannerOpen, setScannerOpen] = React.useState(false);
  const [scanInput, setScanInput] = React.useState("");
  const [scanError, setScanError] = React.useState<string | null>(null);
  // Set when a scan came from a pre-upgrade label that the server resolved
  // through legacy_id_map (locate-by-barcode); the worker is told to reprint.
  const [legacyNotice, setLegacyNotice] = React.useState<string | null>(null);
  const [scanLoading, setScanLoading] = React.useState(false);
  const [highlightedItemId, setHighlightedItemId] = React.useState<number | null>(null);
  const [finishedDialogOpen, setFinishedDialogOpen] = React.useState(false);
  const [finishedItemInfo, setFinishedItemInfo] = React.useState<{
    itemId: number;
    serialNo?: string | null;
    model?: string | null;
  } | null>(null);
  const scanTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanInputRef = React.useRef<HTMLInputElement>(null);

  const filteredItems = React.useMemo(() => {
    const ql = filterText.trim().toLowerCase();
    const has = (v: unknown) => v != null && String(v).toLowerCase().includes(ql);
    const base = items.filter((item) =>
      (url.customer === "" || String(item.customer_id) === url.customer) &&
      (url.shipment === "" || String(item.shipment_id) === url.shipment) &&
      (url.itype === "" || String(item.item_type_id) === url.itype) &&
      (ql === "" ||
        has(item.makat) || has(item.serial_no) || has(item.item_id) || has(item.customer_name) ||
        has(item.shipment_code) || has(item.item_type_desc) || has(item.package_id) ||
        // A box row is found by any of its items too (an item row's
        // `package` is its parent box — siblings must not match).
        (!!item.is_package && (item.package?.items ?? []).some((it) => has(it.item_id) || has(it.serial_no)))),
    );

    // Hoist the scanned item to the front of the list (if present).
    if (highlightedItemId == null) return base;
    const idx = base.findIndex((it) => Number(it.item_id) === Number(highlightedItemId));
    if (idx <= 0) return base;
    return [base[idx], ...base.slice(0, idx), ...base.slice(idx + 1)];
  }, [items, filterText, url.customer, url.shipment, url.itype, highlightedItemId]);
  const filterMakat = filterText.trim();

  // Priority ordering for the grid: waiting (longest wait first) → in-test →
  // rest. The scanned item stays hoisted to the very front regardless.
  const { orderedItems, priorityItemId } = React.useMemo(() => {
    const sorted = [...filteredItems].sort(
      (a, b) => rankOf(a) - rankOf(b) || baseTimeOf(a) - baseTimeOf(b)
    );
    // The longest-waiting item gets the priority ribbon (hidden while filtering).
    const topWaiting = !filterMakat
      ? sorted.find((it) => it.current_status === 2 || it.current_status === 4)
      : undefined;
    if (highlightedItemId != null) {
      const idx = sorted.findIndex((it) => Number(it.item_id) === Number(highlightedItemId));
      if (idx > 0) {
        const [hit] = sorted.splice(idx, 1);
        sorted.unshift(hit);
      }
    }
    return {
      orderedItems: sorted,
      priorityItemId: topWaiting != null ? Number(topWaiting.item_id) : null,
    };
  }, [filteredItems, filterMakat, highlightedItemId]);

  // Summary-strip data — station overview, so derived from the unfiltered list.
  const waitingCount = React.useMemo(
    () => items.filter((it) => it.current_status === 2 || it.current_status === 4).length,
    [items]
  );
  const inTestCount = React.useMemo(
    () => items.filter((it) => it.current_status === 1 || it.current_status === 5).length,
    [items]
  );
  // Longest wait = live timer on the earliest queue_start_time among waiting items.
  const longestWaitStart = React.useMemo(() => {
    let earliest: string | null = null;
    for (const it of items) {
      if ((it.current_status === 2 || it.current_status === 4) && it.queue_start_time) {
        if (earliest == null || new Date(it.queue_start_time).getTime() < new Date(earliest).getTime()) {
          earliest = it.queue_start_time;
        }
      }
    }
    return earliest;
  }, [items]);
  const longestWait = useElapsedTime(longestWaitStart);

  const handleAddTestResult = (item: ItemRow) => {
    dialogSubmittedRef.current = false;
    setSelectedItem(item);
    setDialogOpen(true);
  };

  // Resolve a scanned barcode to a station and hoist the matching item.
  // filterTo: also narrow the queue to that one item (the ?item= deep link
  // from the packages screen); a plain scan only hoists and highlights it.
  // Not memoized: the global scanner and the deep-link effect read it through
  // a ref / a one-shot guard, so a fresh closure per render costs nothing.
  const handleBarcodeScan = async (raw: string, opts?: { filterTo?: boolean }) => {
    const barcode = raw.trim();
    if (!barcode) return;
    setScanLoading(true);
    setScanError(null);
    try {
      const res = await apiFetch(`/api/testing/locate-by-barcode?barcode=${encodeURIComponent(barcode)}`);
      const data = await res.json();
      if (!res.ok) {
        setScanError(data?.error || "שגיאה באיתור הפריט");
        return;
      }
      setLegacyNotice(
        data.legacyId != null
          ? `נסרקה מדבקה ישנה (${data.legacyId}) — הפריט זוהה כ-${data.resolvedItemId}. יש להדפיס לקופסה מדבקה חדשה מעמוד המארזים ("מדבקות למארזים שהוסבו").`
          : null,
      );

      // Item already finished its route — show the friendly dialog, not an error.
      if (data.finished) {
        setFinishedItemInfo({
          itemId: Number(data.itemId),
          serialNo: data.serialNo,
          model: data.model,
        });
        setFinishedDialogOpen(true);
        setScannerOpen(false);
        setScanInput("");
        setFilterText("");
        return;
      }

      // A box held before its closing station until every item is back
      // (status 6, PLAN §4) — say so and which items are still out.
      if (data.waitingForPackageItems) {
        const blocking = Array.isArray(data.blockingItemIds) ? data.blockingItemIds.length : 0;
        setScanError(
          blocking === 1
            ? `המארז ${data.itemId} ממתין לפריט אחד שטרם סיים את המסלול. הוא ייכנס לתור הסגירה כשהפריט יגיע.`
            : `המארז ${data.itemId} ממתין ל-${blocking} פריטים שטרם סיימו את המסלול. הוא ייכנס לתור הסגירה כשכולם יגיעו.`,
        );
        return;
      }

      if (!stationTypes.some((t) => t.id === data.stationTypeId)) {
        setScanError("סוג העמדה של הפריט לא נמצא");
        return;
      }

      // The station goes into the URL; the queue query follows it. Filters
      // that could hide the scanned item are dropped.
      setHighlightedItemId(Number(data.itemId));
      const q = opts?.filterTo ? String(data.itemId) : "";
      setFilterText(q);
      setUrl({ station: String(data.stationId), item: "", q, customer: "", shipment: "", itype: "" });

      setScannerOpen(false);
      setScanInput("");
    } catch (err) {
      console.error("Error scanning barcode:", err);
      setScanError("שגיאה בתקשורת עם השרת");
    } finally {
      setScanLoading(false);
    }
  };

  // Deep link ?item=<id> (the packages screen's "למסך הבדיקות"): find the
  // item's station and open it narrowed to that item. With ?station= as well
  // (the command palette) the station is already known: just filter.
  const itemLinkDone = React.useRef(false);
  React.useEffect(() => {
    if (itemLinkDone.current || !url.item || stationTypes.length === 0) return;
    itemLinkDone.current = true;
    if (url.station) {
      // The field follows the URL's q (useUrlTextField).
      setUrl({ item: "", q: url.item });
    } else {
      // Off the effect's own tick: the lookup sets loading state.
      void Promise.resolve().then(() => handleBarcodeScan(url.item, { filterTo: true }));
    }
    // One-shot (itemLinkDone): handleBarcodeScan is a fresh closure each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url.item, url.station, stationTypes.length]);

  // Enter in the search field: a code that names an item in this queue
  // highlights it; anything else is treated as a scan and located (it may
  // live at another station). The field is focused on arrival and after every
  // dialog, so a hardware scan needs no button press first.
  const handleFilterEnter = () => {
    const code = filterText.trim();
    if (!code) return;
    const id = code.split("-")[0];
    const local = items.find((it) => String(it.item_id) === id || (it.serial_no ?? "") === code);
    if (local) {
      setHighlightedItemId(Number(local.item_id));
      return;
    }
    handleBarcodeScan(code);
  };

  // A scan with nothing focused (no field, no dialog) goes to the same handler
  // as the scan dialog — the document-level keyboard-wedge listener in
  // ./useGlobalScanner.ts. Off while a wizard is open (its overlay is not a
  // role="dialog" the hook can see) and while the scan dialog itself is.
  useGlobalScanner(handleBarcodeScan, !dialogOpen && !scannerOpen);

  // After a failed scan the field keeps focus with its text selected, so the
  // next hardware scan replaces it instead of typing into nothing (ST-4).
  React.useEffect(() => {
    if (!scannerOpen || scanLoading || !scanError) return;
    const el = scanInputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [scannerOpen, scanLoading, scanError]);

  // One error toast for the page: a start-test failure, or a scan that failed
  // while the scan dialog was closed (a scan from the global listener).
  const toastMessage = startError ?? (!scannerOpen ? scanError : null);
  // Stable, so the toast's auto-hide timer isn't reset by the page's 1s clock.
  const closeToast = React.useCallback(() => {
    setStartError(null);
    if (!scannerOpen) setScanError(null);
  }, [scannerOpen]);

  const handleStartTest = async (itemId: number) => {
    if (!selectedStation) throw new Error("Station not selected");
    try {
      const response = await apiFetch("/api/testing/start-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // actionUuid identifies this click in the metrics ledger
        // (event_key test_started:{action_uuid}, §4.4) — one per invocation.
        body: JSON.stringify({ itemId, stationId: selectedStation.test_station_id, actionUuid: newActionId(), workerId: activeWorkerId ?? undefined, workerName: activeWorkerName || undefined }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to start test");
      }
    } catch (error) {
      console.error("Error starting test:", error);
      throw error;
    }
  };

  // Reverses start-test for an item whose dialog was closed/cancelled without
  // a submitted result, so it goes back to "waiting" instead of staying
  // locked at "in test" forever. Fire-and-forget from the UI's perspective —
  // the periodic release-stale-tests cron is the backstop if this fails too
  // (closed tab, lost connection, etc).
  const releaseTest = async (itemId: number, stationId: number) => {
    try {
      await apiFetch("/api/testing/release-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // actionUuid → event_key released_by_user:{action_uuid} (§4.4)
        body: JSON.stringify({ itemId, stationId, actionUuid: newActionId(), workerId: activeWorkerId ?? undefined, workerName: activeWorkerName || undefined }),
      });
    } catch (error) {
      console.error("Error releasing test:", error);
    } finally {
      handleRefreshItems();
    }
  };

  const handleSubmitTestResult = async (testData: Record<string, any>) => {
    if (!selectedItem || !selectedStation) return;
    const routeStepsLength = selectedItem.route_steps?.length || 0;
    if (routeStepsLength === 0) throw new Error("Route steps information is missing.");

    const response = await apiFetch("/api/testing/results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ItemID: selectedItem.item_id,
        StationID: selectedStation.test_station_id,
        CurrentRouteStep: selectedItem.current_route_step,
        RouteStepsLength: routeStepsLength,
        // Dual-run only: these feed the legacy item_route_history write. The
        // metrics ledger never reads client timestamps — the DB assigns
        // occurred_at for every event (§4.2).
        QueueStartTime: selectedItem.created_at,
        ProcessingStartTime: selectedItem.processing_start_time,
        ItemTypeId: selectedItem.item_type_id,
        CreatedAt: selectedItem.created_at,
        // Fallback action UUID (§4.4) for dialogs that don't set one; dialogs
        // with an error-retry path pass their own stable SubmitID in testData
        // (spread below wins) so a retry replays instead of duplicating.
        SubmitID: newActionId(),
        // Snapshot of the acting worker's display name for the ledger. The
        // worker directory lives in Keycloak and users get deleted, so a bare
        // worker_id becomes unresolvable for historical events — §3.3 stores
        // the name AT event time for exactly that reason. Placed before the
        // spread so a dialog may still override it.
        WorkerName: activeWorkerName || undefined,
        ...testData,
      }),
    });

    if (!response.ok) {
      // A body that is not JSON (a proxy's HTML 502) throws its parse error, as
      // it always has: a popup without fields shows what it showed before.
      const error = await response.json();
      // The body's code rides along: a station-field error (route-fields spec
      // §4.12) tells the popup what to do, e.g. reload its fields on a 409.
      throw Object.assign(new Error(error.error || "Failed to save test result"), { code: error.code as string | undefined });
    }
    // A result was actually recorded — the dialog's onClose (right after this
    // resolves) must not release the item back to waiting.
    dialogSubmittedRef.current = true;

    const result = await response.json();

    // Refresh items list
    handleRefreshItems();

    // A package wizard has its own "done" step (opened → items continue on
    // their routes / closed → package done), so the next-station dialog would
    // only say something misleading about the box.
    if (selectedItem.is_package) return;

    // Handle research response
    if (testData.sendToResearch && result.recommendedResearchStation) {
      setResearchStationInfo(result.recommendedResearchStation);
      setResearchDialogOpen(true);
    } else {
      // Check if this was a finishRoute action from research station
      const is_researchStatus = selectedItem.current_status === 5;
      const isFinishRoute = testData.finishRoute === true;

      setNextStationInfo({
        isLastStation: result.isLastStation || false,
        nextStation: result.nextStation || undefined,
        finishedFromResearch: is_researchStatus && isFinishRoute,
        finishedAtStep: selectedItem.current_route_step ?? undefined,
      });
      setNextStationDialogOpen(true);
    }
  };

  // Dock all-stations pick: the station goes into the URL.
  const handlePickAllStation = React.useCallback((station: StationLite | null) => {
    setHighlightedItemId(null);
    setFilterText("");
    setUrl({ station: station ? String(station.id) : "", item: "", q: "" });
  }, [setUrl, setFilterText]);

  const typeNameById = React.useCallback(
    (typeId: number) => stationTypes.find((t) => t.id === typeId)?.name ?? "",
    [stationTypes]
  );

  // The queue on screen belongs to another (or no) station yet: skeletons and
  // "—" until the selected station's queue answers. A station id the station
  // list does not know (yet) counts as loading, too.
  const itemsStale = stationId != null && (itemsQ.isPending || (selectedStation == null && allStationsQ.isPending));
  const hasWizard = selectedStationType != null && hasStartTestDialog(selectedStationType.id);

  // Keep the search field ready for the next scan: focus it whenever no
  // dialog is open and nothing else holds the focus.
  const anyDialogOpen = dialogOpen || scannerOpen || finishedDialogOpen || nextStationDialogOpen || researchDialogOpen || historyDialogOpen;
  React.useEffect(() => {
    if (anyDialogOpen) return;
    const t = setTimeout(() => {
      const a = document.activeElement;
      if (!a || a === document.body) filterRef.current?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [anyDialogOpen, stationId]);

  return (
    <Box
      sx={{
        width: "100%",
        minHeight: "100%",
        bgcolor: "var(--color-canvas-parchment)",
        display: "flex",
        flexDirection: "column",
        overflowX: "hidden", // Prevent horizontal overflow
      }}
    >
        {/* Auto-hiding context dock (station + worker + scan) */}
        <TestingDock
          hasStation={!!selectedStation}
          stationName={selectedStation?.test_station_desc ?? null}
          stationTypeName={selectedStationType?.name ?? null}
          itemCount={itemsStale ? null : filteredItems.length}
          countNoun={packageLevel ? "מארזים" : "פריטים"}
          allStations={allStations}
          typeNameById={typeNameById}
          selectedStationId={selectedStation?.test_station_id ?? null}
          onPickStation={handlePickAllStation}
          activeWorkerId={activeWorkerId}
          activeWorkerName={activeWorkerName}
          onWorkerChange={handleWorkerChange}
          workerLocked={workerLocked}
          onScan={() => { setScanError(null); setScanInput(""); setScannerOpen(true); }}
        />

        {legacyNotice && (
          <div className="tst-frame" style={{ marginTop: 16 }}>
            {/* Dismiss as a 32px IconButton: the Alert's own × is 24px, small for a station touchscreen. */}
            <Alert
              severity="warning"
              action={<IconButton size="small" title="סגירת ההודעה" onClick={() => setLegacyNotice(null)} sx={{ marginBlock: "-6px", marginInlineEnd: "-6px" }}><ClearIcon fontSize={16} aria-hidden /></IconButton>}
            >
              {legacyNotice}
            </Alert>
          </div>
        )}

        {/* Main Content Area — same 1280 frame as the dock */}
        <div className="tst-frame" style={{ marginTop: 24, marginBottom: 40, flex: 1 }}>
            {/* Search / scan + queue filters. The field is focused whenever no
                dialog is open, so a hardware scan lands here without a button
                press; Enter locates the code (at this or another station). */}
            <div className="tst-filters" role="search" aria-label="חיפוש וסינון התור">
                <div className="tst-scan">
                    <QrCodeIcon fontSize={20} aria-hidden className="tst-scan-icon" />
                    <input
                        ref={filterRef}
                        value={filterText}
                        onChange={(e) => setFilterText(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !scanLoading) { e.preventDefault(); handleFilterEnter(); }
                            if (e.key === "Escape") setFilterText("");
                        }}
                        placeholder={selectedStation ? "סרוק ברקוד, או חפש בתור לפי מזהה, סריאלי, מק״ט" : "סרוק ברקוד של פריט או מארז"}
                        aria-label="סריקה או חיפוש בתור"
                        aria-busy={scanLoading || undefined}
                        autoComplete="off"
                        dir="auto"
                    />
                    {scanLoading ? (
                        <span className="tst-scan-end" aria-hidden><CircularProgress size={14} /></span>
                    ) : filterText ? (
                        <IconButton size="small" className="tst-scan-end" title="ניקוי החיפוש" onClick={() => { setFilterText(""); filterRef.current?.focus(); }}><ClearIcon fontSize={16} aria-hidden /></IconButton>
                    ) : null}
                </div>
                <QueueFilter value={url.customer} onChange={(v) => setUrl({ customer: v })} options={customerOptions} allLabel="כל הלקוחות" disabled={!selectedStation} />
                <QueueFilter value={url.shipment} onChange={(v) => setUrl({ shipment: v })} options={shipmentOptions} allLabel="כל המשלוחים" disabled={!selectedStation} />
                <QueueFilter value={url.itype} onChange={(v) => setUrl({ itype: v })} options={itemTypeOptions} allLabel="כל סוגי הפריט" disabled={!selectedStation} />
                {anyFilter && <button type="button" className="tst-clear" onClick={clearFilters}>ניקוי הסינון</button>}
                {selectedStation && !itemsStale && (
                    <span className="tst-filter-count" role="status">
                        {anyFilter ? `מציג ${filteredItems.length} מתוך ${items.length}` : `${items.length} ${packageLevel ? "מארזים" : "פריטים"} בתור`}
                    </span>
                )}
            </div>

            {selectedStation || itemsStale ? (
                <Box>
                    {/* Summary strip — station overview KPIs */}
                    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "14px", mb: "22px" }}>
                        <SummaryTile
                            icon={<QueueIcon sx={{ fontSize: 21 }} />}
                            iconBg="var(--color-warning-bg)"
                            iconColor="var(--color-status-late)"
                            value={itemsStale ? "—" : waitingCount}
                            label="בתור"
                        />
                        <SummaryTile
                            icon={<ScienceIcon sx={{ fontSize: 21 }} />}
                            iconBg="var(--color-primary-soft)"
                            iconColor="var(--color-primary)"
                            value={itemsStale ? "—" : inTestCount}
                            label="בבדיקה"
                        />
                        <SummaryTile
                            icon={<CheckIcon sx={{ fontSize: 21 }} />}
                            iconBg="var(--color-success-bg)"
                            iconColor="var(--color-status-approved)"
                            value={completedToday ?? "—"}
                            label="הושלמו היום"
                        />
                        <SummaryTile
                            icon={<AccessTimeIcon sx={{ fontSize: 21 }} />}
                            iconBg="var(--color-warning-bg)"
                            iconColor="var(--color-status-late)"
                            // H:MM without the seconds. (slice(0, 5) cut "964:24:12" to "964:2" once
                            // the wait passed 99 hours — a wrong number on screen.)
                            value={!itemsStale && longestWait ? longestWait.replace(/:\d{2}$/, "") : "—"}
                            label="המתנה הארוכה ביותר"
                            valueColor="var(--color-warning-ink)"
                        />
                    </Box>

                    {/* Toolbar */}
                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "14px", flexWrap: "wrap", mb: "18px" }}>
                        <Box sx={{ display: "flex", alignItems: "baseline", gap: "12px", flexWrap: "wrap" }}>
                            <Typography component="h2" sx={{ m: 0, fontSize: "var(--text-lead)", fontWeight: 700, letterSpacing: "var(--ls-caption)", color: "var(--color-ink)" }}>
                                {packageLevel ? "מארזים בתור" : "התור לבדיקה"}
                            </Typography>
                            <Typography component="span" sx={{ fontSize: "var(--text-small)", color: "var(--color-ink-muted-48)" }}>
                                ממוינים לפי זמן המתנה — הממתין ביותר קודם
                            </Typography>
                            {/* A refresh over a list already on screen: a quiet note, not skeletons. */}
                            <span role="status" className="tst-refreshing">
                                {itemsLoading && !itemsStale && (
                                    <>
                                        <CircularProgress size={12} aria-hidden />
                                        מתעדכן…
                                    </>
                                )}
                            </span>
                        </Box>
                        <Box sx={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            <Button
                               variant="outlined"
                               color="inherit"
                               className="tst-toolbar-btn"
                               startIcon={<HistoryIcon sx={{ fontSize: 17 }} aria-hidden />}
                               onClick={() => setHistoryDialogOpen(true)}
                            >
                               היסטוריה
                            </Button>
                        </Box>
                    </Box>

                    {/* Items — row strips (queue rank + step progress) */}
                    {itemsStale ? (
                        <Box aria-hidden sx={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                            {[1, 2, 3, 4].map((i) => (
                                <Skeleton key={i} variant="rectangular" height={70} sx={{ borderRadius: "14px" }} />
                            ))}
                        </Box>
                    ) : itemsError ? (
                        <Alert
                            severity="error"
                            action={<Button size="small" variant="text" onClick={handleRefreshItems} disabled={itemsLoading}>נסה שוב</Button>}
                        >
                            {itemsError}
                        </Alert>
                    ) : packageLevel ? (
                        <Box sx={{ pb: 4 }}>
                            {blockedPackages.length > 0 && <BlockedPackagesBanner packages={blockedPackages} />}
                            {orderedItems.some((it) => it.is_package && it.package) ? (
                                <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "14px" }}>
                                    {orderedItems.filter((it) => it.is_package && it.package).map((item) => (
                                        <PackageQueueEntry
                                            key={item.item_id}
                                            item={item}
                                            kind={packageKindOf(item)}
                                            onAddTestResult={handleAddTestResult}
                                            onStartTest={handleStartTest}
                                            onRefresh={handleRefreshItems}
                                            onStartError={setStartError}
                                        />
                                    ))}
                                </Box>
                            ) : (
                                <EmptyState
                                    icon={<InventoryIcon sx={{ fontSize: 30 }} aria-hidden />}
                                    title="אין מארזים בתור לעמדה זו."
                                    hint="סרוק מדבקת קופסה לאיתור מארז."
                                />
                            )}
                            {/* Loose (pre-package) items that still route through this
                                station type keep the row layout underneath the boxes. */}
                            {orderedItems.some((it) => !it.is_package) && (
                                <Box sx={{ display: "flex", flexDirection: "column", gap: "10px", mt: "18px" }}>
                                    {orderedItems.filter((it) => !it.is_package).map((item, index) => (
                                        <ItemCard
                                            key={`${item.item_id}-${index}`}
                                            item={item}
                                            rank={index + 1}
                                            onAddTestResult={handleAddTestResult}
                                            onStartTest={handleStartTest}
                                            onRefresh={handleRefreshItems}
                                            onStartError={setStartError}
                                            highlighted={highlightedItemId != null && Number(item.item_id) === Number(highlightedItemId)}
                                        />
                                    ))}
                                </Box>
                            )}
                        </Box>
                    ) : orderedItems.length > 0 ? (
                        <Box sx={{ pb: 4 }}>
                            {/* Column headers */}
                            <Box aria-hidden sx={{ display: "flex", alignItems: "center", gap: "15px", padding: "0 16px 12px", fontSize: "var(--text-fine)", fontWeight: 700, color: "var(--color-ink-muted-48)" }}>
                                <Box sx={{ width: 38, flexShrink: 0, textAlign: "center" }}>תור</Box>
                                <Box sx={{ flex: 1 }}>מזהה · דגם</Box>
                                <Box sx={{ width: 150, flexShrink: 0 }}>שלב</Box>
                                <Box sx={{ minWidth: 82, flexShrink: 0, textAlign: "center" }}>זמן</Box>
                                <Box sx={{ width: 40, flexShrink: 0 }} />
                                <Box sx={{ width: 120, flexShrink: 0 }} />
                            </Box>
                            <Box sx={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                                {orderedItems.map((item, index) => (
                                    <ItemCard
                                        key={`${item.item_id}-${index}`}
                                        item={item}
                                        rank={index + 1}
                                        onAddTestResult={handleAddTestResult}
                                        onStartTest={handleStartTest}
                                        onRefresh={handleRefreshItems}
                                        onStartError={setStartError}
                                        highlighted={highlightedItemId != null && Number(item.item_id) === Number(highlightedItemId)}
                                        priority={priorityItemId != null && Number(item.item_id) === Number(priorityItemId)}
                                        hasWizard={hasWizard}
                                    />
                                ))}
                            </Box>
                        </Box>
                    ) : (
                        <EmptyState
                            icon={<InventoryIcon sx={{ fontSize: 30 }} aria-hidden />}
                            title="אין פריטים תואמים בעמדה זו."
                            hint="נסה לנקות את הסינון, או סרוק ברקוד לאיתור פריט."
                        />
                    )}
                </Box>
            ) : (
                // No station yet (artboard "no station"). The dock panel above
                // stays open in this state, so "למעלה" points at real controls.
                <EmptyState
                    icon={<ScienceIcon sx={{ fontSize: 30 }} aria-hidden />}
                    title="בחר עמדה כדי להתחיל"
                    hint="בחר עמדה ועובד למעלה, או סרוק ברקוד של פריט."
                />
            )}
        </div>

        {/* Dialogs — the per-type finish/report dialog, resolved from the registry. */}
        {(() => {
  if (!dialogOpen || !selectedItem || !selectedStation || !selectedStationType) return null;
  // A box at a package-level station gets the opening / closing wizard by the
  // station type's flag (PLAN §4); everything else resolves from the registry.
  const StartDialog = packageLevel && selectedItem.is_package && selectedItem.package
    ? (packageKindOf(selectedItem) === "open" ? PackageOpenWizard : PackageCloseWizard)
    : getStartTestDialog(selectedStationType.id);
  return (
    <StartDialog
      open={dialogOpen}
      onClose={() => {
        setDialogOpen(false);
        if (!dialogSubmittedRef.current) {
          releaseTest(selectedItem.item_id, selectedStation.test_station_id);
        }
      }}
      item={selectedItem}
      station={selectedStation}
      stationTypeName={selectedStationType.name}
      workerId={activeWorkerId}
      workerName={activeWorkerName}
      onSubmit={handleSubmitTestResult}
    />
  );
})()}


        {selectedStation && (
            <StationHistoryDialog
                open={historyDialogOpen}
                onClose={() => setHistoryDialogOpen(false)}
                stationId={selectedStation.test_station_id}
                stationName={selectedStation.test_station_desc}
            />
        )}

        {/* Next Station Dialog */}
        <Dialog
            open={nextStationDialogOpen}
            onClose={() => setNextStationDialogOpen(false)}
            maxWidth="xs"
            fullWidth
        >
            <DialogTitle onClose={() => setNextStationDialogOpen(false)}>
                <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: "10px" }}>
                    <CheckCircleOutlineIcon fontSize={24} color="success" aria-hidden />
                    {nextStationInfo?.finishedFromResearch ? "המסלול הסתיים" : "הבדיקה הושלמה בהצלחה!"}
                </Box>
            </DialogTitle>
            <DialogContent>
                {nextStationInfo?.finishedFromResearch ? (
                    <Typography sx={{ fontSize: "var(--text-body)" }}>
                        העובד סיים את המסלול בשלב {nextStationInfo?.finishedAtStep}
                    </Typography>
                ) : nextStationInfo?.isLastStation ? (
                    <Typography sx={{ fontSize: "var(--text-body)" }}>
                        זהו השלב האחרון בתהליך. הפריט סיים את כל הבדיקות.
                    </Typography>
                ) : (
                    <>
                        <Typography sx={{ fontSize: "var(--text-body)", color: "var(--color-ink-muted-48)" }}>התחנה הבאה בתהליך:</Typography>
                        <Box sx={{ display: "flex", alignItems: "center", gap: "12px", mt: "10px" }}>
                            <TrendingUpIcon fontSize={22} htmlColor="var(--color-ink-muted-48)" aria-hidden />
                            <Box>
                                <Typography sx={{ fontSize: "var(--text-lead)", fontWeight: 600 }}>
                                    {nextStationInfo?.nextStation?.testStationDesc || "לא ידוע"}
                                </Typography>
                                <Typography sx={{ fontSize: "var(--text-small)", color: "var(--color-ink-muted-48)" }}>
                                    שלב {nextStationInfo?.nextStation?.routeStep}
                                </Typography>
                            </Box>
                        </Box>
                    </>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={() => setNextStationDialogOpen(false)}>
                    אישור
                </Button>
            </DialogActions>
        </Dialog>

        {/* Research Dialog */}
        <Dialog
            open={researchDialogOpen}
            onClose={() => setResearchDialogOpen(false)}
            maxWidth="xs"
            fullWidth
        >
            <DialogTitle onClose={() => setResearchDialogOpen(false)}>
                <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: "10px" }}>
                    <ScienceIcon fontSize={24} color="warning" aria-hidden />
                    הועבר לחקר
                </Box>
            </DialogTitle>
            <DialogContent>
                <Typography sx={{ fontSize: "var(--text-body)", color: "var(--color-ink-muted-48)" }}>
                    הפריט הועבר להמשך טיפול בעמדת חקר:
                </Typography>
                <Typography sx={{ fontSize: "var(--text-lead)", fontWeight: 600, mt: "10px" }}>
                    {researchStationInfo?.stationDesc}
                </Typography>
            </DialogContent>
            <DialogActions>
                <Button onClick={() => setResearchDialogOpen(false)} color="warning">
                    אישור
                </Button>
            </DialogActions>
        </Dialog>

        {/* Finished Route Dialog (shown when a scanned item has already finished its testing route) */}
        <Dialog
            open={finishedDialogOpen}
            onClose={() => setFinishedDialogOpen(false)}
            maxWidth="xs"
            fullWidth
        >
            <DialogTitle onClose={() => setFinishedDialogOpen(false)}>
                <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: "10px" }}>
                    <CheckCircleOutlineIcon fontSize={24} color="success" aria-hidden />
                    המסלול הסתיים
                </Box>
            </DialogTitle>
            <DialogContent>
                <Typography sx={{ fontSize: "var(--text-body)" }}>
                    פריט זה סיים את מסלול הבדיקות.
                </Typography>
                {finishedItemInfo && (
                    // The scanned item's identity, as plain lines (no card in the dialog).
                    <Box sx={{ display: "flex", flexDirection: "column", gap: "4px", mt: "14px", pt: "14px", borderTop: "1px solid var(--color-hairline)" }}>
                        <Typography sx={{ fontSize: "var(--text-lead)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                            #{finishedItemInfo.itemId}
                        </Typography>
                        {finishedItemInfo.model && (
                            <Typography sx={{ fontSize: "var(--text-body-sm)", color: "var(--color-ink-muted-48)" }}>
                                מודל: {finishedItemInfo.model}
                            </Typography>
                        )}
                        {finishedItemInfo.serialNo && (
                            <Typography sx={{ fontSize: "var(--text-body-sm)", color: "var(--color-ink-muted-48)" }}>
                                סריאלי: <bdi dir="ltr">{finishedItemInfo.serialNo}</bdi>
                            </Typography>
                        )}
                    </Box>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={() => setFinishedDialogOpen(false)} color="success">
                    אישור
                </Button>
            </DialogActions>
        </Dialog>

        {/* Barcode Scanner Dialog */}
        <Dialog
            open={scannerOpen}
            onClose={() => {
                if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
                setScannerOpen(false);
                setScanError(null);
                setScanInput("");
            }}
            maxWidth="sm"
            fullWidth
        >
            <DialogTitle onClose={() => {
                if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
                setScannerOpen(false);
                setScanError(null);
                setScanInput("");
            }}>
                סריקת ברקוד פריט
            </DialogTitle>
            <DialogContent>
                <Box sx={{ display: "flex", flexDirection: "column", gap: "16px", pt: "4px" }}>
                    {scanError && (
                        <Alert severity="error">
                            {scanError}
                        </Alert>
                    )}
                    <Typography sx={{ fontSize: "var(--text-body)", color: "var(--color-ink-muted-48)" }}>
                        סרוק את הברקוד של הפריט או הזן את המזהה ידנית ולחץ Enter.
                    </Typography>
                    {/* Never disabled: a disabled field drops focus, and the next
                        hardware scan would type into nothing. While a lookup runs
                        it is read-only instead (ST-4). */}
                    <TextField
                        autoFocus
                        fullWidth
                        aria-label="ברקוד פריט"
                        placeholder="ממתין לסריקה…"
                        value={scanInput}
                        inputRef={scanInputRef}
                        dir="ltr"
                        wrapClassName="tst-scan-field"
                        aria-busy={scanLoading || undefined}
                        InputProps={{
                            readOnly: scanLoading,
                            startAdornment: (
                                <InputAdornment position="start">
                                    <QrCodeIcon fontSize={20} aria-hidden />
                                </InputAdornment>
                            ),
                        }}
                        onChange={(e) => {
                            const val = e.target.value;
                            setScanInput(val);
                            // Enter submits. Fallback for a scanner set up without
                            // an Enter suffix: submit after a pause long enough
                            // that a person still typing isn't cut off.
                            if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
                            if (val.trim().length >= 1) {
                                scanTimeoutRef.current = setTimeout(() => {
                                    handleBarcodeScan(val);
                                }, SCAN_IDLE_SUBMIT_MS);
                            }
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && scanInput.trim() && !scanLoading) {
                                if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
                                handleBarcodeScan(scanInput);
                            }
                        }}
                    />
                </Box>
            </DialogContent>
            <DialogActions>
                <Button
                    variant="text"
                    color="inherit"
                    onClick={() => {
                        if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
                        setScannerOpen(false);
                        setScanError(null);
                        setScanInput("");
                    }}
                >
                    ביטול
                </Button>
                <Button
                    onClick={() => handleBarcodeScan(scanInput)}
                    disabled={!scanInput.trim()}
                    loading={scanLoading}
                >
                    {scanLoading ? "מאתר…" : "אישור"}
                </Button>
            </DialogActions>
        </Dialog>

        {/* The page's error toast (start-test failures, scans from the global listener). */}
        <Snackbar open={!!toastMessage} autoHideDuration={8000} onClose={closeToast} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
            <Alert
                severity="error"
                sx={{ minWidth: 320, maxWidth: 560, boxShadow: "var(--shadow-pop)" }}
                action={<IconButton size="small" title="סגירת ההודעה" onClick={closeToast} sx={{ marginBlock: "-6px", marginInlineEnd: "-6px" }}><ClearIcon fontSize={16} aria-hidden /></IconButton>}
            >
                {toastMessage}
            </Alert>
        </Snackbar>

    </Box>
  );
}

export default function TestingPage() {
  // useSearchParams (the palette's ?type=/?station= deep link) needs a Suspense
  // boundary so the route isn't forced into client-side rendering at build time.
  return (
    <React.Suspense fallback={null}>
      <TestingPageView />
    </React.Suspense>
  );
}
