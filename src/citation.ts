// Citation tooling — the payoff of the relational spine. Pure module:
// build a per-theme citation table and export BibTeX / a reference list /
// a markdown bundle. All deterministic string work; unit-tested.

import type { CitationPurpose, PaperCard } from "./card";

export interface CitationRow {
  slug: string;
  title: string;
  purpose: string;
  suggestedSection: string;
  relationToMyWork: string;
}

export function citationTable(cards: PaperCard[], theme: string): CitationRow[] {
  const rows: CitationRow[] = [];
  for (const card of cards) {
    if (!card.themes.includes(theme)) continue;
    const purposes: CitationPurpose[] = card.citationPurposes.length > 0 ? card.citationPurposes : [{ purpose: "(unspecified)" }];
    for (const p of purposes) {
      rows.push({ slug: card.slug, title: card.title, purpose: p.purpose, suggestedSection: p.suggestedSection ?? "—", relationToMyWork: card.relationToMyWork ?? "" });
    }
  }
  return rows;
}

function bibKey(card: PaperCard): string {
  const surname = (card.authors[0] ?? "anon").split(/\s+/).pop() ?? "anon";
  const clean = surname.toLowerCase().replace(/[^a-z0-9]/g, "") || "anon";
  return `${clean}${card.year ?? ""}`;
}

function bibEntry(card: PaperCard): string {
  const fields: string[] = [`  title = {${card.title}}`];
  if (card.authors.length > 0) fields.push(`  author = {${card.authors.join(" and ")}}`);
  if (card.year !== undefined) fields.push(`  year = {${card.year}}`);
  if (card.venue) fields.push(`  booktitle = {${card.venue}}`);
  if (card.doi) fields.push(`  doi = {${card.doi}}`);
  if (card.arxivId) fields.push(`  eprint = {${card.arxivId}}`);
  if (card.url) fields.push(`  url = {${card.url}}`);
  const type = card.arxivId && !card.venue ? "misc" : "article";
  return `@${type}{${bibKey(card)},\n${fields.join(",\n")}\n}`;
}

export function toBibTeX(cards: PaperCard[]): string {
  return cards.map(bibEntry).join("\n\n");
}

function refLine(card: PaperCard): string {
  const authors = card.authors.length > 0 ? card.authors.join(", ") : "Unknown";
  const year = card.year !== undefined ? ` (${card.year})` : "";
  const venue = card.venue ? ` ${card.venue}.` : "";
  return `${authors}${year}. ${card.title}.${venue}`;
}

export function toReferenceList(cards: PaperCard[]): string {
  return cards.map((card, i) => `[${i + 1}] ${refLine(card)}`).join("\n");
}

function bullets(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

// The paper, as the Ochiai 6-question reading note.
function ochiaiSection(card: PaperCard): string {
  const novelty = [card.novelty ?? "", card.claims.length > 0 ? bullets(card.claims) : ""].filter(Boolean).join("\n\n");
  return [
    `### 1. どんなもの？\n${card.summary ?? ""}`,
    `### 2. 先行研究と比べてどこがすごい？\n${novelty}`,
    `### 3. 技術・手法のキモ\n${card.method ?? ""}`,
    `### 4. どうやって有効だと検証した？\n${card.evaluation ?? ""}`,
    `### 5. 議論はあるか？\n${card.limitations.length > 0 ? bullets(card.limitations) : ""}`,
    `### 6. 次に読むべき論文\n${card.relatedPapers.length > 0 ? bullets(card.relatedPapers) : ""}`,
  ].join("\n\n");
}

// The relational spine — the differentiator the Ochiai template lacks.
function connectionSection(card: PaperCard): string {
  const lines: string[] = ["### 自分の研究との接続"];
  if (card.relationToMyWork) lines.push(`**自分の研究との関係:** ${card.relationToMyWork}`);
  if (card.researchContext) lines.push(`（研究文脈: ${card.researchContext}）`);
  if (card.citationPurposes.length > 0) lines.push(`**引用目的:** ${card.citationPurposes.map((p) => (p.suggestedSection ? `${p.purpose} — ${p.suggestedSection}` : p.purpose)).join("; ")}`);
  if (card.reusableIdeas.length > 0) lines.push(`**使えるアイデア:** ${card.reusableIdeas.join("; ")}`);
  if (card.nextActions.length > 0) lines.push(`**次のアクション:** ${card.nextActions.join("; ")}`);
  return lines.join("\n\n");
}

function infoSection(card: PaperCard): string {
  const cite = `${card.authors.join(", ")}, "${card.title}," ${card.venue ?? ""}${card.year !== undefined ? `, ${card.year}` : ""}`.replace(/\s+,/g, ",").replace(/\s+$/, "");
  const link = card.url ? `- [${cite}](${card.url})` : `- ${cite}`;
  const themes = card.themes.length > 0 ? `\n- テーマ: ${card.themes.join(", ")}` : "";
  return `### 論文情報・リンク\n${link}${themes}`;
}

function cardToMarkdown(card: PaperCard): string {
  const byline = `${card.authors.join(", ")}${card.year !== undefined ? ` (${card.year})` : ""}${card.venue ? ` · ${card.venue}` : ""}`.trim();
  return [`## ${card.title}`, byline ? `*${byline}*` : "", ochiaiSection(card), connectionSection(card), infoSection(card)].filter(Boolean).join("\n\n");
}

export function toMarkdownBundle(cards: PaperCard[]): string {
  return cards.map(cardToMarkdown).join("\n\n---\n\n");
}
