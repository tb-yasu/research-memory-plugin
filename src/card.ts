// Paper Card — the core data model. A paper you read, captured as
// reusable, research-connected memory. Pure module: schema + (de)serialize
// + slug validation + partial merge. No I/O, no Date — the server entry
// (index.ts) supplies timestamps so this stays trivially unit-testable.

import { z } from "zod";

// Where a paper can be cited in YOUR writing. Drives the citation table.
export const SUGGESTED_SECTIONS = ["Introduction", "Related Work", "Method", "Experiments", "Discussion", "Limitations"] as const;
export type SuggestedSection = (typeof SUGGESTED_SECTIONS)[number];

export const CitationPurposeSchema = z.object({
  purpose: z.string(),
  suggestedSection: z.enum(SUGGESTED_SECTIONS).optional(),
  note: z.string().optional(),
});
export type CitationPurpose = z.infer<typeof CitationPurposeSchema>;

export const PaperCardSchema = z.object({
  slug: z.string(),
  title: z.string(),
  authors: z.array(z.string()).default([]),
  year: z.number().int().optional(),
  venue: z.string().optional(),
  url: z.string().optional(),
  doi: z.string().optional(),
  arxivId: z.string().optional(),
  // The paper itself, organized as the Ochiai 6-question reading template.
  summary: z.string().optional(), //         1. どんなもの？
  novelty: z.string().optional(), //         2. 先行研究と比べてどこがすごい？
  claims: z.array(z.string()).default([]), // supporting bullets under (2)
  method: z.string().optional(), //          3. 技術・手法のキモ
  evaluation: z.string().optional(), //      4. どうやって有効だと検証した？
  limitations: z.array(z.string()).default([]), // 5. 議論はあるか？
  relatedPapers: z.array(z.string()).default([]), // 6. 次に読むべき論文
  // ★ The relational spine — what makes this not a summary tool.
  relationToMyWork: z.string().optional(),
  researchContext: z.string().optional(),
  citationPurposes: z.array(CitationPurposeSchema).default([]),
  reusableIdeas: z.array(z.string()).default([]),
  nextActions: z.array(z.string()).default([]),
  themes: z.array(z.string()).default([]),
  created: z.string(),
  updated: z.string(),
});
export type PaperCard = z.infer<typeof PaperCardSchema>;

// The card-shaped fields a caller may patch (slug is the identity;
// created/updated are owned by the store).
export type CardPatch = Partial<Omit<PaperCard, "slug" | "created" | "updated">>;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= 100 && SLUG_RE.test(slug);
}

export function serializeCard(card: PaperCard): string {
  return JSON.stringify(card, null, 2) + "\n";
}

export function parseCard(raw: string): PaperCard | null {
  try {
    return PaperCardSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

// Overlay only the defined keys of `patch` onto `existing`, stamping a
// fresh `updated`. An omitted key keeps its on-disk value — so a
// themes-only update never wipes `relationToMyWork`.
export function mergeCard(existing: PaperCard, patch: CardPatch, updated: string): PaperCard {
  const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<PaperCard>;
  return { ...existing, ...defined, updated };
}
