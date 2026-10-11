// Forbidden-landing page. The middleware (role-protected nav) and requireRole()
// redirect here when an authenticated user lacks the required role. Must be a
// PUBLIC route (see lib/routes.ts PUBLIC_ROUTES) so it always renders.
//
// An empty state, not a dead end: what happened, which page was refused
// (`?from=`, set by the middleware), and the way back.
import { Lock } from "lucide-react";
// Direct import: this is a server component, and the ui barrel also pulls in
// client-only modules.
import { Button } from "@/components/ui/Button";

export default async function NoAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  return (
    <main
      dir="rtl"
      style={{
        minHeight: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-xl) var(--space-md)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 460,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "var(--space-sm)",
          textAlign: "center",
          padding: "var(--space-xl) var(--space-lg)",
          background: "var(--color-canvas)",
          border: "1px solid var(--color-hairline)",
          borderRadius: "var(--r-card)",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 56,
            height: 56,
            borderRadius: "var(--r-pill)",
            background: "var(--color-canvas-parchment)",
            color: "var(--color-ink-muted-48)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Lock size={26} strokeWidth={1.75} />
        </span>
        <h1
          style={{
            margin: "var(--space-xs) 0 0",
            fontSize: "var(--text-heading)",
            fontWeight: 700,
            lineHeight: "var(--lh-display)",
            color: "var(--color-ink)",
          }}
        >
          אין הרשאה
        </h1>
        <p style={{ margin: 0, fontSize: "var(--text-body)", lineHeight: "var(--lh-body)", color: "var(--color-ink-muted-48)" }}>
          לחשבון שלך אין הרשאה לעמוד הזה. אם אתה צריך גישה, פנה למנהל המערכת.
        </p>
        {from ? (
          <p style={{ margin: 0, fontSize: "var(--text-small)", color: "var(--color-ink-muted-48)" }}>
            העמוד שביקשת:{" "}
            <bdi dir="ltr" style={{ fontFamily: "var(--font-mono)", color: "var(--color-ink-muted-80)" }}>{from}</bdi>
          </p>
        ) : null}
        <Button href="/" style={{ marginTop: "var(--space-sm)" }}>
          חזור לדף הבית
        </Button>
      </div>
    </main>
  );
}
