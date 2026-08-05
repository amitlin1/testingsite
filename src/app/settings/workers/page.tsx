import { notFound } from "next/navigation";

/**
 * RETIRED — ניהול עובדים.
 *
 * The local `workers` table is being removed. Every acting identity now comes
 * from the Keycloak session (`session.user.employeeNumber`), so there is no
 * local worker roster left to administer; users are managed at /settings/users.
 *
 * The route is kept as a 404 rather than deleted so the original screen stays
 * recoverable in one diff while the migration lands. `./WorkersTable` is left on
 * disk, now unreferenced — it goes away with the rest of the workers plumbing.
 *
 * The nav entry is commented out in ../settingsNav.ts, which removes it from the
 * sidebar group and the settings tab strip at once.
 */
export default function WorkersPage() {
  notFound();
}

// --- Original page, retained for reference ------------------------------------
//
// "use client";
// import WorkersTable from "./WorkersTable";
//
// export default function WorkersPage() {
//   return (
//     <WorkersTable
//       title="ניהול עובדים"
//       subtitle="הוספה, עריכה ומחיקה של עובדים במערכת."
//       countLabel="עובדים"
//     />
//   );
// }
