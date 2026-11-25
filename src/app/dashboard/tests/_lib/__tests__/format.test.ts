import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EM_DASH,
  changePct,
  describeIgnoredFilters,
  formatAttempt,
  formatMinutes,
  formatPercent,
  formatQueueAge,
} from "../format";

test("a missing number prints as an em dash, never 0 or 'null%'", () => {
  for (const v of [null, undefined, Number.NaN]) {
    assert.equal(formatMinutes(v), EM_DASH);
    assert.equal(formatQueueAge(v), EM_DASH);
    assert.equal(formatPercent(v), EM_DASH);
  }
  assert.equal(formatPercent(0), "0%");
  assert.equal(formatMinutes(0), "0 דק׳");
});

test("durations: minutes under the hour, hours and minutes under ten hours, hours above", () => {
  assert.equal(formatMinutes(41.83), "42 דק׳");
  assert.equal(formatMinutes(125), "2 שע׳ 5 דק׳");
  assert.equal(formatMinutes(120), "2 שע׳");
  assert.equal(formatMinutes(11 * 60 + 40), "12 שע׳");
  assert.equal(formatQueueAge(45), "45 דק׳");
  assert.equal(formatQueueAge(90), "1.5 שע׳");
});

test("changePct has no answer without a usable earlier window", () => {
  assert.equal(changePct(10, null), null);
  assert.equal(changePct(null, 10), null);
  assert.equal(changePct(undefined, 10), null);
  assert.equal(changePct(10, 0), null);
  assert.equal(changePct(12, 10), 20);
  assert.equal(changePct(5, 10), -50);
});

test("formatAttempt as it ships: a repeat reads as a retest whatever the reason", () => {
  assert.deepEqual(formatAttempt(1, "test_started"), { text: "1", tone: "muted" });
  assert.deepEqual(formatAttempt(2, "test_started"), { text: "2 · חזרה", tone: "amber" });
  // The reaper's release is not one of the reasons it tests for.
  assert.deepEqual(formatAttempt(2, "released_stale"), { text: "2 · חזרה", tone: "amber" });
  assert.deepEqual(formatAttempt(3, "restart_after_abandonment"), {
    text: "3 · אחרי נטישה",
    tone: "red",
  });
  // A first attempt is never a retest, even under a rework reason.
  assert.deepEqual(formatAttempt(1, "returned_to_route"), { text: "1", tone: "muted" });
});

test("describeIgnoredFilters names the part that ignored each filter", () => {
  assert.equal(describeIgnoredFilters(null), null);
  assert.equal(describeIgnoredFilters(""), null);
  assert.equal(describeIgnoredFilters(" , "), null);

  const notice = describeIgnoredFilters("liveBoard:customerId,liveBoard:itemTypeId,liveBoard:customerId");
  assert.deepEqual(notice, { text: "הלוח החי אינו מסנן לפי לקוח / סוג פריט", names: ["לקוח", "סוג פריט"] });

  // An unqualified name belongs to the live board.
  assert.equal(describeIgnoredFilters("workerId")?.text, "הלוח החי אינו מסנן לפי מס׳ עובד");

  assert.equal(
    describeIgnoredFilters("finishedCumulative:stationId, workThroughput:stationId")?.text,
    "מסלולים שנסגרו אינו מסנן לפי עמדה · התפוקה היומית אינו מסנן לפי עמדה",
  );
});

test("describeIgnoredFilters prints an unknown source or filter as its raw key", () => {
  assert.equal(describeIgnoredFilters("mystery:customerId")?.text, "mystery אינו מסנן לפי לקוח");
  assert.equal(describeIgnoredFilters("entityProgress:states")?.text, "מצב הישות אינו מסנן לפי states");
});
