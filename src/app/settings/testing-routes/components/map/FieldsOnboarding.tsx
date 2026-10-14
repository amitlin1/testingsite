"use client";
import * as React from "react";
import { Library, ListChecks, Plus } from "lucide-react";
import { Alert, Button } from "@/components/ui";
import type { FieldsContextJson } from "@/app/lib/station-fields/admin-types";
import type { FieldsMapModel } from "../../lib/mapModel";
import { ONBOARDING_STEPS, ONBOARDING_TEXT, sharedFilledLines } from "../../lib/onboardingLabels";
import "./onboarding.css";

/**
 * A route that holds no fields of its own (route-fields spec §5.12; artboard 11, top) — drawn
 * above the fields map, which stays whole under it. Renders only while `model.onboarding`; null
 * otherwise, so the caller can mount it unconditionally.
 *
 * Top to bottom:
 *   the card — <section aria-labelledby>: white, hairline, radius 16, padding 40, its content
 *     centred in at most 760: ListChecks 34px, the h2 (20/700), the 15px muted line, the
 *     <ol aria-label="שלושה צעדים"> of three pearl tiles (26px blue circle, 14/600 title, 13px line),
 *     and the buttons: primary "התחל בעמדה הראשונה", ghost "החל ערכת שדות…" (only with
 *     `onApplySet`). Artboard 11's outlined "העתק ממסלול אחר…" is left out: its dialog is not drawn
 *     (spec §10.4), like the map toolbar's same button;
 *   the info bar — Alert "info" (role="status", Info, × "סגירה"): "{n} תאים כבר מלאים: {item}
 *     משתמש במסלול {r} שלו, שמוגדר גם ב{kit}." + "פתח את {kit}" (only with `onOpenKit`), while a
 *     line's item route already has fields another kit filled (model.sharedFilled). Closed, it
 *     stays closed for this route while the component is mounted.
 *
 * The root keeps 16px below it: FieldsMap follows it in the map region, which is a block.
 */

export type FieldsOnboardingProps = {
  /** The fields context the model was built from (useFieldsContext "ready"). */
  context: FieldsContextJson;
  /** useFieldsMap(context): the map with every route's working copy. */
  model: FieldsMapModel;
  /** "התחל בעמדה הראשונה" → the cell editor on the first relevant cell (on a kit's map
   *  step=<first kit step>&target=box — relevantCells(model)[0]). The caller navigates. */
  onStart: () => void;
  /** "החל ערכת שדות…" → the apply-set dialog (artboard 9). The button is hidden without it. */
  onApplySet?: () => void;
  /** "פתח את {kit}" in the info bar → that kit's map. The link is hidden without it. */
  onOpenKit?: (packageTypeId: number) => void;
};

export default function FieldsOnboarding({ context, model, onStart, onApplySet, onOpenKit }: FieldsOnboardingProps) {
  const titleId = React.useId();
  const lines = React.useMemo(() => sharedFilledLines(model), [model]);
  // The route the bar was closed on: another route on the same mount shows its own bar again.
  const routeKey = `${context.kind}:${context.subject.item_type_id}:${context.subject.route_number}`;
  const [closedFor, setClosedFor] = React.useState<string | null>(null);

  if (!model.onboarding) return null;
  const showInfo = lines.length > 0 && closedFor !== routeKey;

  return (
    <div className="rf-onb">
      <section aria-labelledby={titleId} className="rf-onb-card">
        <div className="rf-onb-card__inner">
          <div className="rf-onb-card__head">
            <ListChecks className="rf-onb-card__icon" size={34} strokeWidth={1.75} aria-hidden />
            <h2 id={titleId} className="rf-onb-card__title">{ONBOARDING_TEXT.title}</h2>
            <p className="rf-onb-card__text">{ONBOARDING_TEXT.body}</p>
          </div>
          <ol aria-label={ONBOARDING_TEXT.stepsLabel} className="rf-onb-steps">
            {ONBOARDING_STEPS.map((s, i) => (
              <li key={s.title} className="rf-onb-step">
                <span className="rf-onb-step__n">{i + 1}</span>
                <span className="rf-onb-step__text">
                  <span className="rf-onb-step__title">{s.title}</span>
                  <span className="rf-onb-step__line">{s.line}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="rf-onb-card__actions">
            <Button startIcon={<Plus size={18} strokeWidth={1.75} aria-hidden />} onClick={onStart}>
              {ONBOARDING_TEXT.start}
            </Button>
            {onApplySet && (
              <Button variant="text" startIcon={<Library size={18} strokeWidth={1.75} aria-hidden />} onClick={onApplySet}>
                {ONBOARDING_TEXT.applySet}
              </Button>
            )}
          </div>
        </div>
      </section>

      {showInfo && (
        <Alert
          severity="info"
          className="rf-onb-info"
          style={{ alignItems: "center", padding: "6px 14px", minHeight: 46 }}
          onClose={() => setClosedFor(routeKey)}
        >
          <div className="rf-onb-info__lines">
            {lines.map((line) => (
              <div key={line.key} className="rf-onb-info__line">
                <span className="rf-onb-info__text">{line.text}</span>
                {onOpenKit && line.links.map((link) => (
                  <Button
                    key={link.packageTypeId}
                    variant="text"
                    size="small"
                    className="rf-onb-info__link"
                    onClick={() => onOpenKit(link.packageTypeId)}
                  >
                    {link.text}
                  </Button>
                ))}
              </div>
            ))}
          </div>
        </Alert>
      )}
    </div>
  );
}
