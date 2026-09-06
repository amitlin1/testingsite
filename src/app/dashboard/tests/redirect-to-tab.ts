import { redirect } from "next/navigation";

/**
 * §1 — the eight old routes keep working; each one is now a redirect into the
 * tab that replaced it, and THE QUERY PARAMS SURVIVE. A bookmark like
 * `/dashboard/tests/slow-items?customerId=4821` has to land on the same numbers
 * it always did, so every param is carried across and only `tab` is added.
 */
export type OldRouteSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

export async function redirectToTab(
  tab: string,
  searchParams: OldRouteSearchParams,
): Promise<never> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (key === "tab") continue;
    if (Array.isArray(value)) value.forEach((v) => params.append(key, v));
    else if (value !== undefined) params.set(key, value);
  }
  params.set("tab", tab);
  redirect(`/dashboard/tests?${params.toString()}`);
}
