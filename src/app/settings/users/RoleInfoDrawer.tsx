"use client";

// "מה כל תפקיד יכול לעשות" — a side panel on the users page, and the managers' role editor: the
// role's description, how much of the system it reaches, every capability with a switch, and the
// users who hold it. Opened from a role tag in the table or from the link beside the role filter;
// the tabs on top switch roles without closing it.
//
// What a role reaches is its bundle as Keycloak holds it (GET /api/users/role-bundles). A switch
// changes the draft; "שמור" sets the role's whole bundle (PUT /api/users/role-bundles/[role]) for
// everyone holding it. Leaving a role with unsaved changes asks first. Where the bundle cannot be
// read, or the realm has none yet (the migration script has not run), the panel shows the default
// bundle and does not edit. Data: roleCapabilities.ts.

import * as React from "react";
import { createPortal } from "react-dom";
import { Check, Lock, X } from "lucide-react";
import { Button, ConfirmDialog, Switch } from "@/components/ui";
import { ApiError, sendJson } from "@/lib/api/client";
import { APP_ROLES, ROLE_LABEL, permissionByKey, permissionOfRole, type AppRole, type PermissionKey } from "@/lib/auth/roles";
import { LOCKED_IN_BUNDLE } from "@/lib/users/rules";
import { CAPABILITY_GROUPS, ROLE_DESCRIPTION, ROLE_DOT, summarizeRole } from "./roleCapabilities";

type Bundles = Record<AppRole, string[]>;

export type RoleInfoDrawerProps = {
  /** The role on show; null = closed. */
  role: AppRole | null;
  onRoleChange: (role: AppRole) => void;
  onClose: () => void;
  /** Full names of the users per role (the page's loaded list). */
  people: Record<AppRole, string[]>;
  /** Each role's bundle in Keycloak (perm-… roles); null until read. */
  bundles: Bundles | null;
  /** The bundles could not be read: the panel says it shows the defaults. */
  bundlesFailed: boolean;
  /** After a save: every role's bundle as Keycloak now holds it, and the toast. */
  onSaved: (bundles: Bundles, message: string) => void;
  onError: (message: string) => void;
};

const FAILED = "שמירת ההרשאות של התפקיד נכשלה. נסה שוב.";

/** The permission keys of a bundle's perm-… roles (those of the table; any other is ignored). */
const keysOf = (bundle: readonly string[]): Set<PermissionKey> =>
  new Set(bundle.flatMap((name) => permissionOfRole(name)?.key ?? []));

const sameSet = <T,>(a: ReadonlySet<T>, b: ReadonlySet<T>) => a.size === b.size && [...a].every((x) => b.has(x));

export default function RoleInfoDrawer({ role, onRoleChange, onClose, people, bundles, bundlesFailed, onSaved, onError }: RoleInfoDrawerProps) {
  const titleId = React.useId();
  const panelRef = React.useRef<HTMLElement | null>(null);
  const closeRef = React.useRef<HTMLButtonElement | null>(null);
  const open = role != null;
  // The unsaved switches of one role; null = none (the panel shows Keycloak's bundle).
  const [draft, setDraft] = React.useState<{ role: AppRole; keys: Set<PermissionKey> } | null>(null);
  const [saving, setSaving] = React.useState(false);
  // Where the manager asked to go while a draft was unsaved: another role, or out.
  const [leaving, setLeaving] = React.useState<{ to: AppRole | null } | null>(null);

  // Focus the close button on open; give focus back to the opener on close.
  React.useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => opener?.focus?.();
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  const bundle = bundles?.[role] ?? [];
  // Editing needs Keycloak's own bundle: not while it is unread, unreadable, or not a bundle yet.
  const editable = !!bundles && !bundlesFailed && bundle.length > 0;
  const saved = keysOf(bundle);
  const keys = draft?.role === role ? draft.keys : saved;
  const dirty = draft?.role === role && !sameSet(draft.keys, saved);
  const summary = summarizeRole(role, editable ? [...keys].map((k) => permissionByKey(k).role) : bundle);
  // Where the panel's answer comes from, when it is not Keycloak's bundle.
  const source = bundlesFailed
    ? "לא ניתן היה לקרוא את התפקידים מ-Keycloak — מוצגת ברירת המחדל, ואי אפשר לערוך."
    : bundles && bundle.length === 0
      ? "התפקיד עוד לא מוגדר כחבילת הרשאות ב-Keycloak — מוצגת ברירת המחדל עד להרצת סקריפט ההרשאות."
      : null;
  const pct = summary.total ? Math.round((summary.allowed / summary.total) * 100) : 0;
  const members = people[role] ?? [];
  const locked = new Set(LOCKED_IN_BUNDLE[role] ?? []);

  const toggle = (key: PermissionKey, on: boolean) => {
    const next = new Set(keys);
    if (on) next.add(key);
    else next.delete(key);
    setDraft({ role, keys: next });
  };

  /** Go to another role (to) or out (null) — asking first when a draft is unsaved. */
  const leave = (to: AppRole | null) => {
    if (dirty) {
      setLeaving({ to });
      return;
    }
    setDraft(null);
    if (to) onRoleChange(to);
    else onClose();
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await sendJson<{ bundles: Bundles }>(`/api/users/role-bundles/${role}`, "PUT", { perms: [...keys] }, FAILED);
      setDraft(null);
      onSaved(res.bundles, `ההרשאות של ${ROLE_LABEL[role]} נשמרו`);
    } catch (e) {
      onError(e instanceof ApiError ? e.message : FAILED);
    } finally {
      setSaving(false);
    }
  };

  // Escape closes; Tab stays inside the panel (it is modal).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      leave(null);
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

  return (
    <>
      {createPortal(
        <div className="role-drawer" onKeyDown={onKeyDown}>
          <div className="role-drawer__scrim" onClick={() => leave(null)} aria-hidden />
          <aside ref={panelRef} className="role-drawer__panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
            <div className="role-drawer__head">
              <div className="role-drawer__bar">
                <span className="role-drawer__eyebrow">הרשאות לפי תפקיד</span>
                <button ref={closeRef} type="button" className="role-drawer__close" onClick={() => leave(null)} aria-label="סגירה">
                  <X size={18} strokeWidth={2} aria-hidden />
                </button>
              </div>

              <div className="role-drawer__tabs" role="tablist" aria-label="תפקיד">
                {APP_ROLES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    role="tab"
                    aria-selected={r === role}
                    className="role-drawer__tab"
                    onClick={() => r !== role && leave(r)}
                  >
                    {ROLE_LABEL[r]}
                  </button>
                ))}
              </div>

              <div>
                <h2 id={titleId} className="role-drawer__title">
                  <span className="role-dot role-drawer__dot" style={{ background: ROLE_DOT[role] }} aria-hidden />
                  {ROLE_LABEL[role]}
                </h2>
                <p className="role-drawer__desc">{ROLE_DESCRIPTION[role]}</p>
                {source && <p className="role-drawer__desc role-drawer__source">{source}</p>}
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
              {summary.groups.map((g, gi) => (
                <section key={g.title} className="role-drawer__group">
                  <h3 className="role-drawer__group-title">
                    <span>{g.title}</span>
                    <span className="role-drawer__count">
                      {g.allowed}/{g.items.length}
                    </span>
                  </h3>
                  <ul className="role-drawer__list">
                    {g.items.map((it, ii) => {
                      const perm = CAPABILITY_GROUPS[gi].items[ii].perm;
                      if (!editable) {
                        return (
                          <li key={it.label} className={it.ok ? "role-drawer__item role-drawer__item--ok" : "role-drawer__item"}>
                            {it.ok ? (
                              <Check size={16} strokeWidth={2.5} className="role-drawer__icon-ok" aria-hidden />
                            ) : (
                              <Lock size={14} strokeWidth={2} aria-hidden />
                            )}
                            <span>{it.label}</span>
                            {!it.ok && <span className="role-drawer__no">אין גישה</span>}
                          </li>
                        );
                      }
                      const id = `role-perm-${gi}-${ii}`;
                      const isLocked = !perm || locked.has(perm.key);
                      const note = !perm ? "פתוח לכל משתמש מחובר" : locked.has(perm.key) ? "לא ניתן להוריד" : null;
                      return (
                        <li key={it.label} className={it.ok ? "role-drawer__edit role-drawer__edit--on" : "role-drawer__edit"}>
                          <label htmlFor={id} className="role-drawer__edit-label">{it.label}</label>
                          {note && <span className="role-drawer__no">{note}</span>}
                          <Switch
                            id={id}
                            checked={it.ok}
                            disabled={isLocked || saving}
                            onChange={(_e, c) => perm && toggle(perm.key, c)}
                          />
                        </li>
                      );
                    })}
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

            {dirty && (
              <div className="role-drawer__footer">
                <p className="role-drawer__desc">
                  {keys.size === 0
                    ? "תפקיד חייב לכלול לפחות הרשאה אחת."
                    : `השינוי יחול על כל בעלי התפקיד ${ROLE_LABEL[role]} תוך 15 דקות לכל היותר, או מיד כשיתחברו מחדש. הרשאות שהורדו למשתמש מסוים נשארות מורדות.`}
                </p>
                <div className="role-drawer__actions">
                  <Button variant="outlined" color="inherit" onClick={() => setDraft(null)} disabled={saving}>
                    בטל שינויים
                  </Button>
                  <Button variant="contained" onClick={save} loading={saving} disabled={keys.size === 0}>
                    שמור
                  </Button>
                </div>
              </div>
            )}
          </aside>
        </div>,
        document.body,
      )}
      {/* Beside the panel, not inside it: its keys must not reach the panel's Escape. */}
      <ConfirmDialog
        open={!!leaving}
        title="השינויים לא נשמרו"
        message={`השינויים בהרשאות של ${ROLE_LABEL[role]} לא נשמרו. לצאת בלי לשמור?`}
        confirmText="צא בלי לשמור"
        destructive
        onConfirm={() => {
          const to = leaving?.to ?? null;
          setLeaving(null);
          setDraft(null);
          if (to) onRoleChange(to);
          else onClose();
        }}
        onCancel={() => setLeaving(null)}
      />
    </>
  );
}
