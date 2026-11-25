"use client";

// ניהול משתמשים והרשאות — manager-only (guarded by layout.tsx + middleware + the
// manager-gated /api/users route handlers). All Keycloak work happens server-side;
// this page only talks to /api/users.

import * as React from "react";
import {
  Stack,
  Button,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tag,
  StatusPill,
  Checkbox,
  FormControlLabel,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  ConfirmDialog,
  Alert,
  Avatar,
} from "@/components/ui";
import DataTable, { RowActions, IconAction, type Column } from "@/components/DataTable";
import { Pencil, KeyRound, Ban, Power, Trash2, Unlock, Info, HelpCircle, type LucideIcon } from "lucide-react";
import SettingsToolbar from "../components/SettingsToolbar";
import RoleInfoDrawer from "./RoleInfoDrawer";
import { ROLE_DOT } from "./roleCapabilities";
import { ApiError, getJson, sendJson } from "@/lib/api/client";
import { useListQuery } from "@/lib/hooks/useListQuery";
import { useSession } from "next-auth/react";
import { APP_ROLES, ROLE_LABEL, type AppRole } from "@/lib/auth/roles";
import { isSameAccount, type AdminUser, type UserStatus } from "@/lib/users/rules";
import { useSettingsToast } from "../components/useSettingsToast";
import "./users.css";

const STATUS_META: Record<UserStatus, { label: string; dot: string }> = {
  active: { label: "פעיל", dot: "var(--color-status-approved)" },
  disabled: { label: "מושבת", dot: "var(--color-ink-muted-48)" },
  locked: { label: "נעול", dot: "var(--color-destructive)" },
  pending: { label: "ממתין לשינוי סיסמה", dot: "var(--color-status-late)" },
};

/** The one status action of a row: a disabled user is enabled, a locked one unlocked (re-enabling
 *  clears the brute-force lock server side), anyone else disabled. */
type StatusAction = {
  enable: boolean;
  label: string;
  icon: LucideIcon;
  title: string;
  message: (name: string | undefined) => string;
  done: string;
};
const DISABLE: StatusAction = {
  enable: false,
  label: "השבת",
  icon: Ban,
  title: "השבתת משתמש",
  message: (name) => `להשבית את "${name}"? המשתמש לא יוכל להתחבר עד להפעלה מחדש.`,
  done: "המשתמש הושבת",
};
const STATUS_ACTION: Record<UserStatus, StatusAction> = {
  disabled: {
    enable: true,
    label: "הפעל",
    icon: Power,
    title: "הפעלת משתמש",
    message: (name) => `להפעיל מחדש את "${name}"? המשתמש יוכל להתחבר.`,
    done: "המשתמש הופעל",
  },
  locked: {
    enable: true,
    label: "שחרר נעילה",
    icon: Unlock,
    title: "שחרור נעילה",
    message: (name) => `לשחרר את הנעילה של "${name}"? המשתמש יוכל להתחבר שוב.`,
    done: "הנעילה שוחררה",
  },
  active: DISABLE,
  pending: DISABLE,
};

function RoleTag({ role, onInfo }: { role: AppRole; onInfo?: () => void }) {
  const tag = (
    <Tag tone="neutral" size="md" icon={<span className="role-dot" style={{ background: ROLE_DOT[role] }} aria-hidden />}>
      {ROLE_LABEL[role]}
      {onInfo && <Info size={13} strokeWidth={2} className="role-tag-btn__info" aria-hidden />}
    </Tag>
  );
  if (!onInfo) return tag;
  // The tag opens the role panel (RoleInfoDrawer): what this role may do.
  return (
    <button type="button" className="role-tag-btn" onClick={onInfo} aria-label={`${ROLE_LABEL[role]} — מה התפקיד יכול לעשות`} title="מה התפקיד יכול לעשות">
      {tag}
    </button>
  );
}

// Codes typed left-to-right but aligned with the Hebrew labels; the password
// in a monospace face so 0/O and l/I read apart.
const LTR_INPUT = { dir: "ltr", style: { textAlign: "right" as const } };
const PASSWORD_INPUT = { dir: "ltr", style: { textAlign: "right" as const, fontFamily: "var(--font-mono)" } };

function initials(u: AdminUser): string {
  const two = (u.firstName?.[0] ?? "") + (u.lastName?.[0] ?? "");
  return (two || u.username.slice(0, 2)).toUpperCase();
}

function formatDate(ts: number | null): string {
  return ts ? new Date(ts).toLocaleDateString("he-IL") : "—";
}

// Temp password: 10 chars, guaranteed upper + lower + digit (no ambiguous chars).
function generatePassword(): string {
  const U = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const L = "abcdefghijkmnpqrstuvwxyz";
  const D = "23456789";
  const all = U + L + D;
  // Cryptographically-random index (browser crypto — this is a client component).
  const rnd = (n: number) => {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] % n;
  };
  const pick = (s: string) => s[rnd(s.length)];
  const chars = [pick(U), pick(L), pick(D)];
  for (let i = 0; i < 7; i++) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

type FormState = {
  username: string;
  firstName: string;
  lastName: string;
  employeeNumber: string;
  role: AppRole;
  temporaryPassword: string;
  mustChange: boolean;
};
const emptyForm: FormState = {
  username: "",
  firstName: "",
  lastName: "",
  employeeNumber: "",
  role: "tester",
  temporaryPassword: "",
  mustChange: true,
};

const FAILED = "הפעולה נכשלה. נסה שוב.";

async function readUsers(): Promise<AdminUser[]> {
  return (await getJson<{ users?: AdminUser[] }>("/api/users")).users ?? [];
}

export default function UsersPage() {
  // Your own account: the API blocks self-demote/disable/delete (lockout guard);
  // reflect that in the UI so the action is disabled rather than failing.
  const { data: session } = useSession();
  const currentUsername = session?.user?.preferredUsername;
  const isSelf = (u: AdminUser) => isSameAccount(u.username, currentUsername);

  const { rows: users, loading, failed, reload: load } = useListQuery<AdminUser>(["users"], readUsers);
  const phase: "loading" | "ready" | "error" = failed ? "error" : loading ? "loading" : "ready";
  const [search, setSearch] = React.useState("");
  const [roleFilter, setRoleFilter] = React.useState<"all" | AppRole>("all");
  // The role panel ("מה כל תפקיד יכול לעשות"); null = closed.
  const [infoRole, setInfoRole] = React.useState<AppRole | null>(null);

  const notify = useSettingsToast({ duration: 5000 });

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<AdminUser | null>(null);
  const [form, setForm] = React.useState<FormState>(emptyForm);
  // Validation is shown on the field, not in a toast.
  const [formErrors, setFormErrors] = React.useState<{ username?: string; temporaryPassword?: string }>({});
  const [saving, setSaving] = React.useState(false);

  const [resetTarget, setResetTarget] = React.useState<AdminUser | null>(null);
  const [resetPwd, setResetPwd] = React.useState("");
  const [resetError, setResetError] = React.useState("");
  const [toggleTarget, setToggleTarget] = React.useState<AdminUser | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<AdminUser | null>(null);
  // Shared in-flight guard for the reset/toggle/delete dialogs (prevents a
  // double-click firing duplicate requests).
  const [busy, setBusy] = React.useState(false);

  const filtered = users.filter((u) => {
    if (roleFilter !== "all" && u.role !== roleFilter) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      u.fullName.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      (u.employeeNumber ?? "").toLowerCase().includes(q)
    );
  });

  const peopleByRole = Object.fromEntries(APP_ROLES.map((r) => [r, [] as string[]])) as Record<AppRole, string[]>;
  for (const u of users) if (u.role) peopleByRole[u.role].push(u.fullName || u.username);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm, temporaryPassword: generatePassword() });
    setFormErrors({});
    setFormOpen(true);
  };
  const openEdit = (u: AdminUser) => {
    setEditing(u);
    setForm({
      username: u.username,
      firstName: u.firstName,
      lastName: u.lastName,
      employeeNumber: u.employeeNumber ?? "",
      role: u.role ?? "tester",
      temporaryPassword: "",
      mustChange: true,
    });
    setFormErrors({});
    setFormOpen(true);
  };

  const submitForm = async () => {
    const errors: { username?: string; temporaryPassword?: string } = {};
    if (!form.username.trim()) errors.username = "יש להזין שם משתמש";
    if (!editing && !form.temporaryPassword) errors.temporaryPassword = "יש להזין סיסמה זמנית";
    setFormErrors(errors);
    if (errors.username || errors.temporaryPassword) return;
    setSaving(true);
    try {
      if (editing) {
        await sendJson(`/api/users/${editing.id}`, "PUT", {
          firstName: form.firstName,
          lastName: form.lastName,
          employeeNumber: form.employeeNumber,
          role: form.role,
        }, FAILED);
      } else {
        await sendJson("/api/users", "POST", {
          username: form.username,
          firstName: form.firstName,
          lastName: form.lastName,
          employeeNumber: form.employeeNumber,
          role: form.role,
          temporaryPassword: form.temporaryPassword,
          mustChangePassword: form.mustChange,
        }, FAILED);
      }
      notify(editing ? "השינויים נשמרו" : "המשתמש נוצר");
      setFormOpen(false);
      await load();
    } catch (e) {
      notify(e instanceof ApiError ? e.message : FAILED, "error");
      // Surface any partial state (e.g. a create that failed after the user row
      // was written) by reloading the list.
      await load();
    } finally {
      setSaving(false);
    }
  };

  const submitReset = async () => {
    if (!resetTarget) return;
    if (!resetPwd) { setResetError("יש להזין סיסמה זמנית"); return; }
    setBusy(true);
    try {
      await sendJson(`/api/users/${resetTarget.id}/reset-password`, "PUT", { password: resetPwd }, FAILED);
      notify("סיסמה זמנית הוגדרה");
      setResetTarget(null);
      await load();
    } catch (e) {
      notify(e instanceof ApiError ? e.message : FAILED, "error");
    } finally {
      setBusy(false);
    }
  };

  const submitToggle = async () => {
    if (!toggleTarget) return;
    const action = STATUS_ACTION[toggleTarget.status];
    setBusy(true);
    try {
      await sendJson(`/api/users/${toggleTarget.id}`, "PUT", { enabled: action.enable }, FAILED);
      notify(action.done);
      setToggleTarget(null);
      await load();
    } catch (e) {
      notify(e instanceof ApiError ? e.message : FAILED, "error");
    } finally {
      setBusy(false);
    }
  };

  const submitDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await sendJson(`/api/users/${deleteTarget.id}`, "DELETE", undefined, FAILED);
      notify("המשתמש נמחק");
      setDeleteTarget(null);
      await load();
    } catch (e) {
      notify(e instanceof ApiError ? e.message : FAILED, "error");
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<AdminUser>[] = [
    {
      key: "fullName",
      header: "שם מלא",
      nowrap: true,
      cell: (u) => (
        <Stack direction="row" sx={{ alignItems: "center", gap: 1.25 }}>
          {/* Neutral initials: blue is for actions and selection, not decoration. */}
          <Avatar aria-hidden sx={{ width: 32, height: 32, fontSize: "var(--text-small)", fontWeight: 600, bgcolor: "var(--color-canvas-parchment)", color: "var(--color-ink-muted-70)" }}>
            {initials(u)}
          </Avatar>
          <span style={{ fontWeight: 600 }}>{u.fullName}</span>
        </Stack>
      ),
    },
    {
      key: "username",
      header: "שם משתמש",
      nowrap: true,
      cell: (u) => <bdi dir="ltr" style={{ color: "var(--color-ink-muted-48)" }}>{u.username}</bdi>,
    },
    { key: "employeeNumber", header: "מספר עובד", nums: true, muted: true, cell: (u) => u.employeeNumber ?? "—" },
    {
      key: "role",
      header: "תפקיד",
      cell: (u) =>
        u.role ? <RoleTag role={u.role} onInfo={() => setInfoRole(u.role)} /> : <span style={{ color: "var(--color-ink-muted-48)" }}>—</span>,
    },
    {
      key: "status",
      header: "סטטוס",
      cell: (u) => <StatusPill label={STATUS_META[u.status].label} dotColor={STATUS_META[u.status].dot} />,
    },
    { key: "createdTimestamp", header: "נוצר בתאריך", nums: true, muted: true, nowrap: true, cell: (u) => formatDate(u.createdTimestamp) },
    {
      key: "__actions",
      header: "פעולות",
      align: "center",
      width: 170,
      cell: (u) => {
        const action = STATUS_ACTION[u.status];
        return (
        <RowActions>
          <IconAction title={`ערוך את ${u.fullName || u.username}`} onClick={() => openEdit(u)}>
            <Pencil size={16} strokeWidth={1.75} />
          </IconAction>
          <IconAction title={`איפוס סיסמה ל${u.fullName || u.username}`} onClick={() => { setResetTarget(u); setResetPwd(generatePassword()); setResetError(""); }}>
            <KeyRound size={16} strokeWidth={1.75} />
          </IconAction>
          <IconAction
            title={isSelf(u) ? "לא ניתן לפעול על החשבון שלך" : action.label}
            disabled={isSelf(u)}
            onClick={() => setToggleTarget(u)}
          >
            <action.icon size={16} strokeWidth={1.75} />
          </IconAction>
          <IconAction
            title={isSelf(u) ? "לא ניתן לפעול על החשבון שלך" : "מחק"}
            danger
            disabled={isSelf(u)}
            onClick={() => setDeleteTarget(u)}
          >
            <Trash2 size={16} strokeWidth={1.75} />
          </IconAction>
        </RowActions>
        );
      },
    },
  ];

  // Static counts over ALL users: the role filter is the toggle group above
  // (one control for one job), so the cards only report.
  const kpiCards: { key: "all" | AppRole; label: string; dot: string | null; count: number }[] = [
    { key: "all", label: "סה״כ משתמשים", dot: null, count: users.length },
    ...APP_ROLES.map((r) => ({ key: r, label: ROLE_LABEL[r], dot: ROLE_DOT[r], count: peopleByRole[r].length })),
  ];
  const ready = phase === "ready";
  const toggleAction = STATUS_ACTION[toggleTarget?.status ?? "active"];

  // A table page: it fills the settings frame and scrolls its table inside.
  return (
    <div className="settings-fill">
      <SettingsToolbar
        title="ניהול משתמשים"
        subtitle="ניהול חשבונות, תפקידים והרשאות. מנוהל מול Keycloak."
        // No count while it is unknown — never a "0" that is not true.
        count={ready ? users.length : undefined}
        countLabel="משתמשים"
        onAdd={openCreate}
        addLabel="משתמש חדש"
        search={search}
        onSearch={setSearch}
        searchPlaceholder="חיפוש לפי שם או שם משתמש"
      >
        <ToggleButtonGroup
          value={roleFilter}
          exclusive
          role="group"
          aria-label="סינון לפי תפקיד"
          onChange={(_e, v) => v && setRoleFilter(v as "all" | AppRole)}
        >
          <ToggleButton value="all">הכל</ToggleButton>
          {APP_ROLES.map((r) => (
            <ToggleButton key={r} value={r}>{ROLE_LABEL[r]}</ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Button
          variant="text"
          startIcon={<HelpCircle size={18} strokeWidth={1.75} aria-hidden />}
          onClick={() => setInfoRole(roleFilter === "all" ? "manager" : roleFilter)}
        >
          מה כל תפקיד יכול לעשות?
        </Button>
      </SettingsToolbar>

      {/* KPI strip — counts per role ("—" until they are known) */}
      <div className="users-kpis">
        {kpiCards.map((c) => (
          <div key={c.key} className="users-kpi">
            <Stack direction="row" sx={{ alignItems: "center", gap: 0.75 }}>
              {c.dot && <span className="role-dot" style={{ background: c.dot }} aria-hidden />}
              <span style={{ fontSize: "var(--text-small)", color: "var(--color-ink-muted-48)" }}>{c.label}</span>
            </Stack>
            <div className="users-kpi__value">{ready ? c.count : "—"}</div>
            <div style={{ fontSize: "var(--text-fine)", color: "var(--color-ink-muted-48)" }}>{ready && c.count === 1 ? "משתמש" : "משתמשים"}</div>
          </div>
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        {phase === "error" ? (
          <div className="settings-card settings-error">
            <Alert severity="error">טעינת המשתמשים נכשלה — לא ניתן להתחבר לשרת ההרשאות.</Alert>
            <Button variant="outlined" color="inherit" onClick={() => load()}>
              נסה שוב
            </Button>
          </div>
        ) : (
          <DataTable<AdminUser>
            columns={columns}
            rows={filtered}
            getRowKey={(u) => u.id}
            loading={phase === "loading"}
            minWidth={960}
            maxHeight="100%"
            empty={
              search || roleFilter !== "all" ? (
                <div className="settings-empty settings-empty--bare">
                  <div className="settings-empty__title">לא נמצאו משתמשים</div>
                  <div>אין תוצאות התואמות את החיפוש או הסינון.</div>
                  <Button variant="outlined" color="inherit" size="small" onClick={() => { setSearch(""); setRoleFilter("all"); }}>
                    נקה חיפוש וסינון
                  </Button>
                </div>
              ) : (
                <div className="settings-empty settings-empty--bare">
                  <div className="settings-empty__title">עדיין אין משתמשים</div>
                  <div>התחל בהוספת המשתמש הראשון.</div>
                </div>
              )
            }
          />
        )}
      </div>

      <Dialog open={formOpen} onClose={() => setFormOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? "עריכת משתמש" : "משתמש חדש"}</DialogTitle>
        <DialogContent>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
            <TextField
              label="שם משתמש"
              value={form.username}
              onChange={(e) => { setForm({ ...form, username: e.target.value }); if (formErrors.username) setFormErrors((x) => ({ ...x, username: undefined })); }}
              fullWidth
              disabled={!!editing}
              required
              error={!!formErrors.username}
              helperText={formErrors.username ?? (editing ? "שם המשתמש אינו ניתן לשינוי לאחר היצירה." : undefined)}
              inputProps={LTR_INPUT}
              autoComplete="off"
            />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--space-md)" }}>
              <TextField label="שם פרטי" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} fullWidth />
              <TextField label="שם משפחה" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} fullWidth />
            </div>
            <TextField
              label="מספר עובד"
              value={form.employeeNumber}
              onChange={(e) => setForm({ ...form, employeeNumber: e.target.value })}
              fullWidth
              inputProps={LTR_INPUT}
            />
            <div>
              <div id="user-role-label" className="sh-field-label">תפקיד</div>
              <ToggleButtonGroup
                value={form.role}
                exclusive
                role="group"
                aria-labelledby="user-role-label"
                disabled={!!editing && isSelf(editing)}
                onChange={(_e, v) => v && setForm({ ...form, role: v as AppRole })}
              >
                {APP_ROLES.map((r) => (
                  <ToggleButton key={r} value={r}>{ROLE_LABEL[r]}</ToggleButton>
                ))}
              </ToggleButtonGroup>
              {!!editing && isSelf(editing) && (
                <div className="sh-field-helper">לא ניתן לשנות את התפקיד של החשבון שאיתו אתה מחובר.</div>
              )}
            </div>
            {!editing && (
              <>
                <div>
                <label htmlFor="user-temp-password" className="sh-field-label">סיסמה זמנית *</label>
                <Stack direction="row" sx={{ gap: 1, alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <TextField
                      id="user-temp-password"
                      required
                      value={form.temporaryPassword}
                      onChange={(e) => { setForm({ ...form, temporaryPassword: e.target.value }); if (formErrors.temporaryPassword) setFormErrors((x) => ({ ...x, temporaryPassword: undefined })); }}
                      fullWidth
                      error={!!formErrors.temporaryPassword}
                      helperText={formErrors.temporaryPassword}
                      inputProps={PASSWORD_INPUT}
                      autoComplete="off"
                    />
                  </div>
                  <Button variant="outlined" color="inherit" onClick={() => setForm({ ...form, temporaryPassword: generatePassword() })}>
                    חולל
                  </Button>
                </Stack>
                </div>
                <FormControlLabel
                  control={
                    <Checkbox checked={form.mustChange} onChange={(e) => setForm({ ...form, mustChange: e.target.checked })} />
                  }
                  label="חייב להחליף סיסמה בכניסה הבאה"
                />
              </>
            )}
          </div>
        </DialogContent>
        {/* Cancel first, the action last (DialogActions puts it at the end). */}
        <DialogActions>
          <Button variant="outlined" color="inherit" onClick={() => setFormOpen(false)}>
            ביטול
          </Button>
          <Button variant="contained" onClick={submitForm} loading={saving}>
            {editing ? "שמור" : "צור משתמש"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!resetTarget} onClose={() => setResetTarget(null)} maxWidth="sm" fullWidth>
        <DialogTitle>איפוס סיסמה</DialogTitle>
        <DialogContent>
          <DialogContentText>
            הגדרת סיסמה זמנית ל<strong>{resetTarget?.fullName}</strong>.
          </DialogContentText>
          <label htmlFor="user-reset-password" className="sh-field-label" style={{ marginTop: "var(--space-md)" }}>סיסמה זמנית</label>
          <Stack direction="row" sx={{ gap: 1, alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <TextField
                id="user-reset-password"
                value={resetPwd}
                onChange={(e) => { setResetPwd(e.target.value); if (resetError) setResetError(""); }}
                fullWidth
                error={!!resetError}
                helperText={resetError}
                inputProps={PASSWORD_INPUT}
                autoComplete="off"
              />
            </div>
            <Button variant="outlined" color="inherit" onClick={() => { setResetPwd(generatePassword()); setResetError(""); }}>
              חולל
            </Button>
          </Stack>
          <Alert severity="info" sx={{ mt: 2 }}>
            המשתמש יתבקש להחליף סיסמה בכניסה הבאה.
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" color="inherit" onClick={() => setResetTarget(null)}>
            ביטול
          </Button>
          <Button variant="contained" onClick={submitReset} loading={busy}>
            אפס סיסמה
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!toggleTarget}
        title={toggleAction.title}
        message={toggleAction.message(toggleTarget?.fullName)}
        confirmText={toggleAction.label}
        busy={busy}
        onConfirm={submitToggle}
        onCancel={() => setToggleTarget(null)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="מחיקת משתמש"
        message={deleteTarget ? `למחוק את המשתמש "${deleteTarget.fullName || deleteTarget.username}"? פעולה זו אינה ניתנת לביטול.` : ""}
        confirmText="מחק משתמש"
        destructive
        busy={busy}
        onConfirm={submitDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <RoleInfoDrawer
        role={infoRole}
        onRoleChange={setInfoRole}
        onClose={() => setInfoRole(null)}
        people={peopleByRole}
      />
    </div>
  );
}
