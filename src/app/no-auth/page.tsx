// Forbidden-landing page. The middleware (role-protected nav) and requireRole()
// redirect here when an authenticated user lacks the required role. Must be a
// PUBLIC route (see lib/routes.ts PUBLIC_ROUTES) so it always renders.
//
// Minimal stub — will be restyled to match the app design. `?from=` carries the
// path they were denied (set by the middleware) if we want to show it.

export default async function NoAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  return (
    <main style={{ padding: "4rem", textAlign: "center" }}>
      <h1>אין הרשאה</h1>
      <p>אין לך הרשאה לגשת לעמוד זה.</p>
      {from ? <p style={{ opacity: 0.6, fontSize: "0.9rem" }}>{from}</p> : null}
    </main>
  );
}
