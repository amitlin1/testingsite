"use client";
import * as React from "react";
import Link from "next/link";
import { ExternalLink, Package } from "lucide-react";
import { Button, Tag } from "@/components/ui";
import SearchableCombobox from "@/app/components/common/SearchableCombobox";
import { CONTEXT_CARD_TEXT, COPY_PENDING, coverageText, kitSummaryText, routeOptionText } from "../lib/labels";
import type { RouteRef } from "../lib/routeQuery";
import KeyboardHelp from "./KeyboardHelp";

/**
 * The context card (route-fields spec §5.2; artboards 1, 2, 11): <section aria-label="מסלול נבחר">,
 * one row that wraps —
 *   "מסלול"  every route (GET /api/settings/testing-routes) joined with its item type
 *            (GET /api/settings/item-types: name, is_package), kits first, then items. The
 *            primitive has no groupBy: the list is sorted and each option's subtitle names its
 *            group (spec §5.2). Value "{type} · מסלול {n}", Package at the start for a kit.
 *   tags     primary "מארז · {k} סוגי פריטים · {u} יחידות" (a kit, from the context's lines) and
 *            the count "כיסוי {defined}/{relevant}" (mapModel coverage) — each only once known.
 *   actions  ghost "פתח במסך המארזים" (a kit) → /settings/packages?type={id}; the "?" of the
 *            keyboard shortcuts.
 * Hidden on the library view (artboard 8) — the page decides.
 */

/** One route of the "מסלול" list. */
export type RouteOption = {
  /** "{type}:{route}" — unique (a route is the pair). */
  key: string;
  type: number;
  route: number;
  /** item_types.item_type_desc (trimmed). */
  desc: string;
  isPackage: boolean;
};

/** Kits first, then items; by name, then by route number. */
export function sortRouteOptions(options: readonly RouteOption[]): RouteOption[] {
  return [...options].sort(
    (a, b) =>
      Number(b.isPackage) - Number(a.isPackage) ||
      a.desc.localeCompare(b.desc, "he") ||
      a.route - b.route,
  );
}

export type RouteContextCardProps = {
  /** Every route, sorted (sortRouteOptions); null while the list loads. */
  options: RouteOption[] | null;
  /** The open route; a pair with no route yet (a new one in "שלבי המסלול") still shows. */
  value: RouteOption | null;
  onChange: (ref: RouteRef) => void;
  /** A kit's template, from the context's lines; null when not a kit or not loaded. */
  kit: { kinds: number; units: number } | null;
  /** The map's coverage; null while unknown. */
  coverage: { defined: number; relevant: number } | null;
};

export default function RouteContextCard({ options, value, onChange, kit, coverage }: RouteContextCardProps) {
  return (
    <section aria-label={CONTEXT_CARD_TEXT.sectionLabel} className="settings-card rf-context-card">
      <div className="rf-context-card__pick">
        <SearchableCombobox<RouteOption>
          options={options ?? []}
          loading={options == null}
          value={value}
          onChange={(o) => { if (o) onChange({ type: o.type, route: o.route }); }}
          getOptionLabel={(o) => routeOptionText(o.desc, o.route)}
          getOptionSubtitle={(o) => (o.isPackage ? COPY_PENDING.routeGroupKit : COPY_PENDING.routeGroupItem)}
          isOptionEqualToValue={(a, b) => a.key === b.key}
          label={CONTEXT_CARD_TEXT.routeLabel}
          dense
          disableClearable
          startIcon={value?.isPackage ? <Package size={18} strokeWidth={1.75} aria-hidden /> : undefined}
        />
      </div>

      {(kit || coverage) && (
        <div className="rf-context-card__tags">
          {kit && <Tag tone="primary" size="md" style={{ fontVariantNumeric: "tabular-nums" }}>{kitSummaryText(kit.kinds, kit.units)}</Tag>}
          {coverage && <span className="settings-count">{coverageText(coverage.defined, coverage.relevant)}</span>}
        </div>
      )}

      <div className="rf-context-card__actions">
        {value?.isPackage && (
          <Button
            variant="text"
            component={Link}
            href={`/settings/packages?type=${value.type}`}
            startIcon={<ExternalLink size={16} strokeWidth={1.75} aria-hidden />}
          >
            {CONTEXT_CARD_TEXT.openPackages}
          </Button>
        )}
        <KeyboardHelp />
      </div>
    </section>
  );
}
