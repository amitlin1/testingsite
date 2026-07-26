"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUp,
  Clock,
  CornerDownLeft,
  FlaskConical,
  Folder,
  History,
  LayoutDashboard,
  LayoutGrid,
  Loader2,
  type LucideIcon,
  Monitor,
  Package,
  Plus,
  Search,
  Settings,
  Tag,
  Truck,
} from "lucide-react";
import type {
  SearchIndex,
  SearchStation,
  SearchStationType,
} from "@/app/api/search/index/route";
import type { SearchItem } from "@/app/api/search/items/route";
import { apiFetch } from "@/lib/api/client";

/* =========================================================================
   Command palette (Ctrl+K) — one search box for עמדות, פריטים, סוגי עמדות
   and navigation, replacing the four hand-rolled per-screen search inputs.

   Two-speed index, on purpose:
     · Stations / station types / item types — small bounded tables. Fetched
       ONCE per open from /api/search/index and ranked here in the browser, so
       typing an עמדה name filters with zero latency.
     · Items — unbounded. Debounced round-trip to /api/search/items, which
       filters and caps in SQL. Client-side filtering of the whole items table
       (what the existing screens do) would not scale.

   Styling lives in src/styles/command-palette.css (`cp-*`).
   ========================================================================= */

// ---------------------------------------------------------------- recents

// Stored in a cookie (not localStorage) to match the Tickets app: a cookie is
// readable server-side, so recents can later be rendered into the first paint
// instead of appearing a frame after hydration.
const RECENT_COOKIE = "testing-cmdk-recent";
/** Rolling window — a new entry at the cap drops the oldest. */
const RECENT_MAX = 7;
const RECENT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // one year

function readRecents(): string[] {
  if (typeof document === "undefined") return [];
  const match = document.cookie
    .split("; ")
    .find((c) => c.startsWith(RECENT_COOKIE + "="));
  if (!match) return [];
  try {
    const parsed = JSON.parse(
      decodeURIComponent(match.slice(RECENT_COOKIE.length + 1)),
    );
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    // A malformed/truncated cookie must not take the palette down with it.
    return [];
  }
}

/** Prepend a query to the recents (dedup, cap), persist to the cookie. */
function pushRecent(query: string): void {
  const q = query.trim();
  if (!q) return;
  try {
    const next = [q, ...readRecents().filter((x) => x !== q)].slice(0, RECENT_MAX);
    document.cookie = `${RECENT_COOKIE}=${encodeURIComponent(
      JSON.stringify(next),
    )}; path=/; max-age=${RECENT_COOKIE_MAX_AGE}; samesite=lax`;
  } catch {
    /* cookies disabled — recents are a nicety, never a hard failure */
  }
}

// ---------------------------------------------------------------- ranking

/**
 * Relevance of `q` against ranked fields — the first field is primary, later
 * ones count less. Returns -1 when nothing matches.
 * Exact > prefix > word-start > substring, with small bonuses for an earlier
 * match position and a shorter field.
 */
function rel(q: string, ...fields: (string | null | undefined)[]): number {
  let best = -1;
  for (let fi = 0; fi < fields.length; fi++) {
    const f = fields[fi];
    if (!f) continue;
    // `q` is lower-cased by the caller; lower-case the field too so matching is
    // case-insensitive for Latin model/manufacturer names. Hebrew is caseless.
    const fl = f.toLowerCase();
    const at = fl.indexOf(q);
    if (at < 0) continue;
    let s: number;
    if (fl === q) s = 100;
    else if (at === 0) s = 82;
    else if (fl[at - 1] === " " || fl[at - 1] === "·" || fl[at - 1] === "-") s = 64;
    else s = 44;
    s -= Math.min(at, 20) * 0.4; // earlier match ranks higher
    s -= Math.min(f.length, 40) * 0.05; // shorter field ranks slightly higher
    best = Math.max(best, s * (fi === 0 ? 1 : 0.55)); // primary field dominates
  }
  return best;
}

/** Wrap the matched substring in a <mark> so the user sees WHY a row matched. */
function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const at = text.toLowerCase().indexOf(q);
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="cp-mark">{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  );
}

// ---------------------------------------------------------------- items

interface PaletteItem {
  key: string;
  label: string;
  sub?: string;
  icon: LucideIcon;
  /** Trailing pill (e.g. "4 עמדות", "הושלם"). */
  tag?: string;
  /** Trailing affordance icon — recents use it for "fill the input". */
  trailIcon?: LucideIcon;
  /** When set, selecting fills the input instead of navigating. */
  fillQuery?: string;
  /** Navigation target (mutually exclusive with fillQuery). */
  href?: string;
  /** Relevance — ranks the merged "תוצאות" group. */
  score?: number;
}

/** Static navigation targets, always searchable by name. */
const NAV_DEFS: { id: string; label: string; sub: string; icon: LucideIcon; href: string }[] = [
  { id: "items", label: "ניהול פריטים", sub: "דוחות ורשימת פריטים", icon: LayoutDashboard, href: "/" },
  { id: "testing", label: "מסך בדיקה", sub: "תור העמדה ובדיקות פעילות", icon: FlaskConical, href: "/testing" },
  { id: "dashboard", label: "לוח ניהול", sub: "מדדים וניתוחים", icon: LayoutDashboard, href: "/dashboard" },
  { id: "shipments", label: "משלוחים נכנסים", sub: "קליטת משלוחים", icon: Truck, href: "/shipments" },
  { id: "files", label: "ניהול קבצים", sub: "קבצים מצורפים", icon: Folder, href: "/files" },
  { id: "stations", label: "עמדות בדיקה", sub: "הגדרות · סוגי עמדות ועמדות", icon: Monitor, href: "/settings/test-stations" },
  { id: "routes", label: "מסלולי בדיקה", sub: "הגדרות", icon: Settings, href: "/settings/testing-routes" },
  { id: "itemtypes", label: "סוגי פריטים", sub: "הגדרות", icon: Tag, href: "/settings/item-types" },
  { id: "reference", label: "פריטי ייחוס", sub: "הגדרות", icon: Package, href: "/settings/reference-items" },
  { id: "workers", label: "עובדים", sub: "הגדרות", icon: Settings, href: "/settings/workers" },
];

/**
 * A station's PRIMARY destination is its live queue on the testing screen —
 * that's what people are actually looking for when they type a station or its
 * type. The settings row (below) is the secondary, admin-side twin.
 */
function stationTestingHref(s: SearchStation): string {
  return `/testing?type=${s.typeId}&station=${s.id}`;
}

/** Secondary: edit the station itself in the settings master–detail. */
function stationSettingsHref(s: SearchStation): string {
  return `/settings/test-stations?type=${s.typeId}&station=${s.id}`;
}

function stationTypeHref(t: SearchStationType): string {
  return `/settings/test-stations?type=${t.id}`;
}

/**
 * The items list hides `current_status === 3` by default, so a deep link to a
 * finished item must also pin the status filter — otherwise we'd navigate to
 * an empty table and look broken.
 */
function itemHref(it: SearchItem): string {
  const q = encodeURIComponent(it.serialNo || it.itemId);
  return it.isFinished ? `/?q=${q}&status=3` : `/?q=${q}`;
}

/**
 * The item's live station queue, pre-filtered to the item itself. Only built
 * when the server resolved a station that genuinely lists this item (see
 * queueStationId in /api/search/items) — a link to an empty queue is worse
 * than no link.
 */
function itemStationHref(it: SearchItem): string | null {
  if (it.queueStationId == null || it.queueStationTypeId == null) return null;
  return `/testing?type=${it.queueStationTypeId}&station=${it.queueStationId}&item=${encodeURIComponent(it.itemId)}`;
}

/** The full-page reconstruction of everything the item went through. */
function itemHistoryHref(it: SearchItem): string {
  return `/items/${encodeURIComponent(it.itemId)}/history`;
}

interface Group {
  label: string;
  items: PaletteItem[];
}

/**
 * Build the grouped, ranked result list. Order top → bottom is also the
 * keyboard navigation order: recents (idle only), then the ranked mixed
 * results, then station types, stations, and items in their own groups.
 */
function buildGroups(
  index: SearchIndex | null,
  rawQuery: string,
  recents: string[],
  items: SearchItem[],
): Group[] {
  const q = rawQuery.trim().toLowerCase();
  const groups: Group[] = [];

  // ---- Idle state: recents + quick navigation ----
  if (!q) {
    if (recents.length) {
      groups.push({
        label: "חיפושים אחרונים",
        items: recents.map((r, i) => ({
          key: `recent-${i}`,
          label: r,
          icon: Clock,
          trailIcon: ArrowUp,
          fillQuery: r,
        })),
      });
    }
    groups.push({
      label: "מעברים מהירים",
      items: [
        { key: "act-new-item", label: "פריט חדש", sub: "קליטת פריט למערכת", icon: Plus, href: "/?new=1" },
        ...NAV_DEFS.slice(0, 6).map((n) => ({
          key: `nav-${n.id}`,
          label: n.label,
          sub: n.sub,
          icon: n.icon,
          href: n.href,
        })),
      ],
    });
    return groups;
  }

  // ---- עמדות — FIRST, because opening a station's queue is the common intent.
  // Matching on typeDesc too means typing a type name ("צילום") surfaces every
  // station of that type, each with its testing-screen row on top.
  const stations = (index?.stations ?? [])
    .map((s) => ({
      s,
      // A decommissioned station (status 3) is nowhere anyone wants to go, so
      // it sinks below live ones on an equal text match. "המתנה" (2) is a
      // normal working state and gets no penalty.
      score: rel(q, s.desc, String(s.id), s.typeDesc) - (s.status === STATION_STATUS_RETIRED ? 12 : 0),
    }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
  if (stations.length) {
    const rows: PaletteItem[] = [];
    for (const { s } of stations) {
      rows.push({
        key: `station-test-${s.id}`,
        label: `מסך בדיקה · ${s.desc}`,
        sub: `פתיחת תור העמדה · ${s.typeDesc}${s.isResearch ? " · מחקר" : ""}`,
        icon: FlaskConical,
        // Show the station's real state; only "עבודה" is unremarkable enough
        // to leave untagged.
        tag: s.status === STATION_STATUS_WORKING ? undefined : s.statusDesc || undefined,
        href: stationTestingHref(s),
      });
      rows.push({
        key: `station-cfg-${s.id}`,
        label: s.desc,
        sub: `#${s.id} · ${s.typeDesc} · הגדרות עמדה`,
        icon: Monitor,
        href: stationSettingsHref(s),
      });
    }
    groups.push({ label: "עמדות", items: rows });
  }

  // ---- סוגי עמדות ----
  const types = (index?.stationTypes ?? [])
    .map((t) => ({ t, score: rel(q, t.desc, String(t.id)) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(({ t }) => ({
      key: `stype-${t.id}`,
      label: t.desc,
      sub: t.parentsOnly ? "סוג עמדה · פריטי אב בלבד" : "סוג עמדה",
      icon: LayoutGrid,
      tag: `${t.stationCount} עמדות`,
      href: stationTypeHref(t),
    }));
  if (types.length) groups.push({ label: "סוגי עמדות", items: types });

  // ---- Ranked pool: navigation + item types ----
  const pool: PaletteItem[] = [];
  for (const n of NAV_DEFS) {
    const score = rel(q, n.label, n.sub);
    if (score < 0) continue;
    pool.push({ key: `nav-${n.id}`, label: n.label, sub: n.sub, icon: n.icon, href: n.href, score });
  }
  for (const t of index?.itemTypes ?? []) {
    const score = rel(q, t.desc);
    if (score < 0) continue;
    pool.push({
      key: `itemtype-${t.id}`,
      label: t.desc,
      sub: "סוג פריט · הגדרות",
      icon: Tag,
      href: "/settings/item-types",
      score,
    });
  }
  const ranked = pool.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 5);
  if (ranked.length) groups.push({ label: "תוצאות", items: ranked });

  // ---- פריטים ----
  // Each item fans out into its destinations, most-wanted first: the station
  // it's sitting at right now, then its history, then the items table. Same
  // shape as the עמדות group above (one entity → several rows).
  if (items.length) {
    const rows: PaletteItem[] = [];
    for (const it of items.slice(0, ITEM_ROWS_MAX)) {
      const name = it.serialNo || `פריט ${it.itemId}`;
      // Serial numbers are not unique in practice, so every sub-line leads with
      // the item id — otherwise two items sharing a serial render three
      // identical-looking rows each.
      const identity = [`#${it.itemId}`, it.model, it.makat ? `מק״ט ${it.makat}` : null, it.itemTypeDesc]
        .filter(Boolean)
        .join(" · ");
      const stateTag = it.isFinished ? "הושלם" : it.statusDesc ?? undefined;

      // 1 — עמדת הפריט. Absent for a finished item, or when no station's queue
      // would list it; we say why rather than offering a dead link.
      const stationHref = itemStationHref(it);
      if (stationHref) {
        rows.push({
          key: `item-station-${it.itemId}`,
          label: `עמדת הפריט · ${it.queueStationDesc}`,
          sub: `${identity} · פתיחת תור העמדה מסונן לפריט`,
          icon: FlaskConical,
          tag: stateTag,
          href: stationHref,
        });
      }

      // 2 — היסטוריית הפריט.
      rows.push({
        key: `item-history-${it.itemId}`,
        label: `היסטוריית פריט · ${name}`,
        sub: it.isFinished
          ? `${identity} · הפריט הושלם`
          : stationHref
            ? identity
            : `${identity} · אינו בתור באף עמדה`,
        icon: History,
        tag: stationHref ? undefined : stateTag,
        href: itemHistoryHref(it),
      });

      // 3 — דף הפריטים.
      rows.push({
        key: `item-${it.itemId}`,
        label: name,
        sub: [identity, it.stationDesc, "רשימת הפריטים"].filter(Boolean).join(" · "),
        icon: Package,
        href: itemHref(it),
      });
    }
    groups.push({ label: "פריטים", items: rows });
  }

  return groups;
}

// ---------------------------------------------------------------- component

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

/** test_station_status ids: 1 "עבודה", 2 "המתנה", 3 "לא פעילה". */
const STATION_STATUS_WORKING = 1;
const STATION_STATUS_RETIRED = 3;

/** Item search waits this long after the last keystroke before hitting the DB. */
const ITEM_DEBOUNCE_MS = 200;
/** Matches MIN_QUERY in /api/search/items — below this the server returns []. */
const ITEM_MIN_QUERY = 2;
/**
 * Items shown in the palette. Lower than the server's cap of 8 because each
 * item now renders up to three rows — 8 would put 24 rows behind the arrow
 * keys. Matches the 4-station cap in the עמדות group above.
 */
const ITEM_ROWS_MAX = 4;

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [index, setIndex] = React.useState<SearchIndex | null>(null);
  const [recents, setRecents] = React.useState<string[]>([]);
  const [items, setItems] = React.useState<SearchItem[]>([]);
  const [itemsLoading, setItemsLoading] = React.useState(false);
  const [active, setActive] = React.useState(0);

  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  // On every open: reset, refresh recents, focus the input, load the index.
  React.useEffect(() => {
    if (!open) return;
    setQuery("");
    setItems([]);
    setActive(0);
    setRecents(readRecents());
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    let cancelled = false;
    apiFetch("/api/search/index")
      .then((r) => r.json())
      .then((data: SearchIndex) => {
        if (!cancelled) setIndex(data);
      })
      .catch(() => {
        // Station search degrades to nothing; item search and nav still work.
        if (!cancelled) setIndex({ stations: [], stationTypes: [], itemTypes: [] });
      });
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open]);

  // Debounced item search. The `cancelled` flag is what keeps results in sync
  // with the input: a slow response for "AB" must never overwrite the results
  // for "ABC" that the user has already typed.
  React.useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < ITEM_MIN_QUERY) {
      setItems([]);
      setItemsLoading(false);
      return;
    }
    setItemsLoading(true);
    let cancelled = false;
    const t = setTimeout(() => {
      apiFetch(`/api/search/items?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((data: SearchItem[]) => {
          if (cancelled) return;
          setItems(Array.isArray(data) ? data : []);
          setItemsLoading(false);
        })
        .catch(() => {
          if (!cancelled) {
            setItems([]);
            setItemsLoading(false);
          }
        });
    }, ITEM_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, open]);

  const groups = React.useMemo(
    () => buildGroups(index, query, recents, items),
    [index, query, recents, items],
  );
  const flat = React.useMemo(() => groups.flatMap((g) => g.items), [groups]);

  // Keep the cursor in bounds as the result set changes under it.
  React.useEffect(() => {
    setActive((a) => (flat.length === 0 ? 0 : Math.min(a, flat.length - 1)));
  }, [flat.length]);

  // Scroll the active row into view WITHOUT scrollIntoView, which would also
  // scroll the page behind the modal.
  React.useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>('[data-active="true"]');
    if (!el) return;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top - 6;
    else if (bottom > list.scrollTop + list.clientHeight)
      list.scrollTop = bottom - list.clientHeight + 6;
  }, [active, groups]);

  const runItem = React.useCallback(
    (it: PaletteItem | undefined) => {
      if (!it) return;
      if (it.fillQuery != null) {
        setQuery(it.fillQuery);
        inputRef.current?.focus();
        return;
      }
      if (!it.href) return;
      pushRecent(query);
      onClose();
      router.push(it.href);
    },
    [query, onClose, router],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (flat.length ? (a + 1) % flat.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (flat.length ? (a - 1 + flat.length) % flat.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runItem(flat[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  if (!open) return null;

  const q = query.trim().toLowerCase();
  let cursor = -1;

  return (
    <div className="cp-scrim" onMouseDown={onClose}>
      <div
        className="cp-panel"
        role="dialog"
        aria-modal="true"
        aria-label="חיפוש כללי"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="cp-input-row">
          <Search size={18} strokeWidth={1.9} />
          <input
            ref={inputRef}
            className="cp-input"
            placeholder="חיפוש עמדות, פריטים, סוגי עמדות, מסכים…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            aria-label="שדה חיפוש"
          />
          <button className="cp-esc" onClick={onClose} type="button">
            Esc
          </button>
        </div>

        <div className="cp-list" ref={listRef} role="listbox">
          {!index ? (
            <div className="cp-empty">טוען…</div>
          ) : flat.length === 0 ? (
            <div className="cp-empty">
              {itemsLoading ? "מחפש…" : <>לא נמצאו תוצאות עבור <strong>{query.trim()}</strong></>}
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.label}>
                <div className="cp-group-label">{g.label}</div>
                {g.items.map((it) => {
                  cursor += 1;
                  const isActive = cursor === active;
                  const hoverIndex = cursor;
                  const Ico = it.icon;
                  const Trail = it.trailIcon;
                  return (
                    <div
                      key={it.key}
                      role="option"
                      aria-selected={isActive}
                      className={`cp-item${isActive ? " is-active" : ""}`}
                      data-active={isActive ? "true" : undefined}
                      onMouseMove={() => setActive(hoverIndex)}
                      onClick={() => runItem(it)}
                    >
                      <span className="cp-item-ico">
                        <Ico size={16} strokeWidth={1.8} />
                      </span>
                      <span className="cp-item-main">
                        <span className="cp-item-label">
                          <Highlight text={it.label} q={q} />
                        </span>
                        {it.sub && (
                          <span className="cp-item-sub">
                            <Highlight text={it.sub} q={q} />
                          </span>
                        )}
                      </span>
                      {it.tag && <span className="cp-item-tag">{it.tag}</span>}
                      {Trail ? (
                        <span className="cp-item-enter">
                          <Trail size={14} strokeWidth={1.8} />
                        </span>
                      ) : (
                        isActive && (
                          <span className="cp-item-enter">
                            <CornerDownLeft size={14} strokeWidth={1.8} />
                          </span>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="cp-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> ניווט
          </span>
          <span>
            <kbd>↵</kbd> בחירה
          </span>
          <span>
            <kbd>Esc</kbd> סגירה
          </span>
          {itemsLoading && (
            <span className="cp-foot-spinner" aria-hidden>
              <Loader2 size={13} className="cp-spin" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default CommandPalette;
