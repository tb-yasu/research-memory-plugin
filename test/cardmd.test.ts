// Pure tests for cardToMarkdown — the human-readable papers/<slug>.md
// mirror a wiki page links to instead of the raw JSON.

import test from "node:test";
import assert from "node:assert/strict";
import { cardToMarkdown, PaperCardSchema, type PaperCard } from "../src/card";

function card(p: Partial<PaperCard> & { slug: string; title: string }): PaperCard {
  return PaperCardSchema.parse({ created: "2024-01-01T00:00:00.000Z", updated: "2024-01-01T00:00:00.000Z", ...p });
}

test("renders title, byline, themes, Ochiai sections and the relational spine", () => {
  const md = cardToMarkdown(
    card({
      slug: "hipporag-2024",
      title: "HippoRAG",
      authors: ["A. Gutiérrez", "B. Roe"],
      year: 2024,
      venue: "NeurIPS",
      arxivId: "2405.14831",
      doi: "10.1/x",
      url: "https://example.com",
      themes: ["Agentic Memory", "RAG"],
      summary: "海馬に着想を得た RAG。",
      novelty: "知識グラフ＋PageRank。",
      claims: ["多ホップ検索に強い"],
      method: "PPR over a KG.",
      evaluation: "MuSiQue で検証。",
      limitations: ["グラフ構築コストが高い"],
      relatedPapers: ["RAPTOR"],
      relationToMyWork: "圧縮記憶の検索に流用できる。",
      researchContext: "compressed agent memory",
      citationPurposes: [{ purpose: "多ホップ検索の先行例", suggestedSection: "Related Work" }],
      reusableIdeas: ["PPR を記憶検索に転用"],
      nextActions: ["本文を再読"],
    }),
  );
  assert.match(md, /^# HippoRAG\n/);
  assert.match(md, /A\. Gutiérrez, B\. Roe \(2024\)\. NeurIPS · arXiv:2405\.14831 · DOI:10\.1\/x · https:\/\/example\.com/);
  assert.match(md, /- テーマ: Agentic Memory, RAG/);
  assert.match(md, /## 論文/);
  assert.match(md, /### 1\. どんなもの？\n海馬に着想を得た RAG。/);
  assert.match(md, /### 2\. 先行研究と比べてどこがすごい？\n知識グラフ＋PageRank。\n- 多ホップ検索に強い/);
  assert.match(md, /### 5\. 議論はあるか？\n- グラフ構築コストが高い/);
  assert.match(md, /## 自分の研究との接続/);
  assert.match(md, /### どの目的で引用できるか\n- 多ホップ検索の先行例 — Related Work/);
  assert.match(md, /### 次にやること\n- 本文を再読/);
  // No JSON braces leak into the rendered page.
  assert.ok(!md.includes("{"), "markdown must not contain JSON braces");
  assert.ok(md.endsWith("\n"));
});

test("omits empty sections — a bare card has a title and nothing else", () => {
  const md = cardToMarkdown(card({ slug: "bare", title: "Bare paper" }));
  assert.equal(md, "# Bare paper\n");
});

test("omits a section group when only the other group has content", () => {
  const md = cardToMarkdown(card({ slug: "spine-only", title: "Spine only", relationToMyWork: "competitor" }));
  assert.ok(!md.includes("## 論文"), "no paper section when all Ochiai fields are empty");
  assert.match(md, /## 自分の研究との接続/);
});
