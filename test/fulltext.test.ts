// Pure text-helper + injected-fetch tests for src/fulltext.ts. No network.

import test from "node:test";
import assert from "node:assert/strict";
import { MetadataError } from "../src/metadata";
import { condenseForReading, cutAtReferences, extractReadableText, fetchArxivFullText, HEAD_CHARS, MIN_TEXT_CHARS, TAIL_CHARS } from "../src/fulltext";

// ── extractReadableText ───────────────────────────────────────────────

test("extractReadableText drops script/style/math subtrees, tags, and decodes entities", () => {
  const html = `<html><head><style>.x{color:red}</style><script>alert("no")</script></head>
    <body><h1>A &amp; B</h1><p>We propose <math><mi>x</mi><mo>=</mo><mn>1</mn></math> a new &#x2113;-index&#8217;s variant.</p></body></html>`;
  const text = extractReadableText(html);
  assert.ok(!text.includes("alert"), "script content removed");
  assert.ok(!text.includes("color:red"), "style content removed");
  assert.ok(!text.includes("<mi>") && !text.includes("x = 1"), "MathML subtree removed");
  assert.match(text, /A & B/);
  assert.match(text, /ℓ-index’s variant/);
});

// ── cutAtReferences ───────────────────────────────────────────────────

test("cutAtReferences cuts at the LAST References heading near the end", () => {
  const body = "Intro mentions References early. " + "x".repeat(400) + " Conclusion. References [1] Foo. [2] Bar.";
  const cut = cutAtReferences(body);
  assert.ok(cut.endsWith("Conclusion."));
  assert.ok(!cut.includes("[1] Foo"));
});

test("cutAtReferences leaves text alone when the only hit is early (TOC/inline mention)", () => {
  const body = "See References below. " + "x".repeat(400);
  assert.equal(cutAtReferences(body), body);
});

// ── condenseForReading ────────────────────────────────────────────────

test("condenseForReading keeps short text verbatim and elides the middle of long text", () => {
  assert.equal(condenseForReading("short body"), "short body");
  const long = "H".repeat(HEAD_CHARS) + "M".repeat(5000) + "T".repeat(TAIL_CHARS);
  const condensed = condenseForReading(long);
  assert.ok(condensed.startsWith("H".repeat(100)));
  assert.ok(condensed.endsWith("T".repeat(100)));
  assert.match(condensed, /中略/);
  assert.ok(condensed.length < long.length);
});

// ── fetchArxivFullText ────────────────────────────────────────────────

const LONG_HTML = `<html><body><p>${"A real paper body. ".repeat(Math.ceil(MIN_TEXT_CHARS / 19) + 10)}</p></body></html>`;

test("fetchArxivFullText returns arxiv.org html when the first source hits", async () => {
  const calls: string[] = [];
  const fakeFetch = async (url: string) => {
    calls.push(url);
    return new Response(LONG_HTML, { status: 200, headers: { "content-type": "text/html" } });
  };
  const out = await fetchArxivFullText("arXiv:2401.12345v2", fakeFetch);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^https:\/\/arxiv\.org\/html\/2401\.12345$/);
  assert.equal(out.source, calls[0]);
  assert.match(out.text, /A real paper body\./);
});

test("fetchArxivFullText falls back to ar5iv on 404 and on a thrown first fetch", async () => {
  const notFoundThenOk = async (url: string) =>
    url.includes("ar5iv") ? new Response(LONG_HTML, { status: 200 }) : new Response("", { status: 404 });
  const viaAr5iv = await fetchArxivFullText("2401.12345", notFoundThenOk);
  assert.match(viaAr5iv.source, /ar5iv\.labs\.arxiv\.org/);

  const throwThenOk = async (url: string): Promise<Response> => {
    if (!url.includes("ar5iv")) throw new Error("ECONNRESET");
    return new Response(LONG_HTML, { status: 200 });
  };
  const afterThrow = await fetchArxivFullText("2401.12345", throwThenOk);
  assert.match(afterThrow.source, /ar5iv/);
});

test("fetchArxivFullText treats a stub page as a miss and reports not-found when all sources fail", async () => {
  const stub = async () => new Response("<html><body>conversion failed</body></html>", { status: 200 });
  await assert.rejects(fetchArxivFullText("2401.12345", stub), (err: unknown) => err instanceof MetadataError && err.code === "not-found" && /too short/.test(err.message));

  const allMiss = async () => new Response("", { status: 404 });
  await assert.rejects(fetchArxivFullText("2401.12345", allMiss), (err: unknown) => err instanceof MetadataError && err.code === "not-found");
});
