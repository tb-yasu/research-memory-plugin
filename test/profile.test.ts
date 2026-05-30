import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY_PROFILE, ResearchProfileSchema, mergeProfile, parseProfile, serializeProfile } from "../src/profile";

test("parseProfile round-trips a serialized profile", () => {
  const p = ResearchProfileSchema.parse({ focus: "compressed agent memory", themes: ["A", "B"], questions: ["q1"], updated: "2026-05-30T00:00:00.000Z" });
  assert.deepEqual(parseProfile(serializeProfile(p)), p);
});

test("parseProfile returns null on garbage", () => {
  assert.equal(parseProfile("{not json"), null);
});

test("mergeProfile overlays only defined keys and stamps updated", () => {
  const base = ResearchProfileSchema.parse({ focus: "old", themes: ["A"], questions: ["q1"], updated: "t0" });
  const merged = mergeProfile(base, { focus: "new" }, "t1");
  assert.equal(merged.focus, "new");
  assert.deepEqual(merged.themes, ["A"]); // preserved — not in the patch
  assert.equal(merged.updated, "t1");
});

test("EMPTY_PROFILE is empty", () => {
  assert.equal(EMPTY_PROFILE.focus, "");
  assert.deepEqual(EMPTY_PROFILE.themes, []);
});
