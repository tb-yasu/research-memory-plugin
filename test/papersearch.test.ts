// Pure parser + injected-fetch tests for src/papersearch.ts. No network.

import test from "node:test";
import assert from "node:assert/strict";
import { MetadataError } from "../src/metadata";
import { annotateCandidates, clampLimit, DEFAULT_LIMIT, GIST_MAX_CHARS, MAX_LIMIT, parseSemanticScholarResponse, searchSemanticScholar, truncateGist } from "../src/papersearch";
import { PaperCardSchema } from "../src/card";

// ── parser ────────────────────────────────────────────────────────────

const S2_FIXTURE = {
  total: 3,
  data: [
    {
      title: "Agentic  Memory:\n A Survey",
      abstract: "We survey   memory mechanisms\nfor LLM agents.",
      year: 2024,
      venue: "NeurIPS",
      url: "https://www.semanticscholar.org/paper/abc",
      citationCount: 42,
      externalIds: { DOI: "10.1234/agentic", ArXiv: "2401.99999" },
      authors: [{ name: "Alice Example" }, { name: "" }, { name: "Bob Sample" }],
    },
    {
      // No title — must be dropped, not crash.
      abstract: "An orphan record.",
      year: 2023,
    },
    {
      title: "Minimal Hit",
      authors: [],
    },
  ],
};

test("parseSemanticScholarResponse normalizes fields and drops title-less records", () => {
  const candidates = parseSemanticScholarResponse(S2_FIXTURE);
  assert.equal(candidates.length, 2);

  const [first, second] = candidates;
  assert.equal(first.title, "Agentic Memory: A Survey");
  assert.deepEqual(first.authors, ["Alice Example", "Bob Sample"]);
  assert.equal(first.year, 2024);
  assert.equal(first.venue, "NeurIPS");
  assert.equal(first.url, "https://www.semanticscholar.org/paper/abc");
  assert.equal(first.citationCount, 42);
  assert.equal(first.summary, "We survey memory mechanisms for LLM agents.");
  assert.equal(first.doi, "10.1234/agentic");
  assert.equal(first.arxivId, "2401.99999");

  assert.equal(second.title, "Minimal Hit");
  assert.deepEqual(second.authors, []);
  assert.equal(second.year, undefined);
  assert.equal(second.doi, undefined);
});

test("parseSemanticScholarResponse returns [] for an empty / missing data array", () => {
  assert.deepEqual(parseSemanticScholarResponse({}), []);
  assert.deepEqual(parseSemanticScholarResponse({ total: 0, data: [] }), []);
});

// ── limit clamping ────────────────────────────────────────────────────

test("clampLimit defaults, truncates, and clamps to [1, MAX_LIMIT]", () => {
  assert.equal(clampLimit(undefined), DEFAULT_LIMIT);
  assert.equal(clampLimit(5.9), 5);
  assert.equal(clampLimit(0), 1);
  assert.equal(clampLimit(-3), 1);
  assert.equal(clampLimit(100), 100);
  assert.equal(clampLimit(250), MAX_LIMIT);
});

// ── gist truncation ───────────────────────────────────────────────────

test("truncateGist keeps short text verbatim and cuts long text at a word boundary", () => {
  assert.equal(truncateGist("short abstract"), "short abstract");
  const exact = "a".repeat(GIST_MAX_CHARS);
  assert.equal(truncateGist(exact), exact);

  const long = ("word ".repeat(200)).trim(); // 999 chars
  const gist = truncateGist(long);
  assert.ok(gist.length <= GIST_MAX_CHARS + 1);
  assert.ok(gist.endsWith("…"));
  assert.ok(!gist.includes("  "), "no mid-word cut leaving stray spaces");
});

test("parseSemanticScholarResponse truncates over-long abstracts to a gist", () => {
  const [hit] = parseSemanticScholarResponse({ data: [{ title: "Long One", abstract: "lorem ".repeat(300) }] });
  assert.ok((hit.summary ?? "").length <= GIST_MAX_CHARS + 1);
  assert.ok((hit.summary ?? "").endsWith("…"));
});

// ── fetch wrapper ─────────────────────────────────────────────────────

test("searchSemanticScholar routes through the injected fetch with query/limit/fields/year params", async () => {
  const calls: string[] = [];
  const fakeFetch = async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify(S2_FIXTURE), { status: 200, headers: { "content-type": "application/json" } });
  };
  const candidates = await searchSemanticScholar("  agentic memory  ", { limit: 100, yearFrom: 2023 }, fakeFetch);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]);
  assert.equal(url.host, "api.semanticscholar.org");
  assert.equal(url.searchParams.get("query"), "agentic memory");
  assert.equal(url.searchParams.get("limit"), String(MAX_LIMIT));
  assert.equal(url.searchParams.get("year"), "2023-");
  assert.match(url.searchParams.get("fields") ?? "", /externalIds/);
  assert.equal(candidates.length, 2);
});

test("searchSemanticScholar omits the year param when yearFrom is not given", async () => {
  const calls: string[] = [];
  const fakeFetch = async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  await searchSemanticScholar("fm-index", {}, fakeFetch);
  assert.equal(new URL(calls[0]).searchParams.get("year"), null);
});

test("searchSemanticScholar rejects an empty query with MetadataError(parse)", async () => {
  const fakeFetch = async () => new Response("{}", { status: 200 });
  await assert.rejects(searchSemanticScholar("   ", {}, fakeFetch), (err: unknown) => err instanceof MetadataError && err.code === "parse");
});

test("searchSemanticScholar maps 429 and other non-OK statuses to MetadataError(network)", async () => {
  const rateLimited = async () => new Response("", { status: 429 });
  await assert.rejects(searchSemanticScholar("x", {}, rateLimited), (err: unknown) => err instanceof MetadataError && err.code === "network" && /429/.test(err.message));
  const serverError = async () => new Response("", { status: 500 });
  await assert.rejects(searchSemanticScholar("x", {}, serverError), (err: unknown) => err instanceof MetadataError && err.code === "network");
});

test("searchSemanticScholar maps a thrown fetch to MetadataError(network) and bad JSON to parse", async () => {
  const throwing = async (): Promise<Response> => {
    throw new Error("ECONNREFUSED");
  };
  await assert.rejects(searchSemanticScholar("x", {}, throwing), (err: unknown) => err instanceof MetadataError && err.code === "network");
  const badJson = async () => new Response("<html>not json</html>", { status: 200 });
  await assert.rejects(searchSemanticScholar("x", {}, badJson), (err: unknown) => err instanceof MetadataError && err.code === "parse");
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
