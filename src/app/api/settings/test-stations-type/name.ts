import { uniqueName } from "@/app/lib/lookups";

/** No two station types share a description. */
export const stationTypeName = (desc: string) => uniqueName("test_stations_type", desc, "סוג עמדה בשם זה כבר קיים במערכת");
