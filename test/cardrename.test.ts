// Unit tests for the pure theme-rename helper in src/card.ts. No I/O.

import test from "node:test";
import assert from "node:assert/strict";
import { applyThemeRename } from "../src/card";

test("applyThemeRename returns null when from is absent", () => {
  assert.equal(applyThemeRename(["A", "B"], "Z", "Y"), null);
  assert.equal(applyThemeRename([], "A", "B"), null);
});

test("applyThemeRename replaces from with to", () => {
  assert.deepEqual(applyThemeRename(["A", "B"], "A", "C"), ["C", "B"]);
});

test("applyThemeRename de-dups when to already exists, preserving order", () => {
  assert.deepEqual(applyThemeRename(["A", "B", "C"], "C", "A"), ["A", "B"]);
  assert.deepEqual(applyThemeRename(["A", "B"], "B", "A"), ["A"]);
});

test("applyThemeRename keeps order on a single-element theme list", () => {
  assert.deepEqual(applyThemeRename(["A"], "A", "B"), ["B"]);
});
