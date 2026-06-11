// Pure tests for src/ideate.ts — gatherIdeationMaterial.

import test from "node:test";
import assert from "node:assert/strict";
import { gatherIdeationMaterial } from "../src/ideate";
import { PaperCardSchema, type PaperCard } from "../src/card";
import { EMPTY_PROFILE, type ResearchProfile } from "../src/profile";

function card(slug: string, fields: Record<string, unknown> = {}): PaperCard {
  return PaperCardSchema.parse({ slug, title: `Title of ${slug}`, created: "2026-01-01T00:00:00Z", updated: "2026-01-01T00:00:00Z", ...fields });
}

const PROFILE: ResearchProfile = { focus: "compressed agent memory", themes: ["Agentic Memory"], questions: ["dynamic index?"], updated: "2026-01-01T00:00:00Z" };

test("material exposes only ideation fields — bibliographic/writing-time fields excluded", () => {
  const rich = card("a", {
    authors: ["Jane Doe"],
    venue: "NeurIPS",
    url: "https://example.com",
    doi: "10.1/x",
    arxivId: "2401.00001",
    summary: "s",
    novelty: "n",
    claims: ["c1"],
    method: "m",
    evaluation: "e",
    limitations: ["l1"],
    relatedPapers: ["other"],
    relationToMyWork: "r",
    researchContext: "ctx",
    citationPurposes: [{ purpose: "p" }],
    reusableIdeas: ["i1"],
    nextActions: ["n1"],
    themes: ["T"],
  });
  const [m] = gatherIdeationMaterial([rich], EMPTY_PROFILE).papers;
  const keys = Object.keys(m).sort();
  assert.deepEqual(keys, ["arxivId", "evaluation", "limitations", "method", "nextActions", "novelty", "relationToMyWork", "reusableIdeas", "slug", "summary", "themes", "title", "year"].sort());
  for (const banned of ["authors", "venue", "url", "doi", "citationPurposes", "relatedPapers", "claims", "researchContext", "created", "updated"]) {
    assert.ok(!(banned in m), `${banned} must not leak into ideation material`);
  }
});

test("prose fields are flattened to one line; empty strings become undefined", () => {
  const [m] = gatherIdeationMaterial([card("a", { summary: "line one\n  line two", novelty: "   " })], EMPTY_PROFILE).papers;
  assert.equal(m.summary, "line one line two");
  assert.equal(m.novelty, undefined);
});

test("sharedThemes keeps only themes on >=2 cards, count desc then alphabetical", () => {
  const cards = [
    card("a", { themes: ["Memory", "Index"] }),
    card("b", { themes: ["Memory", "Index", "Solo"] }),
    card("c", { themes: ["Memory", "Agents"] }),
    card("d", { themes: ["Agents"] }),
  ];
  // Memory ×3; Agents ×2, Index ×2 (tie → alphabetical); Solo ×1 dropped.
  assert.deepEqual(gatherIdeationMaterial(cards, EMPTY_PROFILE).sharedThemes, ["Memory", "Agents", "Index"]);
});

test("thinCards lists only cards with no limitations, reusableIdeas, AND nextActions", () => {
  const cards = [
    card("thin"),
    card("has-limit", { limitations: ["l"] }),
    card("has-idea", { reusableIdeas: ["i"] }),
    card("has-action", { nextActions: ["n"] }),
  ];
  assert.deepEqual(gatherIdeationMaterial(cards, EMPTY_PROFILE).thinCards, ["thin"]);
});

test("profile maps to null when entirely empty, to {focus,themes,questions} otherwise", () => {
  assert.equal(gatherIdeationMaterial([], EMPTY_PROFILE).profile, null);
  assert.deepEqual(gatherIdeationMaterial([], PROFILE).profile, { focus: "compressed agent memory", themes: ["Agentic Memory"], questions: ["dynamic index?"] });
});

test("input card order is preserved", () => {
  const out = gatherIdeationMaterial([card("z"), card("a"), card("m")], EMPTY_PROFILE);
  assert.deepEqual(
    out.papers.map((p) => p.slug),
    ["z", "a", "m"],
  );
});
