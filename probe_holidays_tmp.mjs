import { HebrewCalendar, flags } from "@hebcal/core";

function flagNames(f) {
  return Object.keys(flags).filter(k => typeof flags[k] === "number" && (f & flags[k])).join("|");
}

for (const year of [2024,2025,2026,2027,2028,2029,2030,2035,2040]) {
  const events = HebrewCalendar.calendar({
    start: new Date(year, 0, 1),
    end: new Date(year, 11, 31),
    il: true, sedrot: false, candlelighting: false,
    noRoshChodesh: true, noSpecialShabbat: true, noMinorFast: true, noModern: false,
  });
  console.log("==== YEAR", year, "====");
  const seen = {};
  for (const ev of events) {
    const f = ev.getFlags();
    const desc = ev.getDesc();
    let cat = null;
    if (f & flags.CHAG) cat = "full_off";
    else if (desc.startsWith("Yom HaAtzma")) cat = "full_off";
    else if (desc === "Yom HaZikaron" || desc === "Yom HaShoah") cat = "half_day";
    else if (f & flags.EREV && f & flags.LIGHT_CANDLES) cat = "eve";
    if (!cat) continue;
    let heLabel;
    try { heLabel = ev.render("he-x-NoNikud"); } catch { heLabel = ev.render("he"); }
    const stripped = heLabel.replace(/\s+\d{3,4}\s*$/, "").trim();
    const g = ev.getDate().greg();
    const dateStr = `${g.getFullYear()}-${String(g.getMonth()+1).padStart(2,"0")}-${String(g.getDate()).padStart(2,"0")}`;
    seen[dateStr] = (seen[dateStr]||0)+1;
    const collision = seen[dateStr] > 1 ? "  <<< COLLISION" : "";
    console.log(dateStr, cat.padEnd(8), JSON.stringify(desc).padEnd(30), "he=", JSON.stringify(heLabel).padEnd(22), "stripped=", JSON.stringify(stripped).padEnd(20), flagNames(f), collision);
  }
}
