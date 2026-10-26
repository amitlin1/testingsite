"use client";
import * as React from "react";
import {
  AlertTriangle, ArrowDown, ArrowUp, Boxes, CheckSquare, ChevronDown, Image as ImageIcon, Info, ListChecks, ListTodo, MessageSquare,
  PackageCheck, PackageOpen, Plus, ScanBarcode, Scale, StickyNote, Tag as TagIcon, Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Checkbox, FormControlLabel, IconButton, MenuItem, Select, TextField } from "@/components/ui";
import { NOTE_MAX_CHOICES } from "@/app/lib/station-fields/schema";
import type { NoteMax } from "@/app/lib/station-fields/schema";
import { TEMPLATE_VARIABLES } from "@/app/lib/popup-templates/schema";
import type {
  ChecklistComponent, ComponentKind, MessageComponent, NotesComponent, PhotoComponent, PopupTemplateConfig, SkuScanComponent, TemplateComponent,
  VerdictComponent, WeightComponent,
} from "@/app/lib/popup-templates/schema";
import { COMPONENT_NAME } from "@/app/lib/popup-templates/labels";
import { TEMPLATE_LIMITS } from "@/app/lib/popup-templates/validate";
import type { TemplateIssue } from "@/app/lib/popup-templates/validate";
import {
  addChecklistRow, addComponent, addStep, canAddKind, isLockedStep, isSystemPart, issuesAt, moveComponent, moveStep, removeChecklistRow,
  removeComponent, removeStep, setChecklistRow, updateComponent, updateStep,
} from "../lib/editorModel";
import type { StepList } from "../lib/editorModel";
import { COMPONENT_SETTINGS_TEXT, EDITOR_TEXT, addKindText, componentSummary } from "../lib/labels";

/**
 * The template's steps and their components (docs/popup-templates/PLAN.md step 1.6): one card per
 * step (title, description, its components, the catalog's "+ …" buttons), one row per component
 * (its name, a summary, move / remove, and its settings when opened). Every issue of the template
 * shows where it is. Pure view over the draft: every edit goes through onChange with a new config.
 *
 * A package template draws it twice: for its steps, and for the opening's item flow (`where`). The
 * package wizards' own parts (contents, items, labels, arrival) show their name and what they do,
 * and stay in their step; the steps of the mandatory ones cannot be removed (PLAN.md §5, step 2.5).
 */

const KIND_ICON: Record<ComponentKind, LucideIcon> = {
  sku_scan: ScanBarcode,
  message: MessageSquare,
  photo: ImageIcon,
  weight: Scale,
  route_fields: ListChecks,
  verdict: CheckSquare,
  checklist: ListTodo,
  notes: StickyNote,
  contents: PackageOpen,
  items: Boxes,
  labels: TagIcon,
  arrival: PackageCheck,
};

export function VariablesHint() {
  return (
    <div className="pt-vars">
      {EDITOR_TEXT.variables}
      {Object.values(TEMPLATE_VARIABLES).map((v) => <code key={v} dir="rtl">{v}</code>)}
    </div>
  );
}

function IssueLines({ issues }: { issues: readonly TemplateIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="pt-issues" role="list">
      {issues.map((i, n) => (
        <li key={`${i.code}-${n}`}><AlertTriangle size={14} strokeWidth={1.9} aria-hidden />{i.message}</li>
      ))}
    </ul>
  );
}

export type StepsEditorProps = {
  cfg: PopupTemplateConfig;
  issues: readonly TemplateIssue[];
  onChange: (next: PopupTemplateConfig) => void;
  /** The list drawn: the template's steps, or the opening's item flow. */
  where?: StepList;
  /** The "הוסף" catalog of this list (editorModel catalogFor). */
  catalog: readonly ComponentKind[];
};

export function StepsEditor({ cfg, issues, onChange, where = "steps", catalog }: StepsEditorProps) {
  const [openId, setOpenId] = React.useState<string | null>(null);
  const steps = where === "steps" ? cfg.steps : cfg.item_flow ?? [];
  const stepName = where === "steps" ? EDITOR_TEXT.step : EDITOR_TEXT.itemPhase;
  return (
    <div className="pt-steps">
      {steps.map((step, si) => (
        <section key={step.id} className="settings-card pt-step" aria-label={stepName(si + 1)}>
          <div className="pt-step__head">
            <span className="pt-step__num" aria-hidden>{si + 1}</span>
            <div className="pt-step__fields">
              <TextField label={EDITOR_TEXT.stepTitle} value={step.title} size="small"
                onChange={(e) => onChange(updateStep(cfg, step.id, { title: e.target.value }))}
                inputProps={{ maxLength: TEMPLATE_LIMITS.stepTitle }} />
              <TextField label={EDITOR_TEXT.stepDesc} value={step.desc} size="small"
                onChange={(e) => onChange(updateStep(cfg, step.id, { desc: e.target.value }))}
                inputProps={{ maxLength: TEMPLATE_LIMITS.stepDesc }} />
            </div>
            <div className="pt-step__actions">
              <IconButton size="small" className="route-step__btn" title={EDITOR_TEXT.moveUp(stepName(si + 1))} disabled={si === 0}
                onClick={() => onChange(moveStep(cfg, step.id, -1))}><ArrowUp size={15} strokeWidth={1.9} aria-hidden /></IconButton>
              <IconButton size="small" className="route-step__btn" title={EDITOR_TEXT.moveDown(stepName(si + 1))} disabled={si === steps.length - 1}
                onClick={() => onChange(moveStep(cfg, step.id, 1))}><ArrowDown size={15} strokeWidth={1.9} aria-hidden /></IconButton>
              <IconButton size="small" className="route-step__btn route-step__btn--danger"
                title={isLockedStep(step) ? EDITOR_TEXT.systemPart : EDITOR_TEXT.remove(stepName(si + 1))} disabled={isLockedStep(step)}
                onClick={() => onChange(removeStep(cfg, step.id))}><Trash2 size={15} strokeWidth={1.9} aria-hidden /></IconButton>
            </div>
          </div>
          <IssueLines issues={issuesAt(issues, { stepId: step.id })} />

          <ol className="pt-comps">
            {step.components.map((c, ci) => {
              const Icon = KIND_ICON[c.kind];
              const name = COMPONENT_NAME[c.kind];
              const open = openId === c.id;
              const first = si === 0 && ci === 0;
              const last = si === steps.length - 1 && ci === step.components.length - 1;
              const compIssues = issuesAt(issues, { stepId: step.id, componentId: c.id });
              // A wizard's own part: shown, never opened or moved; only the labels may be removed.
              const system = isSystemPart(c);
              return (
                <li key={c.id} className="pt-comp" data-invalid={compIssues.length > 0 || undefined}>
                  <div className="pt-comp__row">
                    <span className="pt-comp__icon"><Icon size={17} strokeWidth={1.75} aria-hidden /></span>
                    {system ? (
                      <div className="pt-comp__open pt-comp__open--static">
                        <span className="pt-comp__name">{name}</span>
                        <span className="pt-comp__sub">{componentSummary(c)}</span>
                      </div>
                    ) : (
                      <button type="button" className="pt-comp__open" aria-expanded={open} onClick={() => setOpenId(open ? null : c.id)}
                        aria-label={EDITOR_TEXT.settings(name)}>
                        <span className="pt-comp__name">{name}</span>
                        <span className="pt-comp__sub">{componentSummary(c)}</span>
                        <ChevronDown size={16} strokeWidth={1.75} aria-hidden className="pt-comp__chev" />
                      </button>
                    )}
                    {!system && (
                      <>
                        <IconButton size="small" className="route-step__btn" title={EDITOR_TEXT.moveUp(name)} disabled={first}
                          onClick={() => onChange(moveComponent(cfg, c.id, -1))}><ArrowUp size={15} strokeWidth={1.9} aria-hidden /></IconButton>
                        <IconButton size="small" className="route-step__btn" title={EDITOR_TEXT.moveDown(name)} disabled={last}
                          onClick={() => onChange(moveComponent(cfg, c.id, 1))}><ArrowDown size={15} strokeWidth={1.9} aria-hidden /></IconButton>
                      </>
                    )}
                    {(!system || c.kind === "labels") && (
                      <IconButton size="small" className="route-step__btn route-step__btn--danger" title={EDITOR_TEXT.remove(name)}
                        onClick={() => onChange(removeComponent(cfg, c.id))}><Trash2 size={15} strokeWidth={1.9} aria-hidden /></IconButton>
                    )}
                  </div>
                  <IssueLines issues={compIssues} />
                  {open && !system && (
                    <div className="pt-comp__settings">
                      <ComponentSettings c={c} onPatch={(patch) => onChange(updateComponent(cfg, c.id, patch))} />
                    </div>
                  )}
                </li>
              );
            })}
            {step.components.length === 0 && <li className="pt-comps__empty">{EDITOR_TEXT.stepEmpty}</li>}
          </ol>

          {catalog.some((k) => canAddKind(cfg, k, where, step)) && (
            <div className="pt-add" role="group" aria-label={EDITOR_TEXT.addComponent}>
              <span className="pt-add__label">{EDITOR_TEXT.addComponent}</span>
              {catalog.filter((k) => canAddKind(cfg, k, where, step)).map((k) => (
                <button key={k} type="button" className="pt-add__btn" onClick={() => onChange(addComponent(cfg, step.id, k))}>
                  {addKindText(k)}
                </button>
              ))}
            </div>
          )}
        </section>
      ))}

      <button type="button" className="route-add pt-add-step" onClick={() => onChange(addStep(cfg, undefined, where))} disabled={steps.length >= TEMPLATE_LIMITS.maxSteps}>
        <Plus size={16} strokeWidth={2} aria-hidden />{EDITOR_TEXT.addStep}
      </button>
    </div>
  );
}

type Patch = Record<string, unknown>;

/** The settings of one component, by its kind. */
function ComponentSettings({ c, onPatch }: { c: TemplateComponent; onPatch: (patch: Patch) => void }) {
  const T = COMPONENT_SETTINGS_TEXT;
  const check = (label: string, checked: boolean, key: string) => (
    <FormControlLabel label={label} control={<Checkbox checked={checked} onChange={(_, v) => onPatch({ [key]: v })} />} />
  );
  switch (c.kind) {
    case "sku_scan": {
      const s = c as SkuScanComponent;
      return (
        <div className="pt-set">
          {check(T.required, s.required, "required")}
          {check(T.carryLast, s.carry_last, "carry_last")}
          {check(T.lookupReference, s.lookup_reference, "lookup_reference")}
        </div>
      );
    }
    case "message": {
      const m = c as MessageComponent;
      return (
        <div className="pt-set">
          <TextField label={T.messageText} value={m.text} multiline rows={3} fullWidth
            onChange={(e) => onPatch({ text: e.target.value })} inputProps={{ maxLength: TEMPLATE_LIMITS.message }} />
          <VariablesHint />
        </div>
      );
    }
    case "photo": {
      const p = c as PhotoComponent;
      return (
        <div className="pt-set">
          <div className="pt-set__row">
            <TextField label={T.photoTitle} value={p.title} size="small" onChange={(e) => onPatch({ title: e.target.value })}
              inputProps={{ maxLength: TEMPLATE_LIMITS.photoTitle }} />
            <TextField label={T.photoMin} value={String(p.min)} size="small" helperText={T.photoMinHelp} sx={{ maxWidth: 160 }}
              onChange={(e) => { const n = Number(e.target.value.replace(/\D/g, "") || 0); onPatch({ min: Math.min(n, TEMPLATE_LIMITS.photoMin) }); }}
              inputProps={{ inputMode: "numeric", dir: "ltr", style: { textAlign: "right" } }} />
          </div>
          {check(T.showReference, p.show_reference, "show_reference")}
          <p className="pt-set__note"><Info size={14} strokeWidth={1.9} aria-hidden />{T.photoGroup}</p>
        </div>
      );
    }
    case "weight": {
      const w = c as WeightComponent;
      return (
        <div className="pt-set">
          <TextField label={T.tolerance} value={String(w.tolerance_pct)} size="small" sx={{ maxWidth: 200 }}
            onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onPatch({ tolerance_pct: n }); }}
            inputProps={{ inputMode: "decimal", dir: "ltr", style: { textAlign: "right" } }} />
          {check(T.required, w.required, "required")}
        </div>
      );
    }
    case "route_fields":
      return <p className="pt-set__note"><Info size={14} strokeWidth={1.9} aria-hidden />{T.routeFields}</p>;
    case "checklist": {
      const l = c as ChecklistComponent;
      return (
        <div className="pt-set">
          <TextField label={T.checklistTitle} value={l.title} size="small" sx={{ maxWidth: 360 }} onChange={(e) => onPatch({ title: e.target.value })}
            inputProps={{ maxLength: TEMPLATE_LIMITS.checklistTitle }} />
          <ol className="pt-rows">
            {l.items.map((row, n) => (
              <li key={row.id} className="pt-row">
                <TextField label={T.checklistRow(n + 1)} value={row.label} size="small"
                  onChange={(e) => onPatch({ items: setChecklistRow(l.items, row.id, e.target.value) })} inputProps={{ maxLength: TEMPLATE_LIMITS.checklistLabel }} />
                <IconButton size="small" className="route-step__btn route-step__btn--danger" title={T.removeRow(n + 1)} disabled={l.items.length === 1}
                  onClick={() => onPatch({ items: removeChecklistRow(l.items, row.id) })}><Trash2 size={15} strokeWidth={1.9} aria-hidden /></IconButton>
              </li>
            ))}
          </ol>
          <button type="button" className="pt-add__btn pt-rows__add" disabled={l.items.length >= TEMPLATE_LIMITS.checklistItems}
            onClick={() => onPatch({ items: addChecklistRow(l.items) })}>+ {T.addRow}</button>
        </div>
      );
    }
    case "notes": {
      const n = c as NotesComponent;
      return (
        <div className="pt-set">
          <TextField label={T.notesLabel} value={n.label} size="small" sx={{ maxWidth: 360 }} onChange={(e) => onPatch({ label: e.target.value })}
            inputProps={{ maxLength: TEMPLATE_LIMITS.notesLabel }} />
        </div>
      );
    }
    default:
      // The package wizards' own parts: their settings are the wizards'.
      return null;
    case "verdict": {
      const v = c as VerdictComponent;
      return (
        <div className="pt-set">
          <div className="pt-set__row">
            <TextField label={T.question} value={v.question} size="small" onChange={(e) => onPatch({ question: e.target.value })}
              inputProps={{ maxLength: TEMPLATE_LIMITS.question }} />
            <Select label={T.noteMax} value={v.note_max} size="small" onChange={(e) => onPatch({ note_max: Number(e.target.value) as NoteMax })} sx={{ minWidth: 200 }}>
              {NOTE_MAX_CHOICES.map((n) => <MenuItem key={n} value={n}>{n}</MenuItem>)}
            </Select>
          </div>
        </div>
      );
    }
  }
}
