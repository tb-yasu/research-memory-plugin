// Semantic Scholar paper search — turn a theme/topic query into paper
// candidates the user can pick from and register as cards. Same shape as
// metadata.ts: a pure parser + a thin async wrapper taking an injected
// `fetch` so tests can mock it; in production the plugin passes
// `runtime.fetch` (timeout + allowlist).

import { MetadataError, type FetchFn } from "./metadata";
import { findDuplicates, type PaperCard } from "./card";

/** One search hit, normalized to the card-metadata vocabulary so the LLM
 *  can forward a chosen candidate straight into `save`. */
export interface PaperCandidate {
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  url?: string;
  doi?: string;
  arxivId?: string;
  summary?: string;
  citationCount?: number;
}

export interface SearchOptions {
  limit?: number;
  yearFrom?: number;
}

const S2_ENDPOINT = "https://api.semanticscholar.org/graph/v1/paper/search";
const S2_HOSTS = ["api.semanticscholar.org"] as const;
const S2_FIELDS = "title,abstract,year,venue,url,citationCount,externalIds,authors";

const TIMEOUT_MS = 15_000;
export const DEFAULT_LIMIT = 10;
// One Semantic Scholar relevance-search request returns at most 100 hits;
// that is also our ceiling — paginating further would flood the LLM
// context (candidates ride back whole in jsonData, abstracts included).
export const MAX_LIMIT = 100;
// Candidate summaries are a triage gist, not the stored abstract — at
// 100 hits a full abstract each would dwarf the context. `save` should
// re-fetch the full abstract via fetchMetadata when an id is available.
export const GIST_MAX_CHARS = 600;

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT);
}

/** Cut at the last word boundary before GIST_MAX_CHARS, with an ellipsis. */
export function truncateGist(text: string): string {
  if (text.length <= GIST_MAX_CHARS) return text;
  const head = text.slice(0, GIST_MAX_CHARS);
  const lastSpace = head.lastIndexOf(" ");
  return (lastSpace > 0 ? head.slice(0, lastSpace) : head) + "…";
}

interface S2Author {
  name?: string;
}
interface S2Paper {
  title?: string;
  abstract?: string;
  year?: number;
  venue?: string;
  url?: string;
  citationCount?: number;
  externalIds?: Record<string, string | number>;
  authors?: S2Author[];
}
interface S2Response {
  total?: number;
  data?: S2Paper[];
}

export function parseSemanticScholarResponse(body: S2Response): PaperCandidate[] {
  return (body.data ?? []).flatMap((paper) => {
    if (!paper.title) return [];
    const candidate: PaperCandidate = {
      title: paper.title.replace(/\s+/g, " ").trim(),
      authors: (paper.authors ?? []).map((a) => a.name ?? "").filter((name) => name.length > 0),
    };
    if (paper.year !== undefined && Number.isFinite(paper.year)) candidate.year = paper.year;
    if (paper.venue) candidate.venue = paper.venue;
    if (paper.url) candidate.url = paper.url;
    if (typeof paper.citationCount === "number") candidate.citationCount = paper.citationCount;
    if (paper.abstract) candidate.summary = truncateGist(paper.abstract.replace(/\s+/g, " ").trim());
    const ext = paper.externalIds ?? {};
    if (ext.DOI) candidate.doi = String(ext.DOI);
    if (ext.ArXiv) candidate.arxivId = String(ext.ArXiv);
    return [candidate];
  });
}

/** A candidate plus, when the store already holds the same paper (by
 *  DOI / arXiv id / normalized title), the colliding slugs — so the LLM
 *  can mark it 登録済み in the candidate list instead of re-saving it. */
export type AnnotatedCandidate = PaperCandidate & { existingSlugs?: string[] };

export function annotateCandidates(candidates: PaperCandidate[], all: PaperCard[]): AnnotatedCandidate[] {
  return candidates.map((candidate) => {
    const dup = findDuplicates({ slug: "", title: candidate.title, doi: candidate.doi, arxivId: candidate.arxivId }, all);
    const existingSlugs = [...dup.hard, ...dup.soft].map((hit) => hit.slug);
    return existingSlugs.length > 0 ? { ...candidate, existingSlugs } : candidate;
  });
}

export async function searchSemanticScholar(query: string, opts: SearchOptions, fetchImpl: FetchFn): Promise<PaperCandidate[]> {
  const q = query.trim();
  if (!q) throw new MetadataError("parse", "searchPapers requires a non-empty query");
  const params = new URLSearchParams({ query: q, limit: String(clampLimit(opts.limit)), fields: S2_FIELDS });
  if (opts.yearFrom !== undefined) params.set("year", `${opts.yearFrom}-`);
  let res: Response;
  try {
    res = await fetchImpl(`${S2_ENDPOINT}?${params.toString()}`, { timeoutMs: TIMEOUT_MS, allowedHosts: S2_HOSTS });
  } catch (err) {
    throw new MetadataError("network", `Semantic Scholar fetch failed: ${String(err)}`);
  }
  if (res.status === 429) throw new MetadataError("network", "Semantic Scholar rate limit (429) — wait a moment and retry");
  if (!res.ok) throw new MetadataError("network", `Semantic Scholar returned ${res.status}`);
  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new MetadataError("parse", `Semantic Scholar response is not JSON: ${String(err)}`);
  }
  return parseSemanticScholarResponse(json as S2Response);
}
