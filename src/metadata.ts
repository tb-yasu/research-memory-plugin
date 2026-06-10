// arXiv + Crossref/DOI metadata fetchers. Pure parsers + thin async
// wrappers so the parsers stay unit-testable without network access.
// The async wrappers take an injected `fetch` so tests can mock it; in
// production the plugin passes `runtime.fetch` (timeout + allowlist).

import type { PaperCard } from "./card";

export type MetadataPatch = Partial<Omit<PaperCard, "slug" | "created" | "updated">>;

export type MetadataErrorCode = "not-found" | "network" | "parse";

export class MetadataError extends Error {
  readonly code: MetadataErrorCode;
  constructor(code: MetadataErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "MetadataError";
  }
}

type FetchOptions = { timeoutMs?: number; allowedHosts?: readonly string[] };
export type FetchFn = (url: string, opts?: FetchOptions) => Promise<Response>;

const TIMEOUT_MS = 15_000;

// ── arXiv ────────────────────────────────────────────────────────────

const ARXIV_ENDPOINT = "https://export.arxiv.org/api/query";
const ARXIV_HOSTS = ["export.arxiv.org"] as const;

/** Accept "arXiv:2401.12345", "2401.12345", "arXiv:2401.12345v2"; return
 *  the bare ID with version stripped. */
export function normalizeArxivId(input: string): string {
  const m = /(?:arXiv:)?(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?)/i.exec(input.trim());
  if (!m) return input.trim();
  return m[1].replace(/v\d+$/, "");
}

export function parseArxivAtom(xml: string): MetadataPatch {
  const entry = /<entry>([\s\S]*?)<\/entry>/.exec(xml);
  if (!entry) throw new MetadataError("not-found", "arXiv returned no entry");
  const body = entry[1];

  const get = (re: RegExp): string | undefined => {
    const m = re.exec(body);
    return m ? decodeXml(m[1].trim()) : undefined;
  };

  const title = get(/<title>([\s\S]*?)<\/title>/);
  if (!title) throw new MetadataError("parse", "arXiv entry missing title");

  const summary = get(/<summary>([\s\S]*?)<\/summary>/);
  const published = get(/<published>([\s\S]*?)<\/published>/);
  const idUrl = get(/<id>([\s\S]*?)<\/id>/);
  const journalRef = get(/<arxiv:journal_ref>([\s\S]*?)<\/arxiv:journal_ref>/);
  const doi = get(/<arxiv:doi>([\s\S]*?)<\/arxiv:doi>/);

  const authors: string[] = [];
  const authorRe = /<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g;
  let am: RegExpExecArray | null;
  while ((am = authorRe.exec(body)) !== null) {
    authors.push(decodeXml(am[1].trim()));
  }

  const arxivId = idUrl ? idUrl.replace(/^https?:\/\/arxiv\.org\/abs\//, "").replace(/v\d+$/, "") : undefined;
  const year = published ? Number(published.slice(0, 4)) : undefined;

  const patch: MetadataPatch = {
    title: title.replace(/\s+/g, " "),
    authors,
  };
  if (year !== undefined && Number.isFinite(year)) patch.year = year;
  if (summary) patch.summary = summary.replace(/\s+/g, " ").trim();
  if (idUrl) patch.url = idUrl;
  if (arxivId) patch.arxivId = arxivId;
  if (journalRef) patch.venue = journalRef;
  if (doi) patch.doi = doi;

  return patch;
}

export async function fetchArxiv(rawId: string, fetchImpl: FetchFn): Promise<MetadataPatch> {
  const id = normalizeArxivId(rawId);
  const url = `${ARXIV_ENDPOINT}?id_list=${encodeURIComponent(id)}`;
  let res: Response;
  try {
    res = await fetchImpl(url, { timeoutMs: TIMEOUT_MS, allowedHosts: ARXIV_HOSTS });
  } catch (err) {
    throw new MetadataError("network", `arXiv fetch failed: ${String(err)}`);
  }
  if (!res.ok) throw new MetadataError("network", `arXiv returned ${res.status}`);
  const xml = await res.text();
  return parseArxivAtom(xml);
}

// ── Crossref / DOI ───────────────────────────────────────────────────

const CROSSREF_ENDPOINT = "https://api.crossref.org/works";
const CROSSREF_HOSTS = ["api.crossref.org"] as const;

interface CrossrefAuthor {
  given?: string;
  family?: string;
  name?: string;
}
interface CrossrefDate {
  "date-parts"?: number[][];
}
interface CrossrefWork {
  title?: string[];
  author?: CrossrefAuthor[];
  issued?: CrossrefDate;
  "published-print"?: CrossrefDate;
  "published-online"?: CrossrefDate;
  "container-title"?: string[];
  URL?: string;
  DOI?: string;
  abstract?: string;
}
interface CrossrefResponse {
  status?: string;
  message?: CrossrefWork;
}

export function parseCrossrefWork(work: CrossrefWork): MetadataPatch {
  const title = work.title?.[0];
  if (!title) throw new MetadataError("parse", "Crossref work missing title");
  const authors = (work.author ?? [])
    .map((a) => a.name ?? `${a.given ?? ""} ${a.family ?? ""}`.trim())
    .filter((s): s is string => Boolean(s) && s.length > 0);
  const yearParts = (work.issued?.["date-parts"] ?? work["published-print"]?.["date-parts"] ?? work["published-online"]?.["date-parts"])?.[0];
  const year = yearParts?.[0];
  const venue = work["container-title"]?.[0];
  const abstract = work.abstract ? stripHtml(work.abstract).replace(/\s+/g, " ").trim() : undefined;

  const patch: MetadataPatch = { title: title.replace(/\s+/g, " "), authors };
  if (year !== undefined && Number.isFinite(year)) patch.year = year;
  if (venue) patch.venue = venue;
  if (work.URL) patch.url = work.URL;
  if (work.DOI) patch.doi = work.DOI;
  if (abstract) patch.summary = abstract;
  return patch;
}

export async function fetchDoi(doi: string, fetchImpl: FetchFn): Promise<MetadataPatch> {
  const url = `${CROSSREF_ENDPOINT}/${encodeURIComponent(doi.trim())}`;
  let res: Response;
  try {
    res = await fetchImpl(url, { timeoutMs: TIMEOUT_MS, allowedHosts: CROSSREF_HOSTS });
  } catch (err) {
    throw new MetadataError("network", `Crossref fetch failed: ${String(err)}`);
  }
  if (res.status === 404) throw new MetadataError("not-found", `DOI not found: ${doi}`);
  if (!res.ok) throw new MetadataError("network", `Crossref returned ${res.status}`);
  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new MetadataError("parse", `Crossref response is not JSON: ${String(err)}`);
  }
  const body = json as CrossrefResponse;
  if (body.status !== "ok" || !body.message) throw new MetadataError("not-found", `DOI not found: ${doi}`);
  return parseCrossrefWork(body.message);
}

// ── helpers ──────────────────────────────────────────────────────────

function decodeXml(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}
