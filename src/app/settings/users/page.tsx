"use client";

// ניהול משתמשים והרשאות — manager-only (guarded by layout.tsx + middleware + the
// manager-gated /api/users route handlers). All Keycloak work happens server-side;
// this page only talks to /api/users via apiFetch. Every element maps to a real
// Shifthouse primitive (SettingsToolbar · DataTable + RowActions/IconAction · Chip
// · StatusPill · Dialog · ToggleButtonGroup · Snackbar/Alert).

import * as React from "react";
import {
  Box,
  Stack,
  Typography,
  Button,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Chip,
  StatusPill,
  Checkbox,
  FormControlLabel,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Alert,
  Snackbar,
  Avatar,
} from "@/components/ui";
import DataTable, { RowActions, IconAction, type Column } from "@/components/DataTable";
import { Pencil, KeyRound, Ban, Power, Trash2, Unlock } from "lucide-react";
import SettingsToolbar from "../components/SettingsToolbar";
import { apiFetch } from "@/lib/api/client";
import { useSession } from "next-auth/react";

// ---- types (shape returned by GET /api/users) ----
type Role = "manager" | "tester" | "storekeeper";
type UserStatus = "active" | "disabled" | "locked" | "pending";
interface AdminUser {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  fullName: string;
  employeeNumber: string | null;
  enabled: boolean;
  createdTimestamp: number | null;
  role: Role | null;
  status: UserStatus;
}

// ---- display maps ----
const ROLE_LABEL: Record<Role, string> = { manager: "מנהל", tester: "בודק", storekeeper: "מחסנאי" };
const ROLE_CHIP: Record<Role, "primary" | "success" | "warning"> = {
  manager: "primary",
  tester: "success",
  storekeeper: "warning",
};
const STATUS_META: Record<UserStatus, { label: string; dot: string }> = {
  active: { label: "פעיל", dot: "var(--color-status-approved)" },
  disabled: { label: "מושבת", dot: "var(--color-ink-muted-48)" },
  locked: { label: "נעול", dot: "var(--color-destructive)" },
  pending: { label: "ממתין לשינוי סיסמה", dot: "var(--color-status-late)" },
};

const ROLE_DOT: Record<Role, string> = {
  manager: "var(--color-primary)",
  tester: "var(--color-status-approved)",
  storekeeper: "var(--color-status-late)",
};

function initials(u: AdminUser): string {
  const two = (u.firstName?.[0] ?? "") + (u.lastName?.[0] ?? "");
  return (two || u.username.slice(0, 2)).toUpperCase();
}

function formatDate(ts: number | null): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleDateString("he-IL");
  } catch {
    return "—";
  }
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
  role: Role;
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

export default function UsersPage() {
  // Your own account: the API blocks self-demote/disable/delete (lockout guard);
  // reflect that in the UI so the action is disabled rather than failing.
  const { data: session } = useSession();
  const currentUsername = session?.user?.preferredUsername;
  const isSelf = (u: AdminUser) => !!currentUsername && u.username === currentUsername;

  const [users, setUsers] = React.useState<AdminUser[]>([]);
  const [phase, setPhase] = React.useState<"loading" | "ready" | "error">("loading");
  const [search, setSearch] = React.useState("");
  const [roleFilter, setRoleFilter] = React.useState<"all" | Role>("all");

  const [toast, setToast] = React.useState<{ open: boolean; msg: string; sev: "success" | "error" }>({
    open: false,
    msg: "",
    sev: "success",
  });
  const notify = (msg: string, sev: "success" | "error" = "success") => setToast({ open: true, msg, sev });

  // dialog state
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<AdminUser | null>(null);
  const [form, setForm] = React.useState<FormState>(emptyForm);
  const [saving, setSaving] = React.useState(false);

  const [resetTarget, setResetTarget] = React.useState<AdminUser | null>(null);
  const [resetPwd, setResetPwd] = React.useState("");
  const [toggleTarget, setToggleTarget] = React.useState<AdminUser | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<AdminUser | null>(null);
  // Shared in-flight guard for the reset/toggle/delete dialogs (prevents a
  // double-click firing duplicate requests).
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setPhase("loading");
    try {
      const res = await apiFetch("/api/users");
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { users: AdminUser[] };
      setUsers(data.users ?? []);
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  // ---- filtering ----
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

  // ---- KPI counts (over ALL users) ----
  const counts = {
    all: users.length,
    manager: users.filter((u) => u.role === "manager").length,
    tester: users.filter((u) => u.role === "tester").length,
    storekeeper: users.filter((u) => u.role === "storekeeper").length,
  };

  // ---- actions ----
  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm, temporaryPassword: generatePassword() });
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
    setFormOpen(true);
  };

  const submitForm = async () => {
    if (!form.username.trim()) return notify("יש להזין שם משתמש", "error");
    if (!editing && !form.temporaryPassword) return notify("יש להזין סיסמה זמנית", "error");
    setSaving(true);
    try {
      const res = editing
        ? await apiFetch(`/api/users/${editing.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              firstName: form.firstName,
              lastName: form.lastName,
              employeeNumber: form.employeeNumber,
              role: form.role,
            }),
          })
        : await apiFetch("/api/users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username: form.username,
              firstName: form.firstName,
              lastName: form.lastName,
              employeeNumber: form.employeeNumber,
              role: form.role,
              temporaryPassword: form.temporaryPassword,
              mustChangePassword: form.mustChange,
            }),
          });
      if (!res.ok) {
        const e = await res.json().catch(() => null);
        throw new Error(e?.error);
      }
      notify(editing ? "השינויים נשמרו" : "המשתמש נוצר");
      setFormOpen(false);
      await load();
    } catch (e) {
      notify((e as Error).message || "הפעולה נכשלה. נסה שוב.", "error");
      // Surface any partial state (e.g. a create that failed after the user row
      // was written) by reloading the list.
      await load();
    } finally {
      setSaving(false);
    }
  };

  const submitReset = async () => {
    if (!resetTarget) return;
    if (!resetPwd) return notify("יש להזין סיסמה זמנית", "error");
    setBusy(true);
    try {
      const res = await apiFetch(`/api/users/${resetTarget.id}/reset-password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: resetPwd }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => null);
        throw new Error(e?.error);
      }
      notify("סיסמה זמנית הוגדרה");
      setResetTarget(null);
      await load();
    } catch (e) {
      notify((e as Error).message || "הפעולה נכשלה. נסה שוב.", "error");
    } finally {
      setBusy(false);
    }
  };

  const submitToggle = async () => {
    if (!toggleTarget) return;
    const wasLocked = toggleTarget.status === "locked";
    // Disabled → enable; locked → re-enable (clears the brute-force lock server
    // side); otherwise → disable.
    const enable = toggleTarget.status === "disabled" || wasLocked;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/users/${toggleTarget.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: enable }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => null);
        throw new Error(e?.error);
      }
      notify(wasLocked ? "הנעילה שוחררה" : enable ? "המשתמש הופעל" : "המשתמש הושבת");
      setToggleTarget(null);
      await load();
    } catch (e) {
      notify((e as Error).message || "הפעולה נכשלה. נסה שוב.", "error");
    } finally {
      setBusy(false);
    }
  };

  const submitDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/users/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) {
        const e = await res.json().catch(() => null);
        throw new Error(e?.error);
      }
      notify("המשתמש נמחק");
      setDeleteTarget(null);
      await load();
    } catch (e) {
      notify((e as Error).message || "הפעולה נכשלה. נסה שוב.", "error");
    } finally {
      setBusy(false);
    }
  };

  // ---- columns ----
  const columns: Column<AdminUser>[] = [
    {
      key: "fullName",
      header: "שם מלא",
      nowrap: true,
      cell: (u) => (
        <Stack direction="row" sx={{ alignItems: "center", gap: 1.25 }}>
          <Avatar sx={{ width: 32, height: 32, fontSize: 13, fontWeight: 600, bgcolor: "rgba(0,102,204,.10)", color: "var(--color-primary)" }}>
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
      cell: (u) => <span style={{ direction: "ltr", unicodeBidi: "plaintext", color: "#7a7a7a" }}>{u.username}</span>,
    },
    { key: "employeeNumber", header: "מספר עובד", nums: true, muted: true, cell: (u) => u.employeeNumber ?? "—" },
    {
      key: "role",
      header: "תפקיד",
      cell: (u) =>
        u.role ? <Chip size="small" color={ROLE_CHIP[u.role]} label={ROLE_LABEL[u.role]} /> : <span style={{ color: "#9a9aa0" }}>—</span>,
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
      cell: (u) => (
        <RowActions>
          <IconAction title="ערוך" onClick={() => openEdit(u)}>
            <Pencil size={16} strokeWidth={1.75} />
          </IconAction>
          <IconAction title="איפוס סיסמה" onClick={() => { setResetTarget(u); setResetPwd(generatePassword()); }}>
            <KeyRound size={16} strokeWidth={1.75} />
          </IconAction>
          <IconAction
            title={
              isSelf(u)
                ? "לא ניתן לפעול על החשבון שלך"
                : u.status === "disabled"
                  ? "הפעל"
                  : u.status === "locked"
                    ? "שחרר נעילה"
                    : "השבת"
            }
            disabled={isSelf(u)}
            onClick={() => setToggleTarget(u)}
          >
            {u.status === "disabled" ? (
              <Power size={16} strokeWidth={1.75} />
            ) : u.status === "locked" ? (
              <Unlock size={16} strokeWidth={1.75} />
            ) : (
              <Ban size={16} strokeWidth={1.75} />
            )}
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
      ),
    },
  ];

  const kpiCards: { key: "all" | Role; label: string; dot: string; count: number }[] = [
    { key: "all", label: "סה״כ משתמשים", dot: "var(--color-ink)", count: counts.all },
    { key: "manager", label: "מנהל", dot: ROLE_DOT.manager, count: counts.manager },
    { key: "tester", label: "בודק", dot: ROLE_DOT.tester, count: counts.tester },
    { key: "storekeeper", label: "מחסנאי", dot: ROLE_DOT.storekeeper, count: counts.storekeeper },
  ];

  return (
    <div dir="rtl" style={{ height: "100%", display: "flex", flexDirection: "column", gap: 24, padding: 24 }}>
      <SettingsToolbar
        title="ניהול משתמשים"
        subtitle="ניהול חשבונות, תפקידים והרשאות. מנוהל מול Keycloak."
        count={users.length}
        countLabel="משתמשים"
        onAdd={openCreate}
        addLabel="משתמש חדש"
        search={search}
        onSearch={setSearch}
        searchPlaceholder="חיפוש לפי שם או שם משתמש"
      >
        <ToggleButtonGroup value={roleFilter} exclusive color="primary" onChange={(_e, v) => v && setRoleFilter(v as "all" | Role)}>
          <ToggleButton value="all">הכל</ToggleButton>
          <ToggleButton value="manager">מנהל</ToggleButton>
          <ToggleButton value="tester">בודק</ToggleButton>
          <ToggleButton value="storekeeper">מחסנאי</ToggleButton>
        </ToggleButtonGroup>
      </SettingsToolbar>

      {/* KPI strip — clickable role filters */}
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 1.5 }}>
        {kpiCards.map((c) => {
          const active = roleFilter === c.key;
          return (
            <Box
              key={c.key}
              onClick={() => setRoleFilter(c.key)}
              sx={{
                position: "relative",
                cursor: "pointer",
                background: "#fff",
                border: `1px solid ${active ? "var(--color-primary)" : "#e0e0e0"}`,
                borderRadius: "16px",
                padding: "14px 16px",
                overflow: "hidden",
                "&:hover": { borderColor: active ? "var(--color-primary)" : "#c9ccd1" },
              }}
            >
              {active && (
                <span style={{ position: "absolute", insetInlineStart: 0, top: 0, bottom: 0, width: 3, background: "var(--color-primary)" }} />
              )}
              <Stack direction="row" sx={{ alignItems: "center", gap: 0.75 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: c.dot }} />
                <Typography sx={{ fontSize: 13, color: "#7a7a7a" }}>{c.label}</Typography>
              </Stack>
              <Typography sx={{ fontSize: 30, fontWeight: 700, lineHeight: 1.15, mt: 0.5, fontVariantNumeric: "tabular-nums" }}>
                {c.count}
              </Typography>
              <Typography sx={{ fontSize: 12, color: "#9a9aa0" }}>{c.count === 1 ? "משתמש" : "משתמשים"}</Typography>
            </Box>
          );
        })}
      </Box>

      {/* Table / error */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {phase === "error" ? (
          <Box sx={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: "16px", p: 3 }}>
            <Alert severity="error">טעינת המשתמשים נכשלה — לא ניתן להתחבר לשרת ההרשאות.</Alert>
            <Button variant="outlined" onClick={load} sx={{ mt: 2 }}>
              נסה שוב
            </Button>
          </Box>
        ) : (
          <DataTable<AdminUser>
            columns={columns}
            rows={filtered}
            getRowKey={(u) => u.id}
            loading={phase === "loading"}
            minWidth={960}
            maxHeight="100%"
            empty={
              <div>
                <div style={{ fontSize: 16, fontWeight: 600, color: "#1d1d1f", marginBottom: 6 }}>לא נמצאו משתמשים</div>
                <div style={{ fontSize: 14 }}>
                  {search || roleFilter !== "all"
                    ? "אין תוצאות התואמות את החיפוש או הסינון."
                    : "התחל בהוספת המשתמש הראשון."}
                </div>
              </div>
            }
          />
        )}
      </div>

      {/* ---- Create / Edit dialog ---- */}
      <Dialog open={formOpen} onClose={() => setFormOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? "עריכת משתמש" : "משתמש חדש"}</DialogTitle>
        <DialogContent dir="rtl">
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
            <div>
              <TextField
                label="שם משתמש"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                fullWidth
                disabled={!!editing}
                required
              />
              {editing && (
                <Typography sx={{ fontSize: 12, color: "#9a9aa0", mt: 0.5 }}>
                  שם המשתמש אינו ניתן לשינוי לאחר היצירה.
                </Typography>
              )}
            </div>
            <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
              <TextField label="שם פרטי" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} fullWidth />
              <TextField label="שם משפחה" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} fullWidth />
            </Box>
            <TextField
              label="מספר עובד"
              value={form.employeeNumber}
              onChange={(e) => setForm({ ...form, employeeNumber: e.target.value })}
              fullWidth
            />
            <div>
              <Typography sx={{ fontSize: 13.5, fontWeight: 600, mb: 0.75 }}>תפקיד</Typography>
              <ToggleButtonGroup
                value={form.role}
                exclusive
                color="primary"
                disabled={!!editing && editing.username === currentUsername}
                onChange={(_e, v) => v && setForm({ ...form, role: v as Role })}
              >
                <ToggleButton value="manager">מנהל</ToggleButton>
                <ToggleButton value="tester">בודק</ToggleButton>
                <ToggleButton value="storekeeper">מחסנאי</ToggleButton>
              </ToggleButtonGroup>
              {!!editing && editing.username === currentUsername && (
                <Typography sx={{ fontSize: 12, color: "#9a9aa0", mt: 0.5 }}>
                  לא ניתן לשנות את התפקיד של החשבון שאיתו אתה מחובר.
                </Typography>
              )}
            </div>
            {!editing && (
              <>
                <div>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 600, mb: 0.75 }}>סיסמה זמנית</Typography>
                  <Stack direction="row" sx={{ gap: 1, alignItems: "center" }}>
                    <TextField
                      value={form.temporaryPassword}
                      onChange={(e) => setForm({ ...form, temporaryPassword: e.target.value })}
                      fullWidth
                    />
                    <Button variant="outlined" onClick={() => setForm({ ...form, temporaryPassword: generatePassword() })}>
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
          </Box>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={submitForm} disabled={saving}>
            {saving ? "שומר…" : editing ? "שמור" : "צור משתמש"}
          </Button>
          <Button variant="outlined" onClick={() => setFormOpen(false)}>
            ביטול
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---- Reset password dialog ---- */}
      <Dialog open={!!resetTarget} onClose={() => setResetTarget(null)} maxWidth="sm" fullWidth>
        <DialogTitle>איפוס סיסמה</DialogTitle>
        <DialogContent dir="rtl">
          <DialogContentText>
            הגדרת סיסמה זמנית ל<strong>{resetTarget?.fullName}</strong>.
          </DialogContentText>
          <Stack direction="row" sx={{ gap: 1, alignItems: "center", mt: 2 }}>
            <TextField label="סיסמה זמנית" value={resetPwd} onChange={(e) => setResetPwd(e.target.value)} fullWidth />
            <Button variant="outlined" onClick={() => setResetPwd(generatePassword())}>
              חולל
            </Button>
          </Stack>
          <Alert severity="info" sx={{ mt: 2 }}>
            המשתמש יתבקש להחליף סיסמה בכניסה הבאה.
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={submitReset} disabled={busy}>
            אפס סיסמה
          </Button>
          <Button variant="outlined" onClick={() => setResetTarget(null)}>
            ביטול
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---- Toggle active dialog ---- */}
      <Dialog open={!!toggleTarget} onClose={() => setToggleTarget(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {toggleTarget?.status === "disabled"
            ? "הפעלת משתמש"
            : toggleTarget?.status === "locked"
              ? "שחרור נעילה"
              : "השבתת משתמש"}
        </DialogTitle>
        <DialogContent dir="rtl">
          <DialogContentText>
            {toggleTarget?.status === "disabled"
              ? `להפעיל מחדש את "${toggleTarget?.fullName}"? המשתמש יוכל להתחבר.`
              : toggleTarget?.status === "locked"
                ? `לשחרר את הנעילה של "${toggleTarget?.fullName}"? המשתמש יוכל להתחבר שוב.`
                : `להשבית את "${toggleTarget?.fullName}"? המשתמש לא יוכל להתחבר עד להפעלה מחדש.`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={submitToggle} disabled={busy}>
            {toggleTarget?.status === "disabled"
              ? "הפעל"
              : toggleTarget?.status === "locked"
                ? "שחרר נעילה"
                : "השבת"}
          </Button>
          <Button variant="outlined" onClick={() => setToggleTarget(null)}>
            ביטול
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---- Delete dialog ---- */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="sm" fullWidth>
        <DialogTitle>מחיקת משתמש</DialogTitle>
        <DialogContent dir="rtl">
          <DialogContentText>
            האם למחוק את &quot;{deleteTarget?.fullName}&quot;? החשבון יוסר מ-Keycloak.
          </DialogContentText>
          <Typography variant="caption" sx={{ color: "var(--color-destructive)", display: "block", mt: 1 }}>
            פעולה זו אינה ניתנת לביטול.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" color="error" onClick={submitDelete} disabled={busy}>
            מחק משתמש
          </Button>
          <Button variant="outlined" onClick={() => setDeleteTarget(null)}>
            ביטול
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={toast.open}
        autoHideDuration={5000}
        onClose={() => setToast({ ...toast, open: false })}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <Alert severity={toast.sev} onClose={() => setToast({ ...toast, open: false })}>
          {toast.msg}
        </Alert>
      </Snackbar>
    </div>
  );
}
