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
  ComponentKind, MessageComponent, PhotoComponent, PopupTemplateConfig, SkuScanComponent, TemplateComponent, VerdictComponent, WeightComponent,
} from "@/app/lib/popup-templates/schema";
import { COMPONENT_NAME } from "@/app/lib/popup-templates/labels";
import { TEMPLATE_LIMITS } from "@/app/lib/popup-templates/validate";
import type { TemplateIssue } from "@/app/lib/popup-templates/validate";
import {
  CATALOG_ORDER, addComponent, addStep, canAddKind, issuesAt, moveComponent, moveStep, removeComponent, removeStep, updateComponent, updateStep,
} from "../lib/editorModel";
import { COMPONENT_SETTINGS_TEXT, EDITOR_TEXT, addKindText, componentSummary } from "../lib/labels";

/**
 * The template's steps and their components (docs/popup-templates/PLAN.md step 1.6): one card per
 * step (title, description, its components, the catalog's "+ …" buttons), one row per component
 * (its name, a summary, move / remove, and its settings when opened). Every issue of the template
 * shows where it is. Pure view over the draft: every edit goes through onChange with a new config.
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
};

export function StepsEditor({ cfg, issues, onChange }: StepsEditorProps) {
  const [openId, setOpenId] = React.useState<string | null>(null);
  return (
    <div className="pt-steps">
      {cfg.steps.map((step, si) => (
        <section key={step.id} className="settings-card pt-step" aria-label={EDITOR_TEXT.step(si + 1)}>
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
              <IconButton size="small" className="route-step__btn" title={EDITOR_TEXT.moveUp(EDITOR_TEXT.step(si + 1))} disabled={si === 0}
                onClick={() => onChange(moveStep(cfg, step.id, -1))}><ArrowUp size={15} strokeWidth={1.9} aria-hidden /></IconButton>
              <IconButton size="small" className="route-step__btn" title={EDITOR_TEXT.moveDown(EDITOR_TEXT.step(si + 1))} disabled={si === cfg.steps.length - 1}
                onClick={() => onChange(moveStep(cfg, step.id, 1))}><ArrowDown size={15} strokeWidth={1.9} aria-hidden /></IconButton>
              <IconButton size="small" className="route-step__btn route-step__btn--danger" title={EDITOR_TEXT.remove(EDITOR_TEXT.step(si + 1))}
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
              const last = si === cfg.steps.length - 1 && ci === step.components.length - 1;
              const compIssues = issuesAt(issues, { stepId: step.id, componentId: c.id });
              return (
                <li key={c.id} className="pt-comp" data-invalid={compIssues.length > 0 || undefined}>
                  <div className="pt-comp__row">
                    <span className="pt-comp__icon"><Icon size={17} strokeWidth={1.75} aria-hidden /></span>
                    <button type="button" className="pt-comp__open" aria-expanded={open} onClick={() => setOpenId(open ? null : c.id)}
                      aria-label={EDITOR_TEXT.settings(name)}>
                      <span className="pt-comp__name">{name}</span>
                      <span className="pt-comp__sub">{componentSummary(c)}</span>
                      <ChevronDown size={16} strokeWidth={1.75} aria-hidden className="pt-comp__chev" />
                    </button>
                    <IconButton size="small" className="route-step__btn" title={EDITOR_TEXT.moveUp(name)} disabled={first}
                      onClick={() => onChange(moveComponent(cfg, c.id, -1))}><ArrowUp size={15} strokeWidth={1.9} aria-hidden /></IconButton>
                    <IconButton size="small" className="route-step__btn" title={EDITOR_TEXT.moveDown(name)} disabled={last}
                      onClick={() => onChange(moveComponent(cfg, c.id, 1))}><ArrowDown size={15} strokeWidth={1.9} aria-hidden /></IconButton>
                    <IconButton size="small" className="route-step__btn route-step__btn--danger" title={EDITOR_TEXT.remove(name)}
                      onClick={() => onChange(removeComponent(cfg, c.id))}><Trash2 size={15} strokeWidth={1.9} aria-hidden /></IconButton>
                  </div>
                  <IssueLines issues={compIssues} />
                  {open && (
                    <div className="pt-comp__settings">
                      <ComponentSettings c={c} onPatch={(patch) => onChange(updateComponent(cfg, c.id, patch))} />
                    </div>
                  )}
                </li>
              );
            })}
            {step.components.length === 0 && <li className="pt-comps__empty">{EDITOR_TEXT.stepEmpty}</li>}
          </ol>

          <div className="pt-add" role="group" aria-label={EDITOR_TEXT.addComponent}>
            <span className="pt-add__label">{EDITOR_TEXT.addComponent}</span>
            {CATALOG_ORDER.filter((k) => canAddKind(cfg, k)).map((k) => (
              <button key={k} type="button" className="pt-add__btn" onClick={() => onChange(addComponent(cfg, step.id, k))}>
                {addKindText(k)}
              </button>
            ))}
          </div>
        </section>
      ))}

      <button type="button" className="route-add pt-add-step" onClick={() => onChange(addStep(cfg))} disabled={cfg.steps.length >= TEMPLATE_LIMITS.maxSteps}>
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
    default:
      // The package base's parts — their settings come with its editor (PLAN.md §5, step 2.5).
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
