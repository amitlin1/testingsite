"use client";
import React, { useState } from "react";
import {
  Box, Stack, Typography, Button, IconButton, TextField, SearchInput, Select, MenuItem,
  ToggleButton, ToggleButtonGroup, Switch, Checkbox, Radio, RadioGroup, FormControlLabel,
  Chip, Badge, StatusPill, Card, CardContent, Tabs, Tab, Alert, LinearProgress, CircularProgress,
  Skeleton, Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
} from "@/components/ui";
import { Check, QrCode, Pencil, Trash2, MoreHorizontal, Clock, TrendingUp } from "lucide-react";

function Section({ title, en, children }: { title: string; en: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 56 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 24, borderBottom: "1px solid var(--color-hairline)", paddingBottom: 12 }}>
        <Typography variant="h3" style={{ margin: 0 }}>{title}</Typography>
        <span style={{ fontSize: 13, color: "var(--color-ink-muted-48)" }}>{en}</span>
      </div>
      {children}
    </section>
  );
}

export default function UiDemo() {
  const [sel, setSel] = useState("b");
  const [seg, setSeg] = useState("pass");
  const [sw, setSw] = useState(true);
  const [ck, setCk] = useState(true);
  const [rd, setRd] = useState("2");
  const [tab, setTab] = useState(0);
  const [open, setOpen] = useState(false);

  return (
    <div dir="rtl" style={{ minHeight: "100vh", padding: "48px 40px 96px" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <header style={{ marginBottom: 56 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <div style={{ width: 34, height: 34, borderRadius: 8, background: "var(--color-ink)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 19 }}>S</div>
            <span style={{ fontSize: 14, color: "var(--color-ink-muted-48)" }}>Shifthouse · ספריית קומפוננטות (ui/)</span>
          </div>
          <Typography variant="h1" style={{ fontSize: 52, lineHeight: 1.05, margin: "0 0 16px" }}>שפת רכיבים אחת.<br />ללא MUI.</Typography>
        </header>

        <Section title="כפתורים" en="Button · IconButton">
          <Card><CardContent>
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" style={{ marginBottom: 16 }}>
              <Button>שמור שינויים</Button>
              <Button variant="outlined">ביטול</Button>
              <Button variant="dark">כלי עזר</Button>
              <Button color="error">מחק</Button>
              <Button disabled>מושבת</Button>
            </Stack>
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
              <Button startIcon={<Check size={18} strokeWidth={1.75} />}>אשר קליטה</Button>
              <Button variant="outlined" startIcon={<QrCode size={18} strokeWidth={1.75} />}>סרוק ברקוד</Button>
              <span style={{ width: 1, height: 32, background: "var(--color-hairline)" }} />
              <IconButton><Pencil size={20} strokeWidth={1.75} /></IconButton>
              <IconButton color="error"><Trash2 size={20} strokeWidth={1.75} /></IconButton>
              <IconButton round><MoreHorizontal size={20} strokeWidth={1.75} /></IconButton>
            </Stack>
          </CardContent></Card>
        </Section>

        <Section title="שדות קלט ובחירה" en="TextField · Search · Select · Segmented">
          <Card><CardContent>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }}>
              <TextField label="שם עובד" defaultValue="מרתה לוי" />
              <SearchInput label="חיפוש" placeholder="חפש עובד או משמרת" />
              <div>
                <label className="sh-field-label">משמרת</label>
                <Select value={sel} onChange={(e) => setSel(e.target.value as string)} fullWidth>
                  <MenuItem value="a">משמרת A</MenuItem>
                  <MenuItem value="b">משמרת B</MenuItem>
                  <MenuItem value="c">משמרת C</MenuItem>
                </Select>
              </div>
              <div>
                <label className="sh-field-label">תוצאת בדיקה</label>
                <ToggleButtonGroup exclusive value={seg} onChange={(e, v) => v && setSeg(v as string)}>
                  <ToggleButton value="pass" color="success">עבר</ToggleButton>
                  <ToggleButton value="fail" color="error">נכשל</ToggleButton>
                </ToggleButtonGroup>
              </div>
              <TextField label="שדה עם שגיאה" error helperText="שדה חובה" defaultValue="—" />
              <TextField label="הערות" multiline rows={3} defaultValue="נקלט בשלמות. אריזה תקינה." />
            </div>
          </CardContent></Card>
        </Section>

        <Section title="בוררים" en="Switch · Checkbox · Radio">
          <Card><CardContent>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 32 }}>
              <FormControlLabel control={<Switch checked={sw} onChange={(e) => setSw(e.target.checked)} />} label="התראות בזמן אמת" />
              <FormControlLabel control={<Checkbox checked={ck} onChange={(e) => setCk(e.target.checked)} />} label="דרוש צילום" />
              <RadioGroup value={rd} onChange={(e) => setRd(e.target.value)}>
                <FormControlLabel value="1" control={<Radio />} label="קו 1" />
                <FormControlLabel value="2" control={<Radio />} label="קו 2" />
                <FormControlLabel value="3" control={<Radio />} label="קו 3" />
              </RadioGroup>
            </div>
          </CardContent></Card>
        </Section>

        <Section title="תגיות ומצב" en="Chip · StatusPill · Badge">
          <Card><CardContent>
            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" style={{ marginBottom: 20 }}>
              <StatusPill status="on" label="ON SHIFT" />
              <StatusPill status="late" label="LATE" />
              <StatusPill status="absent" label="ABSENT" />
              <StatusPill status="approved" label="APPROVED" />
            </Stack>
            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
              <Chip label="קו 3" />
              <Chip label="נבחר" color="primary" />
              <Badge badgeContent={4} color="error"><Chip label="התראות" /></Badge>
            </Stack>
          </CardContent></Card>
        </Section>

        <Section title="כרטיסים" en="Card · KPI · Dark tile">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>
            <Card><CardContent>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--color-ink-muted-48)", marginBottom: 16 }}><Clock size={20} strokeWidth={1.75} /><span style={{ fontSize: 14 }}>זמן ממוצע לעמדה</span></div>
              <Typography variant="h2" style={{ fontSize: 40, margin: 0 }}>7h 42m</Typography>
              <div style={{ fontSize: 13, color: "var(--color-status-approved)", marginTop: 8, display: "flex", alignItems: "center", gap: 4 }}><TrendingUp size={14} strokeWidth={1.75} />4% מהשבוע שעבר</div>
            </CardContent></Card>
            <div style={{ background: "var(--color-surface-tile-1)", borderRadius: "var(--r-lg)", padding: 24, color: "#fff" }}>
              <div style={{ fontSize: 14, color: "var(--color-body-muted)", marginBottom: 16 }}>על הרצפה כעת</div>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 40, lineHeight: 1 }}>128</div>
              <a href="#" style={{ fontSize: 14, color: "var(--color-primary-on-dark)", marginTop: 8, display: "inline-block" }}>צפה בעובדים</a>
            </div>
            <Card><CardContent>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <div style={{ width: 52, height: 52, borderRadius: "50%", background: "linear-gradient(135deg,#c9b8a5,#8a7a68)", flexShrink: 0, boxShadow: "var(--shadow-product)" }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 17, fontWeight: 600 }}>מרתה לוי</div>
                  <div style={{ fontSize: 13, color: "var(--color-ink-muted-48)" }}>קו 3 · משמרת A · 06:02</div>
                </div>
                <StatusPill status="on" label="ON" />
              </Stack>
            </CardContent></Card>
          </div>
        </Section>

        <Section title="לשוניות והתראות" en="Tabs · Alert">
          <Card><CardContent>
            <Tabs value={tab} onChange={(e, v) => setTab(v as number)} style={{ marginBottom: 20 }}>
              <Tab label="סקירה" /><Tab label="עובדים" /><Tab label="משמרות" /><Tab label="היעדרויות" />
            </Tabs>
            <Stack spacing={1.5}>
              <Alert severity="info">יש לך 4 משמרות לאישור בתור.</Alert>
              <Alert severity="success">גיליון הנוכחות אושר בהצלחה.</Alert>
              <Alert severity="error">הברקוד שנסרק אינו תקין. נסה שוב.</Alert>
            </Stack>
          </CardContent></Card>
        </Section>

        <Section title="טעינה והתקדמות" en="Progress · Skeleton">
          <Card><CardContent>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, alignItems: "center" }}>
              <Stack spacing={2}>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 8 }}><span>השלמת קליטה</span><span style={{ color: "var(--color-ink-muted-48)" }}>72%</span></div>
                  <LinearProgress variant="determinate" value={72} />
                </div>
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <CircularProgress size={28} />
                  <span style={{ fontSize: 15, color: "var(--color-ink-muted-48)" }}>טוען נתונים…</span>
                </Stack>
              </Stack>
              <Stack spacing={1.5}>
                <Skeleton width="60%" height={14} />
                <Skeleton width="90%" height={14} />
                <Skeleton width="75%" height={14} />
              </Stack>
            </div>
          </CardContent></Card>
        </Section>

        <Section title="טבלה וחלון" en="Table · Dialog">
          <TableContainer style={{ border: "1px solid var(--color-hairline)", borderRadius: "var(--r-lg)", overflow: "hidden", marginBottom: 24 }}>
            <Table>
              <TableHead><TableRow>
                <TableCell>עובד</TableCell><TableCell>קו</TableCell><TableCell>כניסה</TableCell><TableCell>מצב</TableCell>
              </TableRow></TableHead>
              <TableBody>
                <TableRow hover><TableCell style={{ fontWeight: 600 }}>מרתה לוי</TableCell><TableCell>קו 3</TableCell><TableCell>06:02</TableCell><TableCell><StatusPill status="on" label="ON SHIFT" /></TableCell></TableRow>
                <TableRow hover><TableCell style={{ fontWeight: 600 }}>דני כהן</TableCell><TableCell>קו 1</TableCell><TableCell>06:14</TableCell><TableCell><StatusPill status="late" label="LATE" /></TableCell></TableRow>
                <TableRow hover><TableCell style={{ fontWeight: 600 }}>רות אבידן</TableCell><TableCell>קו 2</TableCell><TableCell>—</TableCell><TableCell><StatusPill status="absent" label="ABSENT" /></TableCell></TableRow>
              </TableBody>
            </Table>
          </TableContainer>
          <Button onClick={() => setOpen(true)}>פתח חלון דוגמה</Button>
          <Dialog open={open} onClose={() => setOpen(false)}>
            <DialogTitle>אישור קליטה</DialogTitle>
            <DialogContent>
              <DialogContentText style={{ marginBottom: 20 }}>האם לאשר את קליטת המשלוח לקו 3, משמרת A?</DialogContentText>
              <TextField label="הערה (אופציונלי)" placeholder="הוסף הערה" fullWidth />
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setOpen(false)}>אשר קליטה</Button>
              <Button variant="outlined" onClick={() => setOpen(false)}>ביטול</Button>
            </DialogActions>
          </Dialog>
        </Section>
      </div>
    </div>
  );
}
