// arXiv HTML full-text fetcher — so search-registered papers can be
// read in full and captured with the complete Ochiai template, not just
// an abstract decomposition. Same shape as metadata.ts: pure text
// helpers + a thin async wrapper over an injected `fetch`.
//
// Source order: arxiv.org/html/<id> (native HTML, most papers from 2024
// on) then ar5iv (LaTeXML conversions covering older papers). No PDF
// parsing — when neither host has HTML the caller falls back to
// abstract decomposition.

import { MetadataError, normalizeArxivId, type FetchFn } from "./metadata";

const TIMEOUT_MS = 20_000;
const FULLTEXT_HOSTS = ["arxiv.org", "ar5iv.labs.arxiv.org"] as const;

// Head keeps abstract + intro + method; tail keeps conclusion (the
// references block is cut before condensing). Together ≈ 6-7k tokens —
// enough for an Ochiai pass without flooding the chat context.
export const HEAD_CHARS = 18_000;
export const TAIL_CHARS = 6_000;
// ar5iv serves short "conversion failed" stub pages — treat as a miss.
export const MIN_TEXT_CHARS = 1_000;

/** Strip markup down to running text: drop script/style/svg/math
 *  subtrees (MathML is pure noise as text), then tags, then entities. */
export function extractReadableText(html: string): string {
  const noSubtrees = html.replace(/<(script|style|svg|math)\b[\s\S]*?<\/\1>/gi, " ");
  const noTags = noSubtrees.replace(/<[^>]+>/g, " ");
  return decodeEntities(noTags).replace(/\s+/g, " ").trim();
}

/** Cut everything from the LAST "References"/"Bibliography" heading on.
 *  An occurrence in the first 40% of the text (a TOC entry, an inline
 *  mention) is not the bibliography — leave the text alone then. */
export function cutAtReferences(text: string): string {
  const hits = [...text.matchAll(/\b(?:References|Bibliography)\b/g)];
  const last = hits.at(-1);
  if (!last || last.index === undefined || last.index < text.length * 0.4) return text;
  return text.slice(0, last.index).trimEnd();
}

/** Keep the head (abstract/intro/method) and tail (conclusion) of an
 *  over-long body, eliding the middle. */
export function condenseForReading(text: string, head: number = HEAD_CHARS, tail: number = TAIL_CHARS): string {
  if (text.length <= head + tail) return text;
  return `${text.slice(0, head)}\n…[中略 — middle of the paper elided]…\n${text.slice(-tail)}`;
}

export interface FullTextResult {
  source: string;
  text: string;
}

export async function fetchArxivFullText(rawId: string, fetchImpl: FetchFn): Promise<FullTextResult> {
  const id = normalizeArxivId(rawId);
  const urls = [`https://arxiv.org/html/${id}`, `https://ar5iv.labs.arxiv.org/html/${id}`];
  let lastMiss = "no source tried";
  for (const url of urls) {
    let res: Response;
    try {
      res = await fetchImpl(url, { timeoutMs: TIMEOUT_MS, allowedHosts: FULLTEXT_HOSTS });
    } catch (err) {
      lastMiss = `${url}: ${String(err)}`;
      continue;
    }
    if (!res.ok) {
      lastMiss = `${url}: HTTP ${res.status}`;
      continue;
    }
    const text = condenseForReading(cutAtReferences(extractReadableText(await res.text())));
    if (text.length < MIN_TEXT_CHARS) {
      lastMiss = `${url}: page too short (${text.length} chars — likely a stub)`;
      continue;
    }
    return { source: url, text };
  }
  throw new MetadataError("not-found", `no HTML full text for arXiv:${id} (${lastMiss})`);
}

// ── helpers ──────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}
