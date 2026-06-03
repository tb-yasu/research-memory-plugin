import test from "node:test";
import assert from "node:assert/strict";
import { filterCards, rankCards, sortCards } from "../src/search";
import { PaperCardSchema, type PaperCard } from "../src/card";

function card(p: Partial<PaperCard> & { slug: string; title: string }): PaperCard {
  return PaperCardSchema.parse({ created: "2024-01-01T00:00:00.000Z", updated: "2024-01-01T00:00:00.000Z", ...p });
}

const a = card({ slug: "a", title: "Memory systems for agents", themes: ["Agentic Memory"], updated: "2024-03-01T00:00:00.000Z" });
const b = card({ slug: "b", title: "Compressed indexing", summary: "A study of memory-efficient indexes", themes: ["Compressed Indexing"], updated: "2024-02-01T00:00:00.000Z" });
const c = card({ slug: "c", title: "Recourse costs", themes: ["Agentic Memory", "Recourse"], updated: "2024-01-15T00:00:00.000Z" });
const cards = [a, b, c];

test("filterCards by theme keeps only matching cards", () => {
  const out = filterCards(cards, { theme: "Agentic Memory" });
  assert.deepEqual(out.map((x) => x.slug).sort(), ["a", "c"]);
});

test("filterCards by query matches title and body text", () => {
  assert.deepEqual(filterCards(cards, { query: "indexing" }).map((x) => x.slug), ["b"]);
  // "memory" appears in a.title and b.summary
  assert.deepEqual(filterCards(cards, { query: "memory" }).map((x) => x.slug).sort(), ["a", "b"]);
});

test("filterCards combines theme and query (AND)", () => {
  assert.deepEqual(filterCards(cards, { theme: "Agentic Memory", query: "memory" }).map((x) => x.slug), ["a"]);
});

test("sortCards recency orders by updated desc", () => {
  assert.deepEqual(sortCards(cards, "recency").map((x) => x.slug), ["a", "b", "c"]);
});

test("sortCards title orders alphabetically", () => {
  assert.deepEqual(sortCards(cards, "title").map((x) => x.slug), ["b", "a", "c"]);
});

test("rankCards scores title hits above body hits", () => {
  // query "memory": a has it in the title (score 3), b in the summary (score 1)
  assert.deepEqual(rankCards([b, a], "memory").map((x) => x.slug), ["a", "b"]);
});

test("rankCards via sortCards relevance needs a query", () => {
  assert.deepEqual(sortCards([b, a], "relevance", "memory").map((x) => x.slug), ["a", "b"]);
});

test("filterCards by yearFrom keeps papers published in that year or later; drops undated", () => {
  const old = card({ slug: "old", title: "FM-index", year: 2005 });
  const mid = card({ slug: "mid", title: "Mid", year: 2020 });
  const recent = card({ slug: "recent", title: "Dynamic r-index", year: 2025 });
  const undated = card({ slug: "undated", title: "No year" });
  const set = [old, mid, recent, undated];
  assert.deepEqual(filterCards(set, { yearFrom: 2025 }).map((x) => x.slug), ["recent"]);
  assert.deepEqual(filterCards(set, { yearFrom: 2020 }).map((x) => x.slug).sort(), ["mid", "recent"]);
  assert.equal(filterCards(set, { yearFrom: 2000 }).some((x) => x.slug === "undated"), false);
});

test("filterCards combines theme and yearFrom (the reported 2025+ Compressed Indexing case)", () => {
  const fm = card({ slug: "fm", title: "FM-index", year: 2005, themes: ["Compressed Indexing"] });
  const jx = card({ slug: "jx", title: "jXBW", year: 2025, themes: ["Compressed Indexing"] });
  const mem = card({ slug: "mem", title: "MemGPT", year: 2023, themes: ["Agentic Memory"] });
  assert.deepEqual(filterCards([fm, jx, mem], { theme: "Compressed Indexing", yearFrom: 2025 }).map((x) => x.slug), ["jx"]);
});
