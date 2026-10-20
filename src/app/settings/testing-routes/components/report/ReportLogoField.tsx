"use client";

// Custom Puck field: pick a header logo — one of the bundled emblems
// (public/report-logos) or an uploaded image. Stores the path / MinIO object
// key (not the bytes) in the template. Ported from ticketflow's PdfLogoField.

import * as React from "react";
import { Paperclip, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { withBasePath } from "@/lib/base-path";

const BUNDLED = [
  { path: "/report-logos/emblem-navy.png", label: "סמל כחול" },
  { path: "/report-logos/emblem-red.png", label: "סמל אדום" },
  { path: "/report-logos/emblem-atom.jpg", label: "סמל אטום" },
  { path: "/report-logos/emblem-chain.png", label: "סמל שרשרת" },
];

export function logoUrl(value: string): string {
  if (!value) return "";
  return value.startsWith("/")
    ? withBasePath(value)
    : withBasePath(`/api/item-reports/logo?key=${encodeURIComponent(value)}`);
}

export function ReportLogoField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setErr("");
    setBusy(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await apiFetch("/api/item-reports/logo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataUrl: String(reader.result) }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { key: string };
        onChange(body.key);
      } catch {
        setErr("ההעלאה נכשלה. אפשר להעלות PNG, JPEG, WebP או SVG עד 2MB.");
      } finally {
        setBusy(false);
      }
    };
    reader.onerror = () => {
      setBusy(false);
      setErr("לא ניתן לקרוא את הקובץ");
    };
    reader.readAsDataURL(file);
  }

  const src = logoUrl(value);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="rpted-logo-box">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {src ? <img src={src} alt="" /> : <span>אין לוגו</span>}
      </div>
      <div className="rpted-logo-bundled" role="group" aria-label="סמלים מובנים">
        {BUNDLED.map((b) => (
          <button
            key={b.path}
            type="button"
            title={b.label}
            aria-label={b.label}
            aria-pressed={value === b.path}
            className={`rpted-logo-pick${value === b.path ? " is-on" : ""}`}
            onClick={() => onChange(b.path)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={withBasePath(b.path)} alt="" />
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <Button size="small" variant="outlined" startIcon={<Paperclip size={14} />} onClick={() => inputRef.current?.click()} loading={busy}>
          {value && !value.startsWith("/") ? "החלפת לוגו" : "העלאת לוגו"}
        </Button>
        {value ? (
          <Button size="small" variant="text" startIcon={<Trash2 size={14} />} onClick={() => onChange("")} disabled={busy}>
            הסרה
          </Button>
        ) : null}
      </div>
      {err ? (
        <span role="alert" style={{ fontSize: "var(--text-fine)", color: "var(--color-destructive)" }}>
          {err}
        </span>
      ) : null}
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={onFile} hidden />
    </div>
  );
}
