// OpenAlex paper search — turn a theme/topic query into paper candidates
// the user can pick from and register as cards. Single source: OpenAlex
// covers journals + conferences + arXiv preprints in one keyless JSON API,
// with a native date filter and structured venue (source) ids — so no
// cross-API merge, no venue alias map, no XML. Same shape as metadata.ts:
// pure parsers + thin async wrappers taking an injected `fetch` so tests
// can mock them; in production the plugin passes `runtime.fetch` (timeout +
// allowlist).
//
// The one OpenAlex wrinkle: abstracts arrive as an inverted index
// ({ word: [positions…] }) — reconstructAbstract() turns it back into text.

import { decodeXml, MetadataError, withMailto, type FetchFn } from "./metadata";
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
  yearTo?: number;
  /** Conference/journal name; resolved to an OpenAlex source id and applied
   *  as a `primary_location.source.id` filter. Unresolvable → ignored. */
  venue?: string;
  /** Polite-pool contact email; appended as `mailto` to OpenAlex URLs. */
  mailto?: string;
}

const OPENALEX_WORKS = "https://api.openalex.org/works";
const OPENALEX_SOURCES = "https://api.openalex.org/sources";
const OPENALEX_HOSTS = ["api.openalex.org"] as const;
// Trim the payload to what we map (abstracts can be large; cap the rest).
const OPENALEX_SELECT = "id,display_name,publication_year,publication_date,authorships,primary_location,locations,doi,abstract_inverted_index,cited_by_count";

const TIMEOUT_MS = 15_000;
export const DEFAULT_LIMIT = 10;
// OpenAlex allows per-page up to 200; we cap lower because candidates ride
// back whole in jsonData (abstract gists included) and would flood the LLM
// context. 100 matches the previous ceiling.
export const MAX_LIMIT = 100;
// Candidate summaries are a triage gist, not the stored abstract — at 100
// hits a full abstract each would dwarf the context. `save` should re-fetch
// the full abstract via fetchFullText / fetchMetadata when an id is available.
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

/** OpenAlex date filter clauses (inclusive). `from_publication_date` /
 *  `to_publication_date` use ISO dates; we map a year to its Jan 1 / Dec 31. */
export function buildDateFilters(yearFrom: number | undefined, yearTo: number | undefined): string[] {
  const clauses: string[] = [];
  if (yearFrom !== undefined && Number.isFinite(yearFrom)) clauses.push(`from_publication_date:${yearFrom}-01-01`);
  if (yearTo !== undefined && Number.isFinite(yearTo)) clauses.push(`to_publication_date:${yearTo}-12-31`);
  return clauses;
}

/** Build the OpenAlex /works query URL. `sourceId` (e.g. "S137773608"),
 *  when given, narrows to that venue. */
export function buildWorksUrl(query: string, opts: SearchOptions, sourceId: string | undefined): string {
  // No `sort`: with a `search` term OpenAlex defaults to relevance_score —
  // exactly what we want. Forcing publication_date:desc instead surfaces the
  // newest LOOSELY-matching records (incl. junk future-dated repository
  // entries), drowning the relevant papers. The date FILTER already scopes
  // recency; relevance orders within it.
  const params = new URLSearchParams({
    search: query,
    "per-page": String(clampLimit(opts.limit)),
    select: OPENALEX_SELECT,
  });
  const filters = buildDateFilters(opts.yearFrom, opts.yearTo);
  // `locations.source.id` (any version), not `primary_location` — conference
  // papers' primary location is often the arXiv preprint, so primary-only
  // would miss them. (OpenAlex conference linkage is still incomplete.)
  if (sourceId) filters.push(`locations.source.id:${sourceId}`);
  if (filters.length > 0) params.set("filter", filters.join(","));
  return withMailto(`${OPENALEX_WORKS}?${params.toString()}`, opts.mailto);
}

/** Reconstruct plain-text from OpenAlex's `abstract_inverted_index`
 *  ({ word: [positions…] }). Returns undefined when absent/empty. */
export function reconstructAbstract(inv: Record<string, number[]> | null | undefined): string | undefined {
  if (!inv || typeof inv !== "object") return undefined;
  const slots: string[] = [];
  for (const [word, positions] of Object.entries(inv)) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) {
      if (Number.isInteger(pos) && pos >= 0) slots[pos] = word;
    }
  }
  if (slots.length === 0) return undefined;
  const text = Array.from(slots, (w) => w ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 0 ? text : undefined;
}

const ARXIV_URL_RE = /arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]{4,5})(?:v\d+)?/i;

/** Strip the `https://doi.org/` envelope OpenAlex wraps DOIs in. */
export function bareDoi(doi: string | null | undefined): string | undefined {
  if (!doi) return undefined;
  const stripped = doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").trim();
  return stripped.length > 0 ? stripped : undefined;
}

/** Pull a bare arXiv id out of any location landing-page / pdf URL. */
export function arxivIdFromUrls(urls: (string | undefined | null)[]): string | undefined {
  for (const url of urls) {
    if (!url) continue;
    const match = ARXIV_URL_RE.exec(url);
    if (match) return match[1];
  }
  return undefined;
}

/** Extract the short source id ("S137773608") from an OpenAlex entity URL. */
export function sourceIdFromUrl(id: string | undefined | null): string | undefined {
  if (!id) return undefined;
  const match = /\/(S\d+)\b/.exec(id);
  return match ? match[1] : undefined;
}

interface OAAuthor {
  display_name?: string;
}
interface OAAuthorship {
  author?: OAAuthor;
}
interface OASource {
  display_name?: string;
}
interface OALocation {
  landing_page_url?: string;
  pdf_url?: string;
  source?: OASource;
}
interface OAWork {
  display_name?: string;
  publication_year?: number;
  authorships?: OAAuthorship[];
  primary_location?: OALocation;
  locations?: OALocation[];
  doi?: string;
  abstract_inverted_index?: Record<string, number[]>;
  cited_by_count?: number;
}
interface OAWorksResponse {
  results?: OAWork[];
}

export function parseOpenAlexResponse(body: OAWorksResponse): PaperCandidate[] {
  return (body.results ?? []).flatMap((work) => {
    const title = work.display_name?.replace(/\s+/g, " ").trim();
    if (!title) return [];
    const candidate: PaperCandidate = {
      title,
      authors: (work.authorships ?? []).map((a) => a.author?.display_name ?? "").filter((name) => name.length > 0),
    };
    if (work.publication_year !== undefined && Number.isFinite(work.publication_year)) candidate.year = work.publication_year;
    const venue = work.primary_location?.source?.display_name;
    if (venue) candidate.venue = venue;
    const url = work.primary_location?.landing_page_url;
    if (url) candidate.url = url;
    if (typeof work.cited_by_count === "number") candidate.citationCount = work.cited_by_count;
    const abstract = reconstructAbstract(work.abstract_inverted_index);
    if (abstract) candidate.summary = truncateGist(abstract);
    const doi = bareDoi(work.doi);
    if (doi) candidate.doi = doi;
    const arxivId = arxivIdFromUrls([work.primary_location?.landing_page_url, ...(work.locations ?? []).flatMap((loc) => [loc.landing_page_url, loc.pdf_url])]);
    if (arxivId) candidate.arxivId = arxivId;
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

interface OASourceResult {
  id?: string;
}
interface OASourcesResponse {
  results?: OASourceResult[];
}

// OpenAlex /sources?search matches the full display_name, not abbreviations
// — "NeurIPS" finds nothing; "Neural Information Processing Systems" finds it.
// Expand the common conference abbreviations to their OpenAlex names.
const VENUE_ALIASES: Record<string, string> = {
  neurips: "Neural Information Processing Systems",
  nips: "Neural Information Processing Systems",
  icml: "International Conference on Machine Learning",
  iclr: "International Conference on Learning Representations",
  kdd: "Knowledge Discovery and Data Mining",
  acl: "Annual Meeting of the Association for Computational Linguistics",
  emnlp: "Conference on Empirical Methods in Natural Language Processing",
  naacl: "North American Chapter of the Association for Computational Linguistics",
  cvpr: "Computer Vision and Pattern Recognition",
  iccv: "International Conference on Computer Vision",
  eccv: "European Conference on Computer Vision",
  aaai: "AAAI Conference on Artificial Intelligence",
  ijcai: "International Joint Conference on Artificial Intelligence",
  sigir: "Special Interest Group on Information Retrieval",
  vldb: "Very Large Data Bases",
  sigmod: "International Conference on Management of Data",
  aistats: "International Conference on Artificial Intelligence and Statistics",
};

/** Expand a known conference abbreviation to the OpenAlex source name; pass
 *  anything else through unchanged. */
export function venueSearchName(venue: string): string {
  const trimmed = venue.trim();
  return VENUE_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

/** Best-effort venue → OpenAlex source id. Returns undefined on any failure
 *  (the search then runs unfiltered rather than erroring on a bad venue). */
export async function resolveVenueSourceId(venue: string, fetchImpl: FetchFn, mailto?: string): Promise<string | undefined> {
  const params = new URLSearchParams({ search: venueSearchName(venue), "per-page": "1", select: "id,display_name" });
  let res: Response;
  try {
    res = await fetchImpl(withMailto(`${OPENALEX_SOURCES}?${params.toString()}`, mailto), { timeoutMs: TIMEOUT_MS, allowedHosts: OPENALEX_HOSTS });
  } catch {
    return undefined;
  }
  if (!res.ok) return undefined;
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return undefined;
  }
  return sourceIdFromUrl((json as OASourcesResponse).results?.[0]?.id);
}

export async function searchOpenAlex(query: string, opts: SearchOptions, fetchImpl: FetchFn): Promise<PaperCandidate[]> {
  const q = query.trim();
  if (!q) throw new MetadataError("parse", "searchPapers requires a non-empty query");
  const sourceId = opts.venue ? await resolveVenueSourceId(opts.venue, fetchImpl, opts.mailto) : undefined;
  let res: Response;
  try {
    res = await fetchImpl(buildWorksUrl(q, opts, sourceId), { timeoutMs: TIMEOUT_MS, allowedHosts: OPENALEX_HOSTS });
  } catch (err) {
    throw new MetadataError("network", `OpenAlex fetch failed: ${String(err)}`);
  }
  if (res.status === 429) throw new MetadataError("network", "OpenAlex rate limit (429) — wait a moment and retry");
  if (!res.ok) throw new MetadataError("network", `OpenAlex returned ${res.status}`);
  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new MetadataError("parse", `OpenAlex response is not JSON: ${String(err)}`);
  }
  return parseOpenAlexResponse(json as OAWorksResponse);
}

// ── arXiv supplement ──────────────────────────────────────────────────
// OpenAlex is broad/established but lags a few days on the very newest
// preprints. A parallel arXiv search (Atom XML, regex-parsed like
// metadata.ts) catches those; mergeCandidates() de-dupes the two sets.

const ARXIV_SEARCH_ENDPOINT = "https://export.arxiv.org/api/query";
const ARXIV_HOSTS = ["export.arxiv.org"] as const;

/** arXiv `search_query`: a phrase match OR an AND of the tokens, bounded to
 *  `>= yearFrom` via submittedDate (fixed far upper bound, no Date.now). */
export function buildArxivSearchQuery(query: string, yearFrom: number | undefined): string {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  let q: string;
  if (tokens.length <= 1) q = `all:${tokens[0] ?? query.trim()}`;
  else q = `(all:"${query.trim()}" OR (${tokens.map((t) => `all:${t}`).join(" AND ")}))`;
  if (yearFrom !== undefined && Number.isFinite(yearFrom)) q = `${q} AND submittedDate:[${yearFrom}01010000 TO 209912312359]`;
  return q;
}

export function buildArxivSearchUrl(query: string, opts: SearchOptions): string {
  const params = new URLSearchParams({
    search_query: buildArxivSearchQuery(query, opts.yearFrom),
    sortBy: "submittedDate",
    sortOrder: "descending",
    start: "0",
    max_results: String(clampLimit(opts.limit)),
  });
  return `${ARXIV_SEARCH_ENDPOINT}?${params.toString()}`;
}

function parseArxivEntry(body: string): PaperCandidate | null {
  const get = (re: RegExp): string | undefined => {
    const m = re.exec(body);
    return m ? decodeXml(m[1].trim()) : undefined;
  };
  const title = get(/<title>([\s\S]*?)<\/title>/);
  if (!title) return null;
  const candidate: PaperCandidate = { title: title.replace(/\s+/g, " ").trim(), authors: [] };
  const authorRe = /<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g;
  let am: RegExpExecArray | null;
  while ((am = authorRe.exec(body)) !== null) candidate.authors.push(decodeXml(am[1].trim()));
  const published = get(/<published>([\s\S]*?)<\/published>/);
  if (published) {
    const year = Number(published.slice(0, 4));
    if (Number.isFinite(year)) candidate.year = year;
  }
  const summary = get(/<summary>([\s\S]*?)<\/summary>/);
  if (summary) candidate.summary = truncateGist(summary.replace(/\s+/g, " ").trim());
  const idUrl = get(/<id>([\s\S]*?)<\/id>/);
  if (idUrl) {
    candidate.url = idUrl;
    const arxivId = idUrl.replace(/^https?:\/\/arxiv\.org\/abs\//, "").replace(/v\d+$/, "");
    if (arxivId && arxivId !== idUrl) candidate.arxivId = arxivId;
  }
  const journalRef = get(/<arxiv:journal_ref>([\s\S]*?)<\/arxiv:journal_ref>/);
  if (journalRef) candidate.venue = journalRef;
  const doi = get(/<arxiv:doi>([\s\S]*?)<\/arxiv:doi>/);
  if (doi) candidate.doi = doi;
  return candidate;
}

export function parseArxivSearchAtom(xml: string, yearFrom: number | undefined): PaperCandidate[] {
  const out: PaperCandidate[] = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let em: RegExpExecArray | null;
  while ((em = entryRe.exec(xml)) !== null) {
    const candidate = parseArxivEntry(em[1]);
    if (!candidate) continue;
    if (yearFrom !== undefined && candidate.year !== undefined && candidate.year < yearFrom) continue;
    out.push(candidate);
  }
  return out;
}

export async function searchArxiv(query: string, opts: SearchOptions, fetchImpl: FetchFn): Promise<PaperCandidate[]> {
  const q = query.trim();
  if (!q) throw new MetadataError("parse", "searchPapers requires a non-empty query");
  let res: Response;
  try {
    res = await fetchImpl(buildArxivSearchUrl(q, opts), { timeoutMs: TIMEOUT_MS, allowedHosts: ARXIV_HOSTS });
  } catch (err) {
    throw new MetadataError("network", `arXiv fetch failed: ${String(err)}`);
  }
  if (!res.ok) throw new MetadataError("network", `arXiv returned ${res.status}`);
  const xml = await res.text();
  return parseArxivSearchAtom(xml, opts.yearFrom);
}

function normTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Merge a primary candidate list (OpenAlex) with extras (arXiv), de-duping
 *  by arxivId → doi → normalized title. Primary entries keep their richer
 *  metadata (venue/citations); a matching extra fills a missing
 *  arxivId/abstract/doi/url. Non-matching extras (fresh preprints OpenAlex
 *  lacks) are appended in order. */
export function mergeCandidates(primary: PaperCandidate[], extra: PaperCandidate[]): PaperCandidate[] {
  const byArxiv = new Map<string, PaperCandidate>();
  const byDoi = new Map<string, PaperCandidate>();
  const byTitle = new Map<string, PaperCandidate>();
  const out: PaperCandidate[] = [];
  const index = (c: PaperCandidate): void => {
    if (c.arxivId) byArxiv.set(c.arxivId.toLowerCase(), c);
    if (c.doi) byDoi.set(c.doi.toLowerCase(), c);
    byTitle.set(normTitle(c.title), c);
  };
  for (const c of primary) {
    out.push(c);
    index(c);
  }
  for (const c of extra) {
    const hit = (c.arxivId && byArxiv.get(c.arxivId.toLowerCase())) || (c.doi && byDoi.get(c.doi.toLowerCase())) || byTitle.get(normTitle(c.title));
    if (hit) {
      if (!hit.arxivId && c.arxivId) hit.arxivId = c.arxivId;
      if (!hit.summary && c.summary) hit.summary = c.summary;
      if (!hit.doi && c.doi) hit.doi = c.doi;
      if (!hit.url && c.url) hit.url = c.url;
      continue;
    }
    out.push(c);
    index(c);
  }
  return out;
}
