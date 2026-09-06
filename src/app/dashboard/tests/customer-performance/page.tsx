import { redirectToTab, type OldRouteSearchParams } from "../redirect-to-tab";

export default async function Page({ searchParams }: { searchParams: OldRouteSearchParams }) {
  return redirectToTab("customers", searchParams);
}
