"use client";

// "הרשאות" of one user: every permission of the role panel with a switch. A permission comes from
// the user's main role (its Keycloak bundle); switching it off takes it away from this user alone
// (their no-… role, roles.ts) — the role and everyone else in it keep it. What the role does not
// give stays off and cannot be switched on here. Data: GET/PUT /api/users/[id]/permissions.

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, DialogTitle, DialogContent, DialogActions, Alert, Switch } from "@/components/ui";
import { ApiError, getJson, sendJson } from "@/lib/api/client";
import { ROLE_LABEL, can, isDenyRole, type AppRole, type PermissionKey } from "@/lib/auth/roles";
import { UNDENIABLE, type AdminUser } from "@/lib/users/rules";
import { CAPABILITY_GROUPS, PERMISSION_SWITCHES } from "./roleCapabilities";

type UserPermissions = { role: AppRole | null; effective: string[]; denied: PermissionKey[] };

const FAILED = "שמירת ההרשאות נכשלה. נסה שוב.";

const queryKey = (id: string) => ["user-permissions", id];

export type UserPermissionsDialogProps = {
  /** The user on show; null = closed. */
  user: AdminUser | null;
  onClose: () => void;
  /** After a save: the toast, and the list's reload (its "removed" marker). */
  onSaved: (message: string) => void;
  onError: (message: string) => void;
};

export default function UserPermissionsDialog({ user, onClose, onSaved, onError }: UserPermissionsDialogProps) {
  const id = user?.id ?? "";
  const query = useQuery({
    queryKey: queryKey(id),
    queryFn: () => getJson<UserPermissions>(`/api/users/${id}/permissions`, "טעינת ההרשאות נכשלה"),
    enabled: !!user,
    // A refetch would start the switches over: read once per opening.
    refetchOnWindowFocus: false,
  });
  const name = user ? user.fullName || user.username : "";

  return (
    <Dialog open={!!user} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>הרשאות של {name}</DialogTitle>
      {query.data && !query.isFetching ? (
        // Keyed by the answer: a fresh read starts the switches over from what Keycloak holds.
        <PermissionsForm key={`${id}:${query.dataUpdatedAt}`} userId={id} data={query.data} onClose={onClose} onSaved={onSaved} onError={onError} />
      ) : (
        <>
          <DialogContent>
            {query.isError && !query.isFetching ? (
              <Alert severity="error">טעינת ההרשאות נכשלה — לא ניתן להתחבר לשרת ההרשאות.</Alert>
            ) : (
              <p className="user-perms__note">טוען…</p>
            )}
          </DialogContent>
          <DialogActions>
            <Button variant="outlined" color="inherit" onClick={onClose}>
              סגור
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}

function PermissionsForm({ userId, data, onClose, onSaved, onError }: {
  userId: string;
  data: UserPermissions;
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [denied, setDenied] = React.useState<Set<PermissionKey>>(() => new Set(data.denied));
  const [saving, setSaving] = React.useState(false);

  // What the role gives: the token's roles without the user's own removals.
  const fromRole = data.effective.filter((r) => !isDenyRole(r));
  const changed = denied.size !== data.denied.length || data.denied.some((k) => !denied.has(k));
  const roleLabel = data.role ? ROLE_LABEL[data.role] : null;

  const toggle = (key: PermissionKey, on: boolean) =>
    setDenied((prev) => {
      const next = new Set(prev);
      if (on) next.delete(key);
      else next.add(key);
      return next;
    });

  const save = async () => {
    setSaving(true);
    try {
      const saved = await sendJson<UserPermissions>(`/api/users/${userId}/permissions`, "PUT", { denied: [...denied] }, FAILED);
      queryClient.setQueryData(queryKey(userId), saved);
      onSaved("ההרשאות נשמרו");
      onClose();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : FAILED);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogContent>
        <div className="user-perms">
          <p className="user-perms__note">
            {roleLabel ? (
              <>
                ההרשאות מגיעות מהתפקיד <b>{roleLabel}</b>. כיבוי מוריד את ההרשאה רק למשתמש הזה; שאר בעלי התפקיד שומרים עליה.
              </>
            ) : (
              <>למשתמש אין תפקיד, ולכן אין לו הרשאות. יש לבחור לו תפקיד בעריכת המשתמש.</>
            )}
          </p>
          {CAPABILITY_GROUPS.map((g) => {
            const switches = PERMISSION_SWITCHES.filter((s) => s.group === g.title);
            if (switches.length === 0) return null;
            return (
              <section key={g.title} className="user-perms__group">
                <h3 className="user-perms__group-title">{g.title}</h3>
                <ul className="user-perms__list">
                  {switches.map(({ perm, labels }) => {
                    const inRole = can(fromRole, perm);
                    const locked = UNDENIABLE.includes(perm.key);
                    const removed = inRole && denied.has(perm.key);
                    const on = inRole && !removed;
                    const id = `user-perm-${perm.key}`;
                    const note = !inRole ? "לא כלול בתפקיד" : locked ? "לא ניתן להוריד" : removed ? "הוסרה למשתמש הזה" : null;
                    return (
                      <li key={perm.key} className={on ? "user-perms__item user-perms__item--on" : "user-perms__item"}>
                        <label htmlFor={id} className="user-perms__label">{labels.join(" · ")}</label>
                        {note && <span className={removed ? "user-perms__state user-perms__state--removed" : "user-perms__state"}>{note}</span>}
                        <Switch id={id} checked={on} disabled={!inRole || locked || saving} onChange={(_e, c) => toggle(perm.key, c)} />
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
          <Alert severity="info">השינוי ייכנס לתוקף אצל המשתמש תוך 15 דקות לכל היותר, או מיד כשיתחבר מחדש.</Alert>
        </div>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" color="inherit" onClick={onClose}>
          ביטול
        </Button>
        <Button variant="contained" onClick={save} loading={saving} disabled={!changed}>
          שמור
        </Button>
      </DialogActions>
    </>
  );
}
