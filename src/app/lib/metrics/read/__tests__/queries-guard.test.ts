// The §5.0(9) lint: every `@>` / `&&` range probe keeps its `NOT <alias>.is_terminal`
// in its own clause — the predicate that separates ~400ms from >120s.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { QUERY_BUILDERS, allBuiltStatements } from "../queries";
import { guardRangeProbes } from "../sql";

const PROBE = /\b([A-Za-z_][A-Za-z0-9_]*)\.valid_range\s*(@>|&&)/g;

describe("§5.0(9) — the catalogue sweep", () => {
  it("builds every builder in QUERY_BUILDERS", () => {
    const labels = allBuiltStatements().map((b) => b.label);
    for (const key of Object.keys(QUERY_BUILDERS)) {
      assert.ok(
        labels.some((l) => l.startsWith(key + " ")),
        `${key} is in QUERY_BUILDERS but nothing in allBuiltStatements() builds it`,
      );
    }
  });

  it("every guard in every statement is load-bearing — remove one and the lint fires", () => {
    let guardedProbes = 0;
    let unprobedGuards = 0;
    for (const b of allBuiltStatements()) {
      for (const g of b.sql.matchAll(/NOT\s+([A-Za-z_][A-Za-z0-9_]*)\.is_terminal\b/g)) {
        const alias = g[1];
        const at = g.index ?? 0;
        const without = b.sql.slice(0, at) + b.sql.slice(at + g[0].length);
        PROBE.lastIndex = 0;
        const probed = [...b.sql.matchAll(PROBE)].some((m) => m[1] === alias);
        if (!probed) {
          // Q4 and Q6 carry `NOT i.is_terminal` with no probe; the lint has nothing to say.
          unprobedGuards++;
          assert.doesNotThrow(() => guardRangeProbes(without, b.label));
          continue;
        }
        guardedProbes++;
        assert.throws(
          () => guardRangeProbes(without, b.label),
          new RegExp(`range probe on ${alias}\.valid_range`),
          `${b.label}: NOT ${alias}.is_terminal at offset ${at} can be deleted unnoticed`,
        );
      }
    }
    assert.ok(guardedProbes > 0 && unprobedGuards > 0);
  });
});

describe("§5.0(9) — guardRangeProbes", () => {
  it("looks for the guard in the probe's OWN clause: a guard elsewhere on the same alias does not count", () => {
    const sql = `
WITH a AS (SELECT 1 FROM item_state_interval q WHERE q.valid_range @> now() AND NOT q.is_terminal),
     b AS (SELECT 1 FROM item_state_interval q WHERE q.valid_range @> now())
SELECT 1`;
    assert.throws(() => guardRangeProbes(sql, "t"), /range probe on q\.valid_range/);
    assert.doesNotThrow(() => guardRangeProbes(sql.replace("now())\nSELECT", "now() AND NOT q.is_terminal)\nSELECT"), "t"));
  });

  it("a guard inside a comment or a string literal is not a guard", () => {
    const commented = `SELECT 1 FROM item_state_interval i WHERE i.valid_range && $1 -- AND NOT i.is_terminal`;
    const quoted = `SELECT 'AND NOT i.is_terminal' FROM item_state_interval i WHERE i.valid_range && $1`;
    assert.throws(() => guardRangeProbes(commented, "t"));
    assert.throws(() => guardRangeProbes(quoted, "t"));
  });

  it("returns the statement unchanged when every probe is guarded", () => {
    const sql = "SELECT 1 FROM item_state_interval i WHERE i.valid_range @> $1 AND NOT i.is_terminal";
    assert.equal(guardRangeProbes(sql, "t"), sql);
  });
});
