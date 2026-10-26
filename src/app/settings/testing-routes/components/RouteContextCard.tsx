"use client";
import * as React from "react";
import Link from "next/link";
import { ExternalLink, Package } from "lucide-react";
import { Button, Tag } from "@/components/ui";
import SearchableCombobox from "@/app/components/common/SearchableCombobox";
import {
  CONTEXT_CARD_TEXT, ROUTE_PICK_TEXT, coverageText, kitRoutesText, kitSummaryText, routeNumberSubText, routeNumberText,
} from "../lib/labels";
import type { KitTypeOption, RouteNumberOption } from "../lib/routePickModel";
import type { RouteRef } from "../lib/routeQuery";
import KeyboardHelp from "./KeyboardHelp";

/**
 * The context card (route-fields spec §5.2; artboards 1, 2, 11): <section aria-label="מסלול נבחר">,
 * one row that wraps —
 *   "סוג מארז"     every package type (never an item type: an item's route is reached from its kit,
 *                  in "שלבי המסלול"), by name; the subtitle counts its routes. Picking one opens
 *                  the route the page chooses for it (routeForKitType).
 *   "מספר מסלול"   the routes of that package type, then one number without a route ("חדש —
 *                  ייווצר בשמירה"); the subtitle counts the steps and marks the default.
 *   tags           primary "מארז · {k} סוגי פריטים · {u} יחידות" (from the context's lines) and the
 *                  count "כיסוי {defined}/{relevant}" (mapModel coverage) — each only once known.
 *   actions        ghost "פתח במסך המארזים" → /settings/packages?type={id}; the "?" of the
 *                  keyboard shortcuts.
 * Hidden on the library view (artboard 8) — the page decides.
 */

export type RouteContextCardProps = {
  /** Every package type (kitTypeOptions); null while the lists load. */
  kitTypes: KitTypeOption[] | null;
  /** The route numbers of the chosen package type (routeNumberOptions); [] when none is chosen. */
  routeNumbers: RouteNumberOption[];
  /** The open kit route; null = none. */
  value: RouteRef | null;
  /** A package type was picked. */
  onTypeChange: (typeId: number) => void;
  /** A route number of the chosen package type was picked. */
  onRouteChange: (ref: RouteRef) => void;
  /** The kit's template, from the context's lines; null when not loaded. */
  kit: { kinds: number; units: number } | null;
  /** The map's coverage; null while unknown. */
  coverage: { defined: number; relevant: number } | null;
};

export default function RouteContextCard({
  kitTypes, routeNumbers, value, onTypeChange, onRouteChange, kit, coverage,
}: RouteContextCardProps) {
  const type = value ? kitTypes?.find((t) => t.id === value.type) ?? null : null;
  const route = value ? routeNumbers.find((o) => o.route === value.route) ?? null : null;
  return (
    <section aria-label={CONTEXT_CARD_TEXT.sectionLabel} className="settings-card rf-context-card">
      <div className="rf-context-card__pick">
        <SearchableCombobox<KitTypeOption>
          options={kitTypes ?? []}
          loading={kitTypes == null}
          value={type}
          onChange={(o) => { if (o) onTypeChange(o.id); }}
          getOptionLabel={(o) => o.label}
          getOptionSubtitle={(o) => kitRoutesText(o.routeCount)}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          label={ROUTE_PICK_TEXT.typeLabel}
          placeholder={ROUTE_PICK_TEXT.typePlaceholder}
          dense
          disableClearable
          startIcon={<Package size={18} strokeWidth={1.75} aria-hidden />}
        />
      </div>
      <div className="rf-context-card__pick rf-context-card__pick--route">
        <SearchableCombobox<RouteNumberOption>
          options={routeNumbers}
          value={route}
          onChange={(o) => { if (o && value) onRouteChange({ type: value.type, route: o.route }); }}
          getOptionLabel={(o) => routeNumberText(o.route)}
          getOptionSubtitle={(o) => (o.isNew ? ROUTE_PICK_TEXT.newRoute : routeNumberSubText(o.stations, o.isDefault))}
          isOptionEqualToValue={(a, b) => a.route === b.route}
          label={ROUTE_PICK_TEXT.routeLabel}
          placeholder={ROUTE_PICK_TEXT.routePlaceholder}
          dense
          disableClearable
          disabled={type == null}
        />
      </div>

      {(kit || coverage) && (
        <div className="rf-context-card__tags">
          {kit && <Tag tone="primary" size="md" style={{ fontVariantNumeric: "tabular-nums" }}>{kitSummaryText(kit.kinds, kit.units)}</Tag>}
          {coverage && <span className="settings-count">{coverageText(coverage.defined, coverage.relevant)}</span>}
        </div>
      )}

      <div className="rf-context-card__actions">
        {type && (
          <Button
            variant="text"
            component={Link}
            href={`/settings/packages?type=${type.id}`}
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
