import { uniqueName } from "@/app/lib/lookups";

/** No two stations share a description. */
export const stationName = (desc: string) => uniqueName("test_stations", desc, "עמדה בשם זה כבר קיימת במערכת");
