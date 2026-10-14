import { test } from "node:test";
import assert from "node:assert/strict";
import type { FieldsContextJson } from "@/app/lib/station-fields/admin-types";
import { buildFieldsMap } from "../mapModel";
import { COPY_PENDING, MAP_TEXT } from "../labels";
import { ONBOARDING_STEPS, ONBOARDING_TEXT, sharedFilledLines } from "../onboardingLabels";
import { CLOSE, ELEC, KIT_A, KIT_B, MON, OPEN, STATIONS, artboard1, artboard11, config, fields, line, route, step } from "./fixtures";

test("the card's text is artboard 11's, character for character", () => {
  assert.equal(ONBOARDING_TEXT.title, "עדיין לא הוגדרו שדות למסלול הזה");
  assert.equal(ONBOARDING_TEXT.body, "כל עוד אין שדות, כל עמדה מציגה לעובד את החלון הקבוע של היום. שום דבר לא משתנה בעמדות עד שתפרסמו.");
  assert.equal(ONBOARDING_TEXT.stepsLabel, "שלושה צעדים");
  assert.equal(ONBOARDING_TEXT.start, "התחל בעמדה הראשונה");
  assert.equal(ONBOARDING_TEXT.applySet, "החל ערכת שדות…");
  assert.deepEqual(ONBOARDING_STEPS, [
    { title: "בחרו עמדה ופריט", line: "לחיצה על תא במפה" },
    { title: "הוסיפו שורות בדיקה", line: "שם · 4 אפשרויות · הערות" },
    { title: "פרסמו", line: "העובדים יראו את השדות בחלון העמדה" },
  ]);
  // The left-out outlined button keeps its words where the map toolbar has them.
  assert.equal(MAP_TEXT.copyFromRoute, "העתק ממסלול אחר…");
});

test("artboard 11's info bar: the screen's route, filled at three stations by the other kit", () => {
  const m = buildFieldsMap({ context: artboard11() });
  assert.equal(m.onboarding, true);
  assert.deepEqual(sharedFilledLines(m), [{
    key: "line:11",
    text: "3 תאים כבר מלאים: מסך משתמש במסלול 1 שלו, שמוגדר גם במארז עמדת עבודה.",
    links: [{ packageTypeId: KIT_A.package_type_id, text: "פתח את מארז עמדת עבודה" }],
  }]);
});

/** A kit "מארז" (id 70) without fields whose lines run the given routes. */
function kitWith(lines: FieldsContextJson["lines"]): FieldsContextJson {
  return {
    kind: "package",
    subject: { item_type_id: 70, desc: "מארז", is_package: true, route_number: 1 },
    stations: STATIONS,
    kit: route(700, 70, 1, [[OPEN, "s_k7open00"], [CLOSE, "s_k7clos00"]]),
    item: null,
    lines,
  };
}

const filledScreen = (shared: { package_type_id: number; desc: string }[], cells = 1) =>
  route(710, MON, 1, [[OPEN, "s_m7open00"], [ELEC, "s_m7elec00"], [CLOSE, "s_m7clos00"]], {
    published: config(step("s_m7elec00", ELEC, "item", [{ target: "item", fields: fields(cells, ["pass", "fail"]) }])),
    shared,
  });

test("one filled cell takes the COPY-PENDING singular; every other kit gets its own link", () => {
  const m = buildFieldsMap({ context: kitWith([line(1, MON, "מסך", 1, 1, 1, filledScreen([KIT_A, KIT_B]))]) });
  assert.equal(m.onboarding, true);
  const lines = sharedFilledLines(m);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, COPY_PENDING.sharedFilledOne + ": מסך משתמש במסלול 1 שלו, שמוגדר גם במארז עמדת עבודה, מארז ציוד היקפי.");
  assert.deepEqual(lines[0].links, [
    { packageTypeId: KIT_A.package_type_id, text: "פתח את מארז עמדת עבודה" },
    { packageTypeId: KIT_B.package_type_id, text: "פתח את מארז ציוד היקפי" },
  ]);
});

test("two lines on one route are told once", () => {
  const screen = filledScreen([KIT_A]);
  const m = buildFieldsMap({ context: kitWith([line(1, MON, "מסך", 1, 1, 1, screen), line(2, MON, "מסך", 1, 2, 2, screen)]) });
  assert.equal(m.sharedFilled.length, 2);
  assert.deepEqual(sharedFilledLines(m).map((l) => l.key), ["line:1"]);
});

test("no bar when nothing is filled through another kit, or the route holds fields of its own", () => {
  const unshared = route(711, MON, 1, [[OPEN, "s_m8open00"], [ELEC, "s_m8elec00"], [CLOSE, "s_m8clos00"]]);
  assert.deepEqual(sharedFilledLines(buildFieldsMap({ context: kitWith([line(1, MON, "מסך", 1, 1, 1, unshared)]) })), []);
  const emptyShared = route(712, MON, 1, [[OPEN, "s_m9open00"], [ELEC, "s_m9elec00"], [CLOSE, "s_m9clos00"]], { shared: [KIT_A] });
  assert.deepEqual(sharedFilledLines(buildFieldsMap({ context: kitWith([line(1, MON, "מסך", 1, 1, 1, emptyShared)]) })), []);
  const own = buildFieldsMap({ context: artboard1() });
  assert.equal(own.onboarding, false, "artboard 1's kit holds fields: no card at all");
});
