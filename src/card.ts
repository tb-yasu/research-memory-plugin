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

// ── Human-readable mirror (papers/<slug>.md) ─────────────────────────
// A clean Markdown render of the card — the Ochiai 6-question template +
// the relational spine — so a wiki page (or any file browser) can link to
// papers/<slug>.md and read the card without seeing the JSON source. JSON
// stays the store of record; index.ts regenerates this on every write,
// mirroring the ideas/<slug>.md pattern. Pure (no I/O). Empty sections are
// omitted so the page stays tight. Labels match the canvas View (ja).

/** "Authors (Year). Venue. arXiv:id · DOI · URL" — only the parts present. */
function cardByline(card: PaperCard): string {
  const who = card.authors.length > 0 ? card.authors.join(", ") : "";
  const head = [who, card.year != null ? `(${card.year})` : ""].filter(Boolean).join(" ");
  const ids = [card.venue, card.arxivId ? `arXiv:${card.arxivId}` : "", card.doi ? `DOI:${card.doi}` : "", card.url].filter(Boolean);
  return [head, ids.join(" · ")].filter(Boolean).join(". ");
}

export function cardToMarkdown(card: PaperCard): string {
  const out: string[] = [`# ${card.title}`];
  const byline = cardByline(card);
  if (byline) out.push("", `*${byline}*`);
  if (card.themes.length > 0) out.push("", `- テーマ: ${card.themes.join(", ")}`);

  const para = (heading: string, body: string | undefined): void => {
    if (body && body.trim()) out.push("", `### ${heading}`, body.trim());
  };
  const list = (heading: string, items: string[]): void => {
    if (items.length > 0) out.push("", `### ${heading}`, ...items.map((i) => `- ${i}`));
  };

  const hasPaper = card.summary || card.novelty || card.claims.length || card.method || card.evaluation || card.limitations.length || card.relatedPapers.length;
  if (hasPaper) out.push("", "## 論文");
  para("1. どんなもの？", card.summary);
  if (card.novelty || card.claims.length) {
    para("2. 先行研究と比べてどこがすごい？", card.novelty);
    if (card.claims.length > 0) out.push(...card.claims.map((c) => `- ${c}`));
  }
  para("3. 技術・手法のキモ", card.method);
  para("4. どうやって有効だと検証した？", card.evaluation);
  list("5. 議論はあるか？", card.limitations);
  list("6. 次に読むべき論文", card.relatedPapers);

  const hasSpine = card.relationToMyWork || card.researchContext || card.citationPurposes.length || card.reusableIdeas.length || card.nextActions.length;
  if (hasSpine) out.push("", "## 自分の研究との接続");
  para("自分の研究・開発にどう関係するか", card.relationToMyWork);
  para("研究文脈", card.researchContext);
  if (card.citationPurposes.length > 0) {
    out.push("", "### どの目的で引用できるか", ...card.citationPurposes.map((cp) => `- ${cp.purpose}${cp.suggestedSection ? ` — ${cp.suggestedSection}` : ""}`));
  }
  list("再利用できる考え方", card.reusableIdeas);
  list("次にやること", card.nextActions);

  return out.join("\n") + "\n";
}

// ── Theme rename ─────────────────────────────────────────────────────

/** themes 内の from を to に置換した新配列を返す。from を含まなければ null
 *  （変更なし＝書き込み不要）。to が既存なら順序を保って de-dup する。 */
export function applyThemeRename(themes: string[], from: string, to: string): string[] | null {
  if (!themes.includes(from)) return null;
  return [...new Set(themes.map((t) => (t === from ? to : t)))];
}

// ── Duplicate detection ──────────────────────────────────────────────

/** Lowercase, strip punctuation, collapse whitespace. Used for fuzzy
 *  title comparison only — the canonical store key is still `slug`. */
export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface DupHit {
  slug: string;
  title: string;
  reason: "doi" | "arxivId" | "title";
}

export interface DupResult {
  hard: DupHit[];
  soft: DupHit[];
}

/** Scan `all` for a card that collides with `candidate` (skipping the
 *  candidate's own slug). `doi` or `arxivId` exact match → hard; same
 *  normalized title → soft. */
export function findDuplicates(candidate: { slug: string; title?: string; doi?: string; arxivId?: string }, all: PaperCard[]): DupResult {
  const hard: DupHit[] = [];
  const soft: DupHit[] = [];
  const seen = new Set<string>();
  const candTitle = candidate.title ? normalizeTitle(candidate.title) : "";
  for (const card of all) {
    if (card.slug === candidate.slug) continue;
    let pushed: DupHit["reason"] | null = null;
    if (candidate.doi && card.doi && card.doi === candidate.doi) pushed = "doi";
    else if (candidate.arxivId && card.arxivId && card.arxivId === candidate.arxivId) pushed = "arxivId";
    if (pushed) {
      if (!seen.has(card.slug)) {
        hard.push({ slug: card.slug, title: card.title, reason: pushed });
        seen.add(card.slug);
      }
      continue;
    }
    if (candTitle && normalizeTitle(card.title) === candTitle) {
      if (!seen.has(card.slug)) {
        soft.push({ slug: card.slug, title: card.title, reason: "title" });
        seen.add(card.slug);
      }
    }
  }
  return { hard, soft };
}

// ── Two-card merge ───────────────────────────────────────────────────

function unionDedup<T>(a: readonly T[], b: readonly T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of [...a, ...b]) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

function preferNonEmpty(incoming: string | undefined, existing: string | undefined): string | undefined {
  if (typeof incoming === "string" && incoming.length > 0) return incoming;
  return existing;
}

/** Merge `incoming` into `existing`, preserving the relational spine.
 *  Arrays union-dedup; scalars prefer non-empty `incoming` over
 *  `existing`; `created` carried from `existing`; `updated` stamped. */
export function mergeFull(existing: PaperCard, incoming: Partial<PaperCard>, updated: string): PaperCard {
  const cpKey = (cp: CitationPurpose): string => `${cp.purpose}|${cp.suggestedSection ?? ""}`;
  return {
    slug: existing.slug,
    title: preferNonEmpty(incoming.title, existing.title) ?? existing.title,
    authors: unionDedup(existing.authors, incoming.authors ?? [], (x) => x),
    year: incoming.year ?? existing.year,
    venue: preferNonEmpty(incoming.venue, existing.venue),
    url: preferNonEmpty(incoming.url, existing.url),
    doi: preferNonEmpty(incoming.doi, existing.doi),
    arxivId: preferNonEmpty(incoming.arxivId, existing.arxivId),
    summary: preferNonEmpty(incoming.summary, existing.summary),
    novelty: preferNonEmpty(incoming.novelty, existing.novelty),
    claims: unionDedup(existing.claims, incoming.claims ?? [], (x) => x),
    method: preferNonEmpty(incoming.method, existing.method),
    evaluation: preferNonEmpty(incoming.evaluation, existing.evaluation),
    limitations: unionDedup(existing.limitations, incoming.limitations ?? [], (x) => x),
    relatedPapers: unionDedup(existing.relatedPapers, incoming.relatedPapers ?? [], (x) => x),
    relationToMyWork: preferNonEmpty(incoming.relationToMyWork, existing.relationToMyWork),
    researchContext: preferNonEmpty(incoming.researchContext, existing.researchContext),
    citationPurposes: unionDedup(existing.citationPurposes, incoming.citationPurposes ?? [], cpKey),
    reusableIdeas: unionDedup(existing.reusableIdeas, incoming.reusableIdeas ?? [], (x) => x),
    nextActions: unionDedup(existing.nextActions, incoming.nextActions ?? [], (x) => x),
    themes: unionDedup(existing.themes, incoming.themes ?? [], (x) => x),
    created: existing.created,
    updated,
  };
}
