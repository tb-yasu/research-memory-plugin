// Pure parser + injected-fetch tests for src/papersearch.ts (OpenAlex). No network.

import test from "node:test";
import assert from "node:assert/strict";
import { MetadataError, withMailto } from "../src/metadata";
import {
  annotateCandidates,
  arxivIdFromUrls,
  bareDoi,
  buildArxivSearchQuery,
  buildArxivSearchUrl,
  buildDateFilters,
  buildWorksUrl,
  clampLimit,
  DEFAULT_LIMIT,
  GIST_MAX_CHARS,
  MAX_LIMIT,
  mergeCandidates,
  parseArxivSearchAtom,
  parseOpenAlexResponse,
  reconstructAbstract,
  resolveVenueSourceId,
  searchArxiv,
  searchOpenAlex,
  sourceIdFromUrl,
  truncateGist,
  venueSearchName,
} from "../src/papersearch";
import { PaperCardSchema } from "../src/card";

// ── parser ────────────────────────────────────────────────────────────

const OA_FIXTURE = {
  results: [
    {
      display_name: "Agentic  Memory:\n A Survey",
      publication_year: 2025,
      publication_date: "2025-03-01",
      authorships: [{ author: { display_name: "Alice Example" } }, { author: { display_name: "" } }, { author: { display_name: "Bob Sample" } }],
      primary_location: { landing_page_url: "https://openalex.org/W1", source: { display_name: "NeurIPS" } },
      locations: [{ landing_page_url: "https://arxiv.org/abs/2501.12345v2" }],
      doi: "https://doi.org/10.1234/agentic",
      abstract_inverted_index: { We: [0], survey: [1], memory: [2], mechanisms: [3] },
      cited_by_count: 42,
    },
    { publication_year: 2025 }, // no title — must be dropped, not crash
    { display_name: "Minimal Hit", authorships: [] },
  ],
};

test("parseOpenAlexResponse normalizes fields, reconstructs the abstract, and drops title-less records", () => {
  const candidates = parseOpenAlexResponse(OA_FIXTURE);
  assert.equal(candidates.length, 2);

  const [first, second] = candidates;
  assert.equal(first.title, "Agentic Memory: A Survey");
  assert.deepEqual(first.authors, ["Alice Example", "Bob Sample"]);
  assert.equal(first.year, 2025);
  assert.equal(first.venue, "NeurIPS");
  assert.equal(first.url, "https://openalex.org/W1");
  assert.equal(first.citationCount, 42);
  assert.equal(first.summary, "We survey memory mechanisms");
  assert.equal(first.doi, "10.1234/agentic");
  assert.equal(first.arxivId, "2501.12345");

  assert.equal(second.title, "Minimal Hit");
  assert.deepEqual(second.authors, []);
  assert.equal(second.year, undefined);
  assert.equal(second.doi, undefined);
  assert.equal(second.arxivId, undefined);
});

test("parseOpenAlexResponse returns [] for an empty / missing results array", () => {
  assert.deepEqual(parseOpenAlexResponse({}), []);
  assert.deepEqual(parseOpenAlexResponse({ results: [] }), []);
});

// ── abstract reconstruction ───────────────────────────────────────────

test("reconstructAbstract rebuilds word order from the inverted index", () => {
  assert.equal(reconstructAbstract({ Hello: [1], world: [0] }), "world Hello");
  // a gap (missing position) collapses to a single space
  assert.equal(reconstructAbstract({ a: [0], b: [2] }), "a b");
  // a repeated word at two positions
  assert.equal(reconstructAbstract({ the: [0, 2], cat: [1] }), "the cat the");
  assert.equal(reconstructAbstract(null), undefined);
  assert.equal(reconstructAbstract(undefined), undefined);
  assert.equal(reconstructAbstract({}), undefined);
});

// ── small extractors ──────────────────────────────────────────────────

test("bareDoi strips the doi.org envelope", () => {
  assert.equal(bareDoi("https://doi.org/10.1/x"), "10.1/x");
  assert.equal(bareDoi("https://dx.doi.org/10.1/x"), "10.1/x");
  assert.equal(bareDoi("10.1/x"), "10.1/x");
  assert.equal(bareDoi(undefined), undefined);
  assert.equal(bareDoi(null), undefined);
});

test("arxivIdFromUrls pulls a bare arXiv id from a landing/pdf URL and strips the version", () => {
  assert.equal(arxivIdFromUrls(["https://arxiv.org/abs/2501.12345v2"]), "2501.12345");
  assert.equal(arxivIdFromUrls([undefined, "https://arxiv.org/pdf/2401.00001"]), "2401.00001");
  assert.equal(arxivIdFromUrls(["https://example.com/x"]), undefined);
});

test("sourceIdFromUrl extracts the short S-id", () => {
  assert.equal(sourceIdFromUrl("https://openalex.org/S137773608"), "S137773608");
  assert.equal(sourceIdFromUrl(undefined), undefined);
  assert.equal(sourceIdFromUrl("https://openalex.org/W1"), undefined);
});

// ── URL builders ──────────────────────────────────────────────────────

test("buildDateFilters covers from-only, to-only, range, and the unbounded case", () => {
  assert.deepEqual(buildDateFilters(undefined, undefined), []);
  assert.deepEqual(buildDateFilters(2025, undefined), ["from_publication_date:2025-01-01"]);
  assert.deepEqual(buildDateFilters(undefined, 2023), ["to_publication_date:2023-12-31"]);
  assert.deepEqual(buildDateFilters(2020, 2023), ["from_publication_date:2020-01-01", "to_publication_date:2023-12-31"]);
});

test("buildWorksUrl sets search/per-page/select and the date + source filters, with no sort (relevance default)", () => {
  const url = new URL(buildWorksUrl("agentic memory", { limit: 100, yearFrom: 2025 }, "S123"));
  assert.equal(url.host, "api.openalex.org");
  assert.equal(url.pathname, "/works");
  assert.equal(url.searchParams.get("search"), "agentic memory");
  assert.equal(url.searchParams.get("sort"), null);
  assert.equal(url.searchParams.get("per-page"), "100");
  assert.match(url.searchParams.get("select") ?? "", /abstract_inverted_index/);
  assert.equal(url.searchParams.get("filter"), "from_publication_date:2025-01-01,locations.source.id:S123");
});

test("venueSearchName expands known conference abbreviations and passes others through", () => {
  assert.equal(venueSearchName("NeurIPS"), "Neural Information Processing Systems");
  assert.equal(venueSearchName("  icml "), "International Conference on Machine Learning");
  assert.equal(venueSearchName("Journal of the ACM"), "Journal of the ACM");
});

test("buildWorksUrl omits the filter param when there is no date or source", () => {
  const url = new URL(buildWorksUrl("x", {}, undefined));
  assert.equal(url.searchParams.get("filter"), null);
});

// ── mailto polite pool ────────────────────────────────────────────────

test("withMailto appends mailto with the right separator, encodes, and no-ops when unset", () => {
  assert.equal(withMailto("https://api.openalex.org/works", undefined), "https://api.openalex.org/works");
  assert.equal(withMailto("https://api.openalex.org/works", ""), "https://api.openalex.org/works");
  // No existing query → `?`.
  assert.equal(withMailto("https://api.crossref.org/works/10.1/x", "me@example.com"), "https://api.crossref.org/works/10.1/x?mailto=me%40example.com");
  // Existing query → `&`.
  assert.equal(withMailto("https://api.openalex.org/works?search=x", "a+b@e.com"), "https://api.openalex.org/works?search=x&mailto=a%2Bb%40e.com");
});

test("buildWorksUrl appends mailto when set and omits it when not", () => {
  const withMail = new URL(buildWorksUrl("agentic memory", { mailto: "me@example.com" }, undefined));
  assert.equal(withMail.searchParams.get("mailto"), "me@example.com");
  const without = new URL(buildWorksUrl("agentic memory", {}, undefined));
  assert.equal(without.searchParams.get("mailto"), null);
});

// ── limit clamping + gist (unchanged behaviour) ───────────────────────

test("clampLimit defaults, truncates, and clamps to [1, MAX_LIMIT]", () => {
  assert.equal(clampLimit(undefined), DEFAULT_LIMIT);
  assert.equal(clampLimit(5.9), 5);
  assert.equal(clampLimit(0), 1);
  assert.equal(clampLimit(-3), 1);
  assert.equal(clampLimit(100), 100);
  assert.equal(clampLimit(250), MAX_LIMIT);
});

test("truncateGist keeps short text verbatim and cuts long text at a word boundary", () => {
  assert.equal(truncateGist("short abstract"), "short abstract");
  const exact = "a".repeat(GIST_MAX_CHARS);
  assert.equal(truncateGist(exact), exact);
  const long = "word ".repeat(200).trim();
  const gist = truncateGist(long);
  assert.ok(gist.length <= GIST_MAX_CHARS + 1);
  assert.ok(gist.endsWith("…"));
  assert.ok(!gist.includes("  "), "no mid-word cut leaving stray spaces");
});

// ── fetch wrapper ─────────────────────────────────────────────────────

test("searchOpenAlex routes through the injected fetch with search/per-page/filter params", async () => {
  const calls: string[] = [];
  const fakeFetch = async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify(OA_FIXTURE), { status: 200, headers: { "content-type": "application/json" } });
  };
  const candidates = await searchOpenAlex("  agentic memory  ", { limit: 100, yearFrom: 2025 }, fakeFetch);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]);
  assert.equal(url.host, "api.openalex.org");
  assert.equal(url.searchParams.get("search"), "agentic memory");
  assert.equal(url.searchParams.get("per-page"), String(MAX_LIMIT));
  assert.equal(url.searchParams.get("filter"), "from_publication_date:2025-01-01");
  assert.equal(candidates.length, 2);
});

test("searchOpenAlex resolves a venue to a source id and adds the source filter", async () => {
  const calls: string[] = [];
  const fakeFetch = async (url: string) => {
    calls.push(url);
    if (url.includes("/sources")) {
      return new Response(JSON.stringify({ results: [{ id: "https://openalex.org/S137773608" }] }), { status: 200 });
    }
    return new Response(JSON.stringify(OA_FIXTURE), { status: 200 });
  };
  await searchOpenAlex("agentic memory", { yearFrom: 2025, venue: "NeurIPS" }, fakeFetch);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /\/sources\?/);
  // the abbreviation is expanded before the /sources lookup
  assert.equal(new URL(calls[0]).searchParams.get("search"), "Neural Information Processing Systems");
  assert.match(new URL(calls[1]).searchParams.get("filter") ?? "", /locations\.source\.id:S137773608/);
});

test("searchOpenAlex ignores an unresolvable venue (no source filter)", async () => {
  let worksUrl = "";
  const fakeFetch = async (url: string) => {
    if (url.includes("/sources")) return new Response(JSON.stringify({ results: [] }), { status: 200 });
    worksUrl = url;
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  };
  await searchOpenAlex("x", { yearFrom: 2025, venue: "Nonexistent Venue" }, fakeFetch);
  assert.doesNotMatch(new URL(worksUrl).searchParams.get("filter") ?? "", /source\.id/);
});

test("searchOpenAlex rejects an empty query with MetadataError(parse)", async () => {
  const fakeFetch = async () => new Response("{}", { status: 200 });
  await assert.rejects(searchOpenAlex("   ", {}, fakeFetch), (err: unknown) => err instanceof MetadataError && err.code === "parse");
});

test("searchOpenAlex maps 429 and other non-OK statuses to MetadataError(network)", async () => {
  const rateLimited = async () => new Response("", { status: 429 });
  await assert.rejects(searchOpenAlex("x", {}, rateLimited), (err: unknown) => err instanceof MetadataError && err.code === "network" && /429/.test(err.message));
  const serverError = async () => new Response("", { status: 500 });
  await assert.rejects(searchOpenAlex("x", {}, serverError), (err: unknown) => err instanceof MetadataError && err.code === "network");
});

test("searchOpenAlex maps a thrown fetch to MetadataError(network) and bad JSON to parse", async () => {
  const throwing = async (): Promise<Response> => {
    throw new Error("ECONNREFUSED");
  };
  await assert.rejects(searchOpenAlex("x", {}, throwing), (err: unknown) => err instanceof MetadataError && err.code === "network");
  const badJson = async () => new Response("<html>not json</html>", { status: 200 });
  await assert.rejects(searchOpenAlex("x", {}, badJson), (err: unknown) => err instanceof MetadataError && err.code === "parse");
});

// ── venue resolution (best-effort) ────────────────────────────────────

test("resolveVenueSourceId returns the id, or undefined on miss / non-OK / throw", async () => {
  const hit = async () => new Response(JSON.stringify({ results: [{ id: "https://openalex.org/S1" }] }), { status: 200 });
  assert.equal(await resolveVenueSourceId("NeurIPS", hit), "S1");
  const miss = async () => new Response(JSON.stringify({ results: [] }), { status: 200 });
  assert.equal(await resolveVenueSourceId("x", miss), undefined);
  const notOk = async () => new Response("", { status: 500 });
  assert.equal(await resolveVenueSourceId("x", notOk), undefined);
  const throwing = async (): Promise<Response> => {
    throw new Error("net");
  };
  assert.equal(await resolveVenueSourceId("x", throwing), undefined);
});

// ── arXiv supplement ──────────────────────────────────────────────────

const ARXIV_FIXTURE = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2506.12345v2</id>
    <title>Agentic Memory for
      LLM Agents</title>
    <summary>We propose a memory system. It works well.</summary>
    <published>2025-06-01T00:00:00Z</published>
    <author><name>Alice Example</name></author>
    <author><name>Bob Sample</name></author>
    <arxiv:doi>10.9999/x</arxiv:doi>
    <arxiv:journal_ref>NeurIPS 2025</arxiv:journal_ref>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2401.00002</id>
    <title>Old Paper</title>
    <summary>old.</summary>
    <published>2024-01-01T00:00:00Z</published>
    <author><name>C. Writer</name></author>
  </entry>
  <entry><title></title></entry>
</feed>`;

test("buildArxivSearchQuery wraps multi-word as phrase OR AND, bounds by submittedDate", () => {
  assert.equal(buildArxivSearchQuery("memory", undefined), "all:memory");
  assert.equal(buildArxivSearchQuery("fm-index", 2024), "all:fm-index AND submittedDate:[202401010000 TO 209912312359]");
  assert.equal(buildArxivSearchQuery("agentic memory", 2025), '(all:"agentic memory" OR (all:agentic AND all:memory)) AND submittedDate:[202501010000 TO 209912312359]');
});

test("buildArxivSearchUrl sets search_query/sort/max_results", () => {
  const url = new URL(buildArxivSearchUrl("agentic memory", { limit: 5, yearFrom: 2025 }));
  assert.equal(url.host, "export.arxiv.org");
  assert.equal(url.searchParams.get("sortBy"), "submittedDate");
  assert.equal(url.searchParams.get("sortOrder"), "descending");
  assert.equal(url.searchParams.get("max_results"), "5");
  assert.match(url.searchParams.get("search_query") ?? "", /all:"agentic memory"/);
});

test("parseArxivSearchAtom parses entries, strips version, drops below yearFrom and title-less", () => {
  const all = parseArxivSearchAtom(ARXIV_FIXTURE, undefined);
  assert.equal(all.length, 2); // the two titled entries
  const recent = parseArxivSearchAtom(ARXIV_FIXTURE, 2025);
  assert.equal(recent.length, 1);
  const [c] = recent;
  assert.equal(c.title, "Agentic Memory for LLM Agents");
  assert.deepEqual(c.authors, ["Alice Example", "Bob Sample"]);
  assert.equal(c.year, 2025);
  assert.equal(c.arxivId, "2506.12345");
  assert.equal(c.venue, "NeurIPS 2025");
  assert.equal(c.doi, "10.9999/x");
  assert.equal(c.summary, "We propose a memory system. It works well.");
});

test("searchArxiv routes through fetch and parses; maps errors", async () => {
  const calls: string[] = [];
  const ok = async (url: string) => {
    calls.push(url);
    return new Response(ARXIV_FIXTURE, { status: 200 });
  };
  const out = await searchArxiv("agentic memory", { yearFrom: 2025 }, ok);
  assert.equal(new URL(calls[0]).host, "export.arxiv.org");
  assert.equal(out.length, 1);
  await assert.rejects(searchArxiv("  ", {}, ok), (e: unknown) => e instanceof MetadataError && e.code === "parse");
  const bad = async () => new Response("", { status: 503 });
  await assert.rejects(searchArxiv("x", {}, bad), (e: unknown) => e instanceof MetadataError && e.code === "network");
});

test("mergeCandidates de-dupes across sources (arxivId/doi/title) and appends fresh extras", () => {
  const primary = [
    { title: "Memory Paper", authors: [], arxivId: "2501.1", venue: "NeurIPS" },
    { title: "Attention Is All You Need", authors: [] },
  ];
  const extra = [
    { title: "Memory Paper (preprint)", authors: [], arxivId: "2501.1", summary: "an abstract" },
    { title: "attention is all you need", authors: [], doi: "10.x" },
    { title: "Fresh Preprint", authors: [], arxivId: "2506.9" },
  ];
  const merged = mergeCandidates(primary, extra);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].summary, "an abstract"); // filled from arXiv
  assert.equal(merged[0].venue, "NeurIPS"); // OpenAlex metadata kept
  assert.equal(merged[2].title, "Fresh Preprint");
});

// ── annotateCandidates ────────────────────────────────────────────────

function makeCard(slug: string, fields: Record<string, unknown>): ReturnType<typeof PaperCardSchema.parse> {
  return PaperCardSchema.parse({ slug, title: "t", created: "2026-01-01T00:00:00Z", updated: "2026-01-01T00:00:00Z", ...fields });
}

test("annotateCandidates flags arXiv/DOI/title collisions with the existing slugs", () => {
  const all = [makeCard("smith-2024", { title: "A Stored Paper", arxivId: "2401.99999" }), makeCard("jones-2023", { title: "Same Title, Different Punctuation!" })];
  const out = annotateCandidates(
    [
      { title: "Fresh Paper", authors: [] },
      { title: "Whatever", authors: [], arxivId: "2401.99999" },
      { title: "same title different punctuation", authors: [] },
    ],
    all,
  );
  assert.equal(out[0].existingSlugs, undefined);
  assert.deepEqual(out[1].existingSlugs, ["smith-2024"]);
  assert.deepEqual(out[2].existingSlugs, ["jones-2023"]);
});
