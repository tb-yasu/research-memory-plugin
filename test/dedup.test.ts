// Unit tests for the duplicate-detection + two-card merge helpers in
// src/card.ts. Pure, no I/O.

import test from "node:test";
import assert from "node:assert/strict";
import { findDuplicates, mergeFull, normalizeTitle, type PaperCard } from "../src/card";

function makeCard(overrides: Partial<PaperCard>): PaperCard {
  return {
    slug: "x",
    title: "X",
    authors: [],
    claims: [],
    limitations: [],
    relatedPapers: [],
    citationPurposes: [],
    reusableIdeas: [],
    nextActions: [],
    themes: [],
    created: "2025-01-01T00:00:00.000Z",
    updated: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ── normalizeTitle ────────────────────────────────────────────────────

test("normalizeTitle lowercases, strips punctuation, collapses whitespace", () => {
  assert.equal(normalizeTitle("Hello, World!"), "hello world");
  assert.equal(normalizeTitle("  A  Test [v2]  "), "a test v2");
  assert.equal(normalizeTitle("MemGPT: Towards LLMs as Operating Systems"), "memgpt towards llms as operating systems");
});

// ── findDuplicates ────────────────────────────────────────────────────

test("findDuplicates: exact DOI match is a hard hit; own slug is skipped", () => {
  const all = [makeCard({ slug: "a", title: "A paper", doi: "10.1234/x" }), makeCard({ slug: "b", title: "B paper", doi: "10.1234/x" })];
  const r = findDuplicates({ slug: "c", title: "Whatever", doi: "10.1234/x" }, all);
  assert.equal(r.hard.length, 2);
  assert.deepEqual(
    r.hard.map((d) => d.reason),
    ["doi", "doi"],
  );
  // self-collision (candidate.slug === card.slug) is skipped
  const r2 = findDuplicates({ slug: "a", title: "Whatever", doi: "10.1234/x" }, all);
  assert.equal(r2.hard.length, 1);
  assert.equal(r2.hard[0].slug, "b");
});

test("findDuplicates: arxivId match is hard, title near-match is soft", () => {
  const all = [
    makeCard({ slug: "a", title: "MemGPT: Towards LLMs as Operating Systems", arxivId: "2310.08560" }),
    makeCard({ slug: "b", title: "An unrelated paper" }),
  ];
  const hardR = findDuplicates({ slug: "c", title: "irrelevant", arxivId: "2310.08560" }, all);
  assert.equal(hardR.hard.length, 1);
  assert.equal(hardR.hard[0].reason, "arxivId");
  assert.equal(hardR.soft.length, 0);

  const softR = findDuplicates({ slug: "c", title: "memgpt towards llms as operating systems" }, all);
  assert.equal(softR.hard.length, 0);
  assert.equal(softR.soft.length, 1);
  assert.equal(softR.soft[0].reason, "title");
});

test("findDuplicates: nothing matches → both arrays empty", () => {
  const all = [makeCard({ slug: "a", title: "A paper", doi: "10.1234/x" })];
  const r = findDuplicates({ slug: "c", title: "Brand new", doi: "10.1234/different" }, all);
  assert.equal(r.hard.length, 0);
  assert.equal(r.soft.length, 0);
});

// ── mergeFull ─────────────────────────────────────────────────────────

test("mergeFull: array fields union-dedup; relational spine preserved when incoming is empty", () => {
  const existing = makeCard({
    slug: "mem-a",
    title: "Long-term memory",
    authors: ["Jane Doe"],
    themes: ["Agentic Memory"],
    claims: ["claim-1"],
    relationToMyWork: "baseline for my content store",
    citationPurposes: [{ purpose: "existing design", suggestedSection: "Related Work" }],
    created: "2025-01-01T00:00:00.000Z",
  });
  const merged = mergeFull(
    existing,
    {
      title: "Long-term memory (v2 metadata)",
      themes: ["Memory"],
      claims: ["claim-2"],
      year: 2024,
      // relationToMyWork omitted → existing must be preserved
      // citationPurposes omitted → existing must be preserved
    },
    "2025-06-01T00:00:00.000Z",
  );
  assert.equal(merged.slug, "mem-a");
  assert.equal(merged.title, "Long-term memory (v2 metadata)");
  assert.equal(merged.year, 2024);
  assert.deepEqual(merged.themes, ["Agentic Memory", "Memory"]);
  assert.deepEqual(merged.claims, ["claim-1", "claim-2"]);
  assert.equal(merged.relationToMyWork, "baseline for my content store");
  assert.equal(merged.citationPurposes.length, 1);
  assert.equal(merged.created, "2025-01-01T00:00:00.000Z");
  assert.equal(merged.updated, "2025-06-01T00:00:00.000Z");
});

test("mergeFull: incoming non-empty scalars override existing", () => {
  const existing = makeCard({ slug: "p", title: "Old title", venue: "ICLR", year: 2020 });
  const merged = mergeFull(existing, { title: "New title", venue: "NeurIPS", year: 2024 }, "2025-06-01T00:00:00.000Z");
  assert.equal(merged.title, "New title");
  assert.equal(merged.venue, "NeurIPS");
  assert.equal(merged.year, 2024);
});

test("mergeFull: incoming empty-string scalar does NOT clobber existing", () => {
  const existing = makeCard({ slug: "p", title: "Kept", relationToMyWork: "my baseline", venue: "ICLR" });
  const merged = mergeFull(existing, { title: "", relationToMyWork: "", venue: "" }, "2025-06-01T00:00:00.000Z");
  assert.equal(merged.title, "Kept");
  assert.equal(merged.relationToMyWork, "my baseline");
  assert.equal(merged.venue, "ICLR");
});

test("mergeFull: citationPurposes union-deduped by (purpose, suggestedSection)", () => {
  const existing = makeCard({
    slug: "p",
    title: "X",
    citationPurposes: [
      { purpose: "Cite for design", suggestedSection: "Related Work" },
      { purpose: "Cite for results", suggestedSection: "Discussion" },
    ],
  });
  const merged = mergeFull(
    existing,
    {
      citationPurposes: [
        { purpose: "Cite for design", suggestedSection: "Related Work" }, // duplicate
        { purpose: "Cite for design", suggestedSection: "Method" }, // different section → new
      ],
    },
    "2025-06-01T00:00:00.000Z",
  );
  assert.equal(merged.citationPurposes.length, 3);
});
