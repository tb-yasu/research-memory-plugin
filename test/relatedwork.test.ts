import test from "node:test";
import assert from "node:assert/strict";
import { buildRelatedWorkOutline, relatedWorkToMarkdown, themeSlug } from "../src/relatedwork";
import { PaperCardSchema, type PaperCard } from "../src/card";

function card(p: Partial<PaperCard> & { slug: string; title: string }): PaperCard {
  return PaperCardSchema.parse({ created: "2024-01-01T00:00:00.000Z", updated: "2024-01-01T00:00:00.000Z", ...p });
}

const THEME = "Agentic Memory";

// Memory Architecture co-theme: 3 papers (incl. `both`); Memory Retrieval: 2 (incl. `both`).
const arch1 = card({ slug: "arch-2021", title: "Early architecture", year: 2021, themes: [THEME, "Memory Architecture"], relationToMyWork: "arch papers contrast with my structured store" });
const arch2 = card({
  slug: "arch-2023",
  title: "Later architecture",
  authors: ["Jane Doe", "John Roe"],
  year: 2023,
  venue: "NeurIPS",
  themes: [THEME, "Memory Architecture"],
  relationToMyWork: "arch papers contrast with my structured store", // duplicate point — deduped
  citationPurposes: [
    { purpose: "self-managed memory exemplar", suggestedSection: "Method" },
    { purpose: "memory hierarchy prior work", suggestedSection: "Related Work" },
  ],
});
const both = card({ slug: "both-2022", title: "Bridges both", year: 2022, themes: [THEME, "Memory Retrieval", "Memory Architecture"], citationPurposes: [{ purpose: "spans both lines" }] });
const retr = card({ slug: "retr-2024", title: "Retrieval scoring", year: 2024, themes: [THEME, "Memory Retrieval"], relationToMyWork: "retrieval scoring is hand-tuned; mine is structural", citationPurposes: [{ purpose: "retrieval prior work", suggestedSection: "Related Work" }] });
const noYear = card({ slug: "no-year", title: "Undated paper", themes: [THEME] });
const offTopic = card({ slug: "off-topic", title: "Off topic", year: 2020, themes: ["Something Else"] });

const ALL = [arch2, retr, noYear, both, arch1, offTopic]; // deliberately shuffled

test("groups by co-theme (count desc), assigns multi-co-theme papers to the largest group, fallback last", () => {
  const outline = buildRelatedWorkOutline(ALL, THEME);
  assert.equal(outline.paperCount, 5);
  assert.deepEqual(
    outline.groups.map((g) => g.label),
    ["Memory Architecture", "Memory Retrieval", null],
  );
  // `both` has both co-themes → lands in Memory Architecture (3 > 2), not Retrieval.
  assert.deepEqual(outline.groups[0].entries.map((e) => e.slug), ["arch-2021", "both-2022", "arch-2023"]);
  assert.deepEqual(outline.groups[1].entries.map((e) => e.slug), ["retr-2024"]);
  assert.deepEqual(outline.groups[2].entries.map((e) => e.slug), ["no-year"]);
});

test("orders papers chronologically within a group; no-year papers sort last in-theme", () => {
  const undatedArch = card({ slug: "undated-arch", title: "Undated arch", themes: [THEME, "Memory Architecture"] });
  const outline = buildRelatedWorkOutline([arch2, undatedArch, arch1], THEME);
  assert.deepEqual(outline.groups[0].entries.map((e) => e.slug), ["arch-2021", "arch-2023", "undated-arch"]);
});

test("labels each group point with its paper and skips empty relationToMyWork", () => {
  const outline = buildRelatedWorkOutline(ALL, THEME);
  // arch1 + arch2 each contribute a labelled point (chronological order); `both` has none.
  assert.deepEqual(
    outline.groups[0].points.map((p) => ({ slug: p.slug, title: p.title })),
    [
      { slug: "arch-2021", title: "Early architecture" },
      { slug: "arch-2023", title: "Later architecture" },
    ],
  );
  assert.ok(outline.groups[0].points.every((p) => p.text === "arch papers contrast with my structured store"));
  assert.deepEqual(outline.groups[2].points, []);
});

test("carries the research focus through to the outline and markdown", () => {
  const outline = buildRelatedWorkOutline(ALL, THEME, "dynamic compressed content store");
  assert.equal(outline.focus, "dynamic compressed content store");
  assert.match(relatedWorkToMarkdown(outline), /\*\*自分の研究:\*\* dynamic compressed content store/);
  const without = buildRelatedWorkOutline(ALL, THEME);
  assert.equal(without.focus, null);
  assert.doesNotMatch(relatedWorkToMarkdown(without), /\*\*自分の研究:\*\*/);
});

test("sorts each paper's purposes Related Work first; section-less last", () => {
  const outline = buildRelatedWorkOutline(ALL, THEME);
  const later = outline.groups[0].entries.find((e) => e.slug === "arch-2023");
  assert.deepEqual(
    later?.purposes.map((p) => p.suggestedSection),
    ["Related Work", "Method"],
  );
  const mixed = card({ slug: "mixed", title: "Mixed", themes: [THEME], citationPurposes: [{ purpose: "free-floating" }, { purpose: "intro hook", suggestedSection: "Introduction" }] });
  const single = buildRelatedWorkOutline([mixed], THEME);
  assert.deepEqual(
    single.groups[0].entries[0].purposes.map((p) => p.purpose),
    ["intro hook", "free-floating"],
  );
});

test("gist prefers novelty over summary and flattens newlines into one markdown-safe line", () => {
  const withNovelty = card({ slug: "g1", title: "G1", themes: [THEME], novelty: "line one\nline two", summary: "fallback" });
  const withSummary = card({ slug: "g2", title: "G2", themes: [THEME], summary: "just the summary" });
  const bare = card({ slug: "g3", title: "G3", themes: [THEME] });
  const outline = buildRelatedWorkOutline([withNovelty, withSummary, bare], THEME);
  const bySlug = (slug: string) => outline.groups[0].entries.find((e) => e.slug === slug);
  assert.equal(bySlug("g1")?.gist, "line one line two");
  assert.equal(bySlug("g2")?.gist, "just the summary");
  assert.equal(bySlug("g3")?.gist, undefined);
  assert.match(relatedWorkToMarkdown(outline), /^ {2}- 要点: line one line two$/m);
});

test("collects papers without citation purposes as gaps, in chronological order", () => {
  const outline = buildRelatedWorkOutline(ALL, THEME);
  assert.deepEqual(outline.gaps.map((g) => g.slug), ["arch-2021", "no-year"]);
});

test("breaks co-theme count ties alphabetically", () => {
  const x = card({ slug: "x", title: "X", year: 2021, themes: [THEME, "B Theme"] });
  const y = card({ slug: "y", title: "Y", year: 2022, themes: [THEME, "A Theme"] });
  const outline = buildRelatedWorkOutline([x, y], THEME);
  assert.deepEqual(outline.groups.map((g) => g.label), ["A Theme", "B Theme"]);
});

test("themeSlug is filesystem-safe and deterministic", () => {
  assert.equal(themeSlug("Agentic Memory"), "agentic-memory");
  assert.equal(themeSlug("  Memory / Retrieval!!  "), "memory-retrieval");
  assert.equal(themeSlug("エージェント記憶"), "エージェント記憶");
  assert.equal(themeSlug("***"), "theme");
});

test("empty theme yields an empty outline and a placeholder markdown", () => {
  const outline = buildRelatedWorkOutline([offTopic], THEME);
  assert.equal(outline.paperCount, 0);
  assert.deepEqual(outline.groups, []);
  const md = relatedWorkToMarkdown(outline);
  assert.match(md, /^# Related Work アウトライン — Agentic Memory/);
  assert.match(md, /このテーマの論文はまだありません/);
});

test("markdown renders title, group headers, points, bylines, purposes, and the gaps note", () => {
  const md = relatedWorkToMarkdown(buildRelatedWorkOutline(ALL, THEME));
  assert.match(md, /^# Related Work アウトライン — Agentic Memory/);
  assert.match(md, /5本 \/ 3グループ/);
  assert.match(md, /## 1\. Memory Architecture（3本）/);
  assert.match(md, /## 3\. その他（共起テーマなし）（1本）/);
  assert.match(md, /\*\*論点（自分の研究との対比）:\*\*\n\n- \*\*Early architecture\*\* — arch papers contrast with my structured store/);
  assert.match(md, /- \*\*Later architecture\*\*（Jane Doe et al\., 2023, NeurIPS）/);
  assert.match(md, /  - 引用目的: memory hierarchy prior work（Related Work）/);
  assert.match(md, /  - 引用目的: （未記入）/);
  assert.match(md, /> ⚠ 引用目的が未記入: Early architecture／Undated paper/);
});
