// Pure parser + injected-fetch tests for src/metadata.ts. No network.

import test from "node:test";
import assert from "node:assert/strict";
import { fetchArxiv, fetchDoi, MetadataError, normalizeArxivId, parseArxivAtom, parseCrossrefWork } from "../src/metadata";

// ── arXiv ─────────────────────────────────────────────────────────────

test("normalizeArxivId strips arXiv: prefix and version suffix", () => {
  assert.equal(normalizeArxivId("arXiv:2401.12345"), "2401.12345");
  assert.equal(normalizeArxivId("2401.12345"), "2401.12345");
  assert.equal(normalizeArxivId("arXiv:2401.12345v2"), "2401.12345");
  assert.equal(normalizeArxivId("  arXiv:2401.12345  "), "2401.12345");
});

const ARXIV_ATOM_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2401.12345v1</id>
    <updated>2024-01-23T00:00:00Z</updated>
    <published>2024-01-22T18:30:00Z</published>
    <title>A Test Paper on Compressed Memory &amp; Recourse</title>
    <summary>This paper studies compressed indexes for agent memory. We show a new dynamic structure.</summary>
    <author><name>Alice Example</name></author>
    <author><name>Bob Sample</name></author>
    <arxiv:journal_ref>NeurIPS 2024</arxiv:journal_ref>
    <arxiv:doi>10.1234/test.2024</arxiv:doi>
  </entry>
</feed>`;

test("parseArxivAtom extracts title, authors, year, summary, url, arxivId, venue, doi", () => {
  const patch = parseArxivAtom(ARXIV_ATOM_FIXTURE);
  assert.equal(patch.title, "A Test Paper on Compressed Memory & Recourse");
  assert.deepEqual(patch.authors, ["Alice Example", "Bob Sample"]);
  assert.equal(patch.year, 2024);
  assert.match(patch.summary ?? "", /compressed indexes/);
  assert.equal(patch.url, "http://arxiv.org/abs/2401.12345v1");
  assert.equal(patch.arxivId, "2401.12345");
  assert.equal(patch.venue, "NeurIPS 2024");
  assert.equal(patch.doi, "10.1234/test.2024");
});

test("parseArxivAtom throws not-found when no <entry> is present", () => {
  assert.throws(() => parseArxivAtom("<feed></feed>"), (err: unknown) => err instanceof MetadataError && err.code === "not-found");
});

test("fetchArxiv routes through the injected fetch and returns the parsed patch", async () => {
  const calls: string[] = [];
  const fakeFetch = async (url: string) => {
    calls.push(url);
    return new Response(ARXIV_ATOM_FIXTURE, { status: 200, headers: { "content-type": "application/atom+xml" } });
  };
  const patch = await fetchArxiv("arXiv:2401.12345v2", fakeFetch);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /id_list=2401\.12345$/);
  assert.equal(patch.title, "A Test Paper on Compressed Memory & Recourse");
});

test("fetchArxiv maps a non-OK response to MetadataError(network)", async () => {
  const fakeFetch = async () => new Response("", { status: 503 });
  await assert.rejects(fetchArxiv("2401.12345", fakeFetch), (err: unknown) => err instanceof MetadataError && err.code === "network");
});

test("fetchArxiv maps a thrown fetch to MetadataError(network)", async () => {
  const fakeFetch = async (): Promise<Response> => {
    throw new Error("ECONNREFUSED");
  };
  await assert.rejects(fetchArxiv("2401.12345", fakeFetch), (err: unknown) => err instanceof MetadataError && err.code === "network");
});

// ── Crossref / DOI ───────────────────────────────────────────────────

const CROSSREF_FIXTURE = {
  status: "ok",
  message: {
    title: ["A Crossref Paper"],
    author: [
      { given: "Carol", family: "Researcher" },
      { name: "Dan O'Doe" },
    ],
    issued: { "date-parts": [[2023, 6, 1]] },
    "container-title": ["Journal of Tests"],
    URL: "https://doi.org/10.1145/example",
    DOI: "10.1145/example",
    abstract: "<jats:p>We propose a new technique.</jats:p>",
  },
};

test("parseCrossrefWork extracts title, authors, year, venue, url, doi, summary", () => {
  const patch = parseCrossrefWork(CROSSREF_FIXTURE.message);
  assert.equal(patch.title, "A Crossref Paper");
  assert.deepEqual(patch.authors, ["Carol Researcher", "Dan O'Doe"]);
  assert.equal(patch.year, 2023);
  assert.equal(patch.venue, "Journal of Tests");
  assert.equal(patch.url, "https://doi.org/10.1145/example");
  assert.equal(patch.doi, "10.1145/example");
  assert.equal(patch.summary, "We propose a new technique.");
});

test("fetchDoi routes through the injected fetch and returns the parsed patch", async () => {
  const calls: string[] = [];
  const fakeFetch = async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify(CROSSREF_FIXTURE), { status: 200, headers: { "content-type": "application/json" } });
  };
  const patch = await fetchDoi("10.1145/example", fakeFetch);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /api\.crossref\.org\/works\/10\.1145%2Fexample$/);
  assert.equal(patch.title, "A Crossref Paper");
});

test("fetchDoi maps 404 to MetadataError(not-found)", async () => {
  const fakeFetch = async () => new Response("", { status: 404 });
  await assert.rejects(fetchDoi("10.1145/missing", fakeFetch), (err: unknown) => err instanceof MetadataError && err.code === "not-found");
});

test("fetchDoi maps a non-ok status (other than 404) to MetadataError(network)", async () => {
  const fakeFetch = async () => new Response("", { status: 500 });
  await assert.rejects(fetchDoi("10.1145/whatever", fakeFetch), (err: unknown) => err instanceof MetadataError && err.code === "network");
});

test("fetchDoi maps a malformed body (status != ok) to MetadataError(not-found)", async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ status: "failed" }), { status: 200, headers: { "content-type": "application/json" } });
  await assert.rejects(fetchDoi("10.1145/whatever", fakeFetch), (err: unknown) => err instanceof MetadataError && err.code === "not-found");
});
