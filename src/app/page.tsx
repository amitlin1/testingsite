import { redirect } from "next/navigation";

/**
 * The home page is מארזים ופריטים. An old link with a search (`/?q=…`) keeps
 * it: the board searches boxes and the items inside them. The former home —
 * "דוחות וניהול פריטים" — lives on at /items.
 */
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = (await searchParams).q;
  redirect(typeof q === "string" && q.trim() ? `/packages?q=${encodeURIComponent(q)}` : "/packages");
}
