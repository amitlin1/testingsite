"use client";
import * as React from "react";
import { Link2 } from "lucide-react";
import type { FieldsMapModel } from "../../lib/mapModel";
import { LEGEND_TEXT, MAP_HINT_TEXT, mapFooterText } from "../../lib/labels";

/**
 * The map card's footer (route-fields spec §5.4.5; artboard 1, and artboard 11 for a route that
 * holds no fields of its own): pearl, 12px 18px —
 *   the summary (13/600)  "37 שדות · 5 תאים ללא שדות · שגיאה אחת" / "8 שדות משותפים · 13 תאים ללא שדות";
 *   the legend (12px muted, 14×10 swatches, radius 3);
 *   the hint, at the inline end: artboard 1's keys, or artboard 11's "לחיצה על תא פותחת את עורך השדות".
 *
 * | legend (artboard 1)                       | legend (artboard 11)                       |
 * |-------------------------------------------|--------------------------------------------|
 * | מוגדר                                      | מוגדר                                       |
 * | ללא שדות — … (dashed)                      | ללא שדות — … (divider-soft + hairline)      |
 * | לא במסלול                                  | לא במסלול                                   |
 * | שגיאה                                      | משותף עם מארז אחר (Link2)                   |
 * | שינוי שלא פורסם (dot)                      | עמדה ברמת מארז · כרטיס אחד                  |
 * | עמדה ברמת מארז · כרטיס אחד                 |                                            |
 */

export type FieldsMapFooterProps = {
  model: FieldsMapModel;
};

type LegendEntry = { key: string; swatch: React.ReactNode; text: string };

const swatch = (variant: string) => <span className={`rf-map__swatch rf-map__swatch--${variant}`} aria-hidden="true" />;

export default function FieldsMapFooter({ model }: FieldsMapFooterProps) {
  const onboarding = model.onboarding;
  // On artboard 11 every field on the map is another kit's: "{n} שדות משותפים".
  const summary = mapFooterText({
    fields: model.totals.fields,
    emptyCells: model.totals.emptyCells,
    errors: model.totals.errors,
    sharedOnly: onboarding,
  });
  const legend: LegendEntry[] = onboarding
    ? [
        { key: "defined", swatch: swatch("defined"), text: LEGEND_TEXT.defined },
        { key: "empty", swatch: swatch("empty-quiet"), text: LEGEND_TEXT.empty },
        { key: "na", swatch: swatch("na"), text: LEGEND_TEXT.na },
        { key: "shared", swatch: <Link2 className="rf-map__legend-icon" size={13} strokeWidth={1.75} aria-hidden />, text: LEGEND_TEXT.shared },
        { key: "kit", swatch: swatch("kit"), text: LEGEND_TEXT.kitLevel },
      ]
    : [
        { key: "defined", swatch: swatch("defined"), text: LEGEND_TEXT.defined },
        { key: "empty", swatch: swatch("empty"), text: LEGEND_TEXT.empty },
        { key: "na", swatch: swatch("na"), text: LEGEND_TEXT.na },
        { key: "error", swatch: swatch("error"), text: LEGEND_TEXT.error },
        { key: "unpublished", swatch: swatch("unpublished"), text: LEGEND_TEXT.unpublished },
        { key: "kit", swatch: swatch("kit"), text: LEGEND_TEXT.kitLevel },
      ];
  return (
    <footer className="rf-map__footer">
      {summary !== "" && <span className="rf-map__summary">{summary}</span>}
      <ul className="rf-map__legend">
        {legend.map((e) => (
          <li key={e.key} className="rf-map__legend-item">
            {e.swatch}
            {e.text}
          </li>
        ))}
      </ul>
      <span className="rf-map__hint">{onboarding ? MAP_HINT_TEXT.clickOpens : MAP_HINT_TEXT.keys}</span>
    </footer>
  );
}
