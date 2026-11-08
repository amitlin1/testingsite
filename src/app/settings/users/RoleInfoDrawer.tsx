"use client";

// "מה כל תפקיד יכול לעשות" — a side panel on the users page: the role's
// description, how much of the system it reaches, every capability (allowed
// first-class, the rest muted with a lock) and the users who hold it. Opened
// from a role tag in the table or from the link beside the role filter; the
// tabs on top switch roles without closing it. Data: roleCapabilities.ts.

import * as React from "react";
import { createPortal } from "react-dom";
import { Check, Lock, X } from "lucide-react";
import type { AppRole } from "@/lib/auth/roles";
import { ALL_ROLES, ROLE_DESCRIPTION, summarizeRole } from "./roleCapabilities";

export type RoleInfoDrawerProps = {
  /** The role on show; null = closed. */
  role: AppRole | null;
  onRoleChange: (role: AppRole) => void;
  onClose: () => void;
  labels: Record<AppRole, string>;
  dots: Record<AppRole, string>;
  /** Full names of the users per role (the page's loaded list). */
  people: Record<AppRole, string[]>;
};

export default function RoleInfoDrawer({ role, onRoleChange, onClose, labels, dots, people }: RoleInfoDrawerProps) {
  const titleId = React.useId();
  const panelRef = React.useRef<HTMLElement | null>(null);
  const closeRef = React.useRef<HTMLButtonElement | null>(null);
  const open = role != null;

  // Focus the close button on open; give focus back to the opener on close.
  React.useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => opener?.focus?.();
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  const summary = summarizeRole(role);
  const pct = summary.total ? Math.round((summary.allowed / summary.total) * 100) : 0;
  const members = people[role] ?? [];

  // Escape closes; Tab stays inside the panel (it is modal).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !panelRef.current) return;
    const f = panelRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])");
    if (f.length === 0) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  return createPortal(
    <div className="role-drawer" onKeyDown={onKeyDown}>
      <div className="role-drawer__scrim" onClick={onClose} aria-hidden />
      <aside ref={panelRef} className="role-drawer__panel" dir="rtl" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="role-drawer__head">
          <div className="role-drawer__bar">
            <span className="role-drawer__eyebrow">הרשאות לפי תפקיד</span>
            <button ref={closeRef} type="button" className="role-drawer__close" onClick={onClose} aria-label="סגירה">
              <X size={18} strokeWidth={2} aria-hidden />
            </button>
          </div>

          <div className="role-drawer__tabs" role="tablist" aria-label="תפקיד">
            {ALL_ROLES.map((r) => (
              <button
                key={r}
                type="button"
                role="tab"
                aria-selected={r === role}
                className="role-drawer__tab"
                onClick={() => onRoleChange(r)}
              >
                {labels[r]}
              </button>
            ))}
          </div>

          <div>
            <h2 id={titleId} className="role-drawer__title">
              <span className="role-dot role-drawer__dot" style={{ background: dots[role] }} aria-hidden />
              {labels[role]}
            </h2>
            <p className="role-drawer__desc">{ROLE_DESCRIPTION[role]}</p>
          </div>

          <div className="role-drawer__reach">
            <span>
              גישה ל-<b>{summary.allowed}</b> מתוך {summary.total} אפשרויות
            </span>
            <span className="role-drawer__meter" role="img" aria-label={`${pct}%`}>
              <span style={{ width: `${pct}%` }} />
            </span>
          </div>
        </div>

        <div className="role-drawer__body">
          {summary.groups.map((g) => (
            <section key={g.title} className="role-drawer__group">
              <h3 className="role-drawer__group-title">
                <span>{g.title}</span>
                <span className="role-drawer__count">
                  {g.allowed}/{g.items.length}
                </span>
              </h3>
              <ul className="role-drawer__list">
                {g.items.map((it) => (
                  <li key={it.label} className={it.ok ? "role-drawer__item role-drawer__item--ok" : "role-drawer__item"}>
                    {it.ok ? (
                      <Check size={16} strokeWidth={2.5} className="role-drawer__icon-ok" aria-hidden />
                    ) : (
                      <Lock size={14} strokeWidth={2} aria-hidden />
                    )}
                    <span>{it.label}</span>
                    {!it.ok && <span className="role-drawer__no">אין גישה</span>}
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <section className="role-drawer__group role-drawer__people">
            <h3 className="role-drawer__group-title">
              <span>משתמשים בתפקיד הזה</span>
              <span className="role-drawer__count">{members.length}</span>
            </h3>
            {members.length === 0 ? (
              <p className="role-drawer__desc">אין עדיין משתמשים בתפקיד הזה.</p>
            ) : (
              <div className="role-drawer__chips">
                {members.map((name, i) => (
                  <span key={`${name}-${i}`} className="role-drawer__chip">{name}</span>
                ))}
              </div>
            )}
          </section>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
