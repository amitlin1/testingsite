"use client";
import * as React from "react";
import { Typography, Box, Button, Stack, MenuItem, Menu, IconButton } from "@/components/ui";
import {
  ArrowBack as ArrowBackIcon,
  CheckCircleOutline as CheckCircleOutlineIcon,
  Inventory as InventoryIcon,
  PlayArrowRounded as PlayArrowRoundedIcon,
  QrCode as QrCodeIcon,
  Star as StarIcon,
} from "@/components/ui/icons";
import IdText from "@/app/components/IdText";
import { ITEM_STATES } from "@/app/components/packages/packageUi";
import { seq2 } from "@/app/lib/packages/ids";
import type { QueueRow } from "@/app/lib/testing/contract";
import { ItemStatus, TONE_DOT, isInTestStatus, isWaitingStatus, toneOfStatus } from "@/lib/item-status";
import { formatDuration } from "@/app/lib/datetime";
import { useNetSeconds } from "../clock";
import "@/app/testing/station-popups.css";

/**
 * A queue row (option 3a: queue rank + step progress). The status reads once per row: a dot in the
 * status tone (item-status map) beside its label in ink. Rank, steps and timer stay neutral (HI-5:
 * the artboard's item card has no coloured side stripe).
 */
export default function ItemCard({
  item,
  rank,
  onBegin,
  highlighted = false,
  priority = false,
  onStepBack,
}: {
  item: QueueRow;
  rank: number;
  /** The row's button: start (then the popup), or continue the test (useTestWindow begin). */
  onBegin: (item: QueueRow) => void;
  highlighted?: boolean;
  priority?: boolean;
  /** "חזרה לבדיקה הקודמת": given only when the item can go back a step (queueItemStepBack). */
  onStepBack?: () => void;
}) {
  const isInTest = isInTestStatus(item.current_status);
  const isWaiting = isWaitingStatus(item.current_status);
  const elapsed = useNetSeconds(isInTest ? item.processing_start_time : isWaiting ? item.queue_start_time : null);
  // Package model: an item inside a box carries the box's view (siblings and
  // where each one is) — design/Testing Screen Packages.dc.html, item strip.
  const pkg = item.package_id != null ? item.package ?? null : null;
  const siblings = pkg ? pkg.items.filter((s) => String(s.item_id) !== String(item.item_id)) : [];

  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const handleMenuClick = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
  };
  const handleMenuClose = () => setAnchorEl(null);

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
        {/* On the card's top edge, at its start: the priority ribbon (the
            longest-waiting item) and "חזרה לבדיקה הקודמת", side by side. */}
        {(priority || onStepBack) && (
            <Box sx={{ position: "absolute", top: -10, insetInlineStart: 58, zIndex: 3, display: "flex", alignItems: "center", gap: "6px" }}>
                {priority && (
                    <Box
                        sx={{
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
                {onStepBack && (
                    <button type="button" className="tst-step-back" onClick={onStepBack}>
                        <ArrowBackIcon sx={{ fontSize: 12 }} aria-hidden />
                        חזרה לבדיקה הקודמת
                    </button>
                )}
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

        <Box sx={{ minWidth: 0, flex: 1 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: "9px", flexWrap: "wrap" }}>
                <IdText id={item.item_id} size={17} headColor="var(--color-ink)" weight={700} letterSpacing="var(--ls-caption)" />
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

        <Box sx={{ flexShrink: 0, fontSize: "var(--text-body)", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "var(--color-ink)", minWidth: 82, textAlign: "center" }}>
            {elapsed != null ? formatDuration(elapsed * 1000) : "—"}
        </Box>

        {/* Package slot — fixed width so the columns stay aligned. An item in a
            box gets the box icon; the menu lists the other items in the same
            package and where each one is (replaces the old parent/accessory
            "connected items" menu — docs/features/packages/PLAN.md §9.14). */}
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
                  {pkg && <Box sx={{ mt: "2px" }}><IdText id={pkg.item_id} size={13} headColor="var(--color-ink)" /></Box>}
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

        {/* The row's CTA; a finished row shows its status instead */}
        {isActionable ? (
            <Button
                className="tst-cta"
                onClick={() => onBegin(item)}
                startIcon={<PlayArrowRoundedIcon sx={{ fontSize: 16 }} aria-hidden />}
            >
              {isWaiting ? (item.current_status === ItemStatus.AwaitResearch ? "התחל מחקר" : "התחל בדיקה") : "המשך בדיקה"}
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
