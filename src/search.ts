// Deterministic search / filter / ranking over Paper Cards. Pure module,
// no ML — keyword match + recency. The LLM does natural-language
// understanding; relevance here is plain, explainable, and testable.

import type { PaperCard } from "./card";

export type SortMode = "recency" | "relevance" | "title";

// Themes are deliberately excluded — theme narrowing is the dedicated
// filter; free-text query stays orthogonal to theme names.
function cardText(card: PaperCard): string {
  return [card.title, card.summary ?? "", card.novelty ?? "", card.relationToMyWork ?? "", card.researchContext ?? "", card.method ?? "", card.evaluation ?? "", ...card.authors, ...card.claims, ...card.reusableIdeas]
    .join(" ")
    .toLowerCase();
}

export function filterCards(cards: PaperCard[], opts: { query?: string; theme?: string }): PaperCard[] {
  let out = cards;
  if (opts.theme) {
    const theme = opts.theme;
    out = out.filter((card) => card.themes.includes(theme));
  }
  if (opts.query && opts.query.trim()) {
    const q = opts.query.toLowerCase();
    out = out.filter((card) => cardText(card).includes(q));
  }
  return out;
}

function relevanceScore(card: PaperCard, terms: string[]): number {
  const title = card.title.toLowerCase();
  const text = cardText(card);
  let score = 0;
  for (const term of terms) {
    if (title.includes(term)) score += 3;
    else if (text.includes(term)) score += 1;
  }
  return score;
}

function byRecency(a: PaperCard, b: PaperCard): number {
  return b.updated.localeCompare(a.updated);
}

export function rankCards(cards: PaperCard[], query: string): PaperCard[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return [...cards]
    .map((card) => ({ card, score: relevanceScore(card, terms) }))
    .sort((a, b) => b.score - a.score || byRecency(a.card, b.card))
    .map((entry) => entry.card);
}

export function sortCards(cards: PaperCard[], sort: SortMode | undefined, query?: string): PaperCard[] {
  if (sort === "relevance" && query && query.trim()) return rankCards(cards, query);
  if (sort === "title") return [...cards].sort((a, b) => a.title.localeCompare(b.title));
  return [...cards].sort(byRecency);
}
