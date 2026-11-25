// /settings/users is MANAGER-ONLY. Server-side guard — defense-in-depth beyond
// the edge middleware (routes.ts also gates it): a non-manager is redirected to
// /no-auth, and an unauthenticated request to /login. Runs before the page.
import { requireRole } from "@/lib/auth/require-user";
import { ACCESS } from "@/lib/auth/roles";

export default async function UsersLayout({ children }: { children: React.ReactNode }) {
  await requireRole(ACCESS.usersAdmin);
  return <>{children}</>;
}
