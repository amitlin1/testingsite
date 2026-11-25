import { uniqueName } from "@/app/lib/lookups";

/** No two item types share a description. */
export const itemTypeName = (desc: string) => uniqueName("item_types", desc, "סוג פריט זה כבר קיים במערכת");
