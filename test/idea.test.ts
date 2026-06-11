// Pure tests for src/idea.ts — schema round-trip, defaults, partial merge.

import test from "node:test";
import assert from "node:assert/strict";
import { mergeIdea, parseIdea, serializeIdea, type Idea } from "../src/idea";

const FULL: Idea = {
  slug: "compressed-decision-log",
  title: "Compressed decision log",
  description: "Store research decisions in a compressed self-index so resume briefings scale.",
  motivation: "MemoryBank keeps entries flat; nothing exploits repetitiveness of decision text.",
  firstExperiment: "Index 1k synthetic decisions with an FM-index and measure lookup latency.",
  sourcePapers: ["memorybank-2024", "fm-index"],
  themes: ["Agentic Memory", "Compressed Indexing"],
  status: "exploring",
  created: "2026-06-01T00:00:00Z",
  updated: "2026-06-02T00:00:00Z",
};

test("parseIdea round-trips serializeIdea", () => {
  assert.deepEqual(parseIdea(serializeIdea(FULL)), FULL);
});

test("parseIdea applies defaults for status/sourcePapers/themes", () => {
  const minimal = parseIdea(
    JSON.stringify({ slug: "x", title: "t", description: "d", created: "2026-01-01T00:00:00Z", updated: "2026-01-01T00:00:00Z" }),
  );
  assert.ok(minimal);
  assert.equal(minimal.status, "raw");
  assert.deepEqual(minimal.sourcePapers, []);
  assert.deepEqual(minimal.themes, []);
});

test("parseIdea returns null on garbage and on an invalid status", () => {
  assert.equal(parseIdea("not json"), null);
  assert.equal(parseIdea(JSON.stringify({ ...FULL, status: "abandoned" })), null);
});

test("mergeIdea overlays only defined keys and stamps updated", () => {
  const merged = mergeIdea(FULL, { status: "adopted" }, "2026-06-03T00:00:00Z");
  assert.equal(merged.status, "adopted");
  assert.equal(merged.description, FULL.description, "status-only patch preserves description");
  assert.equal(merged.motivation, FULL.motivation);
  assert.equal(merged.slug, FULL.slug);
  assert.equal(merged.created, FULL.created);
  assert.equal(merged.updated, "2026-06-03T00:00:00Z");
});
