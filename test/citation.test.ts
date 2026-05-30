import test from "node:test";
import assert from "node:assert/strict";
import { citationTable, toBibTeX, toMarkdownBundle, toReferenceList } from "../src/citation";
import { PaperCardSchema, type PaperCard } from "../src/card";

function card(p: Partial<PaperCard> & { slug: string; title: string }): PaperCard {
  return PaperCardSchema.parse({ created: "2024-01-01T00:00:00.000Z", updated: "2024-01-01T00:00:00.000Z", ...p });
}

const memA = card({
  slug: "mem-a",
  title: "Long-term memory",
  authors: ["Jane Doe", "John Roe"],
  year: 2024,
  venue: "NeurIPS",
  themes: ["Agentic Memory"],
  relationToMyWork: "baseline for my content store",
  citationPurposes: [
    { purpose: "existing long-term memory design", suggestedSection: "Related Work" },
    { purpose: "append-only structure", suggestedSection: "Method" },
  ],
});
const memB = card({ slug: "mem-b", title: "No purposes paper", themes: ["Agentic Memory"] });
const other = card({ slug: "other", title: "Off topic", themes: ["Something Else"] });

test("citationTable emits one row per citation purpose, theme-filtered", () => {
  const rows = citationTable([memA, memB, other], "Agentic Memory");
  // memA: 2 purposes, memB: 1 fallback row, other: excluded
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { slug: "mem-a", title: "Long-term memory", purpose: "existing long-term memory design", suggestedSection: "Related Work", relationToMyWork: "baseline for my content store" });
});

test("citationTable falls back to (unspecified) with em-dash section", () => {
  const rows = citationTable([memB], "Agentic Memory");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].purpose, "(unspecified)");
  assert.equal(rows[0].suggestedSection, "—");
});

test("toBibTeX builds a key from first author surname + year and core fields", () => {
  const bib = toBibTeX([memA]);
  assert.match(bib, /@article\{doe2024,/);
  assert.match(bib, /author = \{Jane Doe and John Roe\}/);
  assert.match(bib, /year = \{2024\}/);
  assert.match(bib, /booktitle = \{NeurIPS\}/);
});

test("toBibTeX uses @misc for arXiv-only entries", () => {
  const pre = card({ slug: "p", title: "Preprint", authors: ["Amy Ng"], year: 2025, arxivId: "2501.00001" });
  assert.match(toBibTeX([pre]), /@misc\{ng2025,/);
});

test("toReferenceList numbers entries", () => {
  const refs = toReferenceList([memA]);
  assert.match(refs, /^\[1\] Jane Doe, John Roe \(2024\)\. Long-term memory\./);
});

test("toMarkdownBundle uses the Ochiai structure + the relational spine", () => {
  const md = toMarkdownBundle([memA]);
  assert.match(md, /## Long-term memory/);
  assert.match(md, /### 1\. どんなもの？/);
  assert.match(md, /### 自分の研究との接続/);
  assert.match(md, /\*\*自分の研究との関係:\*\* baseline for my content store/);
  assert.match(md, /\*\*引用目的:\*\* existing long-term memory design — Related Work; append-only structure — Method/);
  assert.match(md, /### 論文情報・リンク/);
});
