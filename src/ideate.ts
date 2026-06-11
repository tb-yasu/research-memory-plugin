// Ideation material — deterministically gather, from a selection of
// Paper Cards + the research profile, the compact material the chat LLM
// needs to generate next-research ideas. The plugin does NO ideation —
// it only collects; the intelligence lives in the LLM, steered by the
// tool description and the handler's message. Pure module, no I/O.

import type { PaperCard } from "./card";
import type { ResearchProfile } from "./profile";

/** Per-card ideation fuel. Deliberately EXCLUDED card fields:
 *  authors/venue/url/doi/arxivId (bibliographic — irrelevant to ideation;
 *  the handler surfaces arxivId separately for the full-text mining step),
 *  citationPurposes (a writing-time concern), relatedPapers (titles of
 *  papers NOT in the store — ungroundable), claims (sub-bullets subsumed
 *  by novelty), researchContext (redundant with profile + relation). */
export interface IdeationCardMaterial {
  slug: string;
  title: string;
  year?: number;
  arxivId?: string; // for the idea-miner full-text pass, not for ideation prose
  summary?: string;
  novelty?: string;
  method?: string;
  evaluation?: string; // feeds first-experiment design (datasets/metrics to reuse)
  limitations: string[]; // prime fuel: limitation-as-opportunity
  reusableIdeas: string[]; // prime fuel: explicitly captured borrowable techniques
  nextActions: string[]; // prime fuel: the user's own recorded follow-ups
  relationToMyWork?: string; // anchors ideas in MY research, not generic novelty
  themes: string[];
}

export interface IdeationProfile {
  focus: string;
  themes: string[];
  questions: string[];
}

export interface IdeationMaterial {
  /** null when the profile is entirely empty — the LLM should note it. */
  profile: IdeationProfile | null;
  /** Selection order preserved — the caller controls it. */
  papers: IdeationCardMaterial[];
  /** Themes shared by >=2 selected cards (count desc, then alpha) — combination axes. */
  sharedThemes: string[];
  /** Slugs whose limitations, reusableIdeas, AND nextActions are all empty — thin material. */
  thinCards: string[];
}

function oneLine(s: string | undefined): string | undefined {
  const flat = s?.replace(/\s*\n+\s*/g, " ").trim();
  return flat ? flat : undefined;
}

function toMaterial(card: PaperCard): IdeationCardMaterial {
  return {
    slug: card.slug,
    title: card.title,
    year: card.year,
    arxivId: card.arxivId,
    summary: oneLine(card.summary),
    novelty: oneLine(card.novelty),
    method: oneLine(card.method),
    evaluation: oneLine(card.evaluation),
    limitations: card.limitations,
    reusableIdeas: card.reusableIdeas,
    nextActions: card.nextActions,
    relationToMyWork: oneLine(card.relationToMyWork),
    themes: card.themes,
  };
}

function sharedThemesOf(cards: PaperCard[]): string[] {
  const counts = new Map<string, number>();
  for (const card of cards) {
    for (const theme of card.themes) counts.set(theme, (counts.get(theme) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([theme]) => theme);
}

function isThin(card: PaperCard): boolean {
  return card.limitations.length === 0 && card.reusableIdeas.length === 0 && card.nextActions.length === 0;
}

function toProfile(profile: ResearchProfile): IdeationProfile | null {
  if (!profile.focus && profile.themes.length === 0 && profile.questions.length === 0) return null;
  return { focus: profile.focus, themes: profile.themes, questions: profile.questions };
}

export function gatherIdeationMaterial(cards: PaperCard[], profile: ResearchProfile): IdeationMaterial {
  return {
    profile: toProfile(profile),
    papers: cards.map(toMaterial),
    sharedThemes: sharedThemesOf(cards),
    thinCards: cards.filter(isThin).map((card) => card.slug),
  };
}
