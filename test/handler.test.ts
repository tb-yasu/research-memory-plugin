// End-to-end test of the server handler against an in-memory runtime.
// definePlugin(setup) returns (runtime) => { TOOL_DEFINITION, manageLiterature },
// so we can exercise the full CRUD + citation + export pipeline without
// booting MulmoClaude. (Test files are not type-checked by `yarn typecheck`
// nor linted by `yarn lint` — they run through tsx/esbuild — so the loose
// casts below are intentional and contained.)

import test from "node:test";
import assert from "node:assert/strict";
import createPlugin from "../src/index";

function memFileOps() {
  const store = new Map<string, string>();
  const read = async (rel: string): Promise<string> => {
    const v = store.get(rel);
    if (v === undefined) throw new Error(`ENOENT: ${rel}`);
    return v;
  };
  const ops = {
    read,
    readBytes: async (rel: string) => new TextEncoder().encode(await read(rel)),
    write: async (rel: string, content: string | Uint8Array) => {
      store.set(rel, typeof content === "string" ? content : new TextDecoder().decode(content));
    },
    readDir: async (rel: string) => {
      const prefix = rel.endsWith("/") ? rel : `${rel}/`;
      const names = new Set<string>();
      for (const key of store.keys()) if (key.startsWith(prefix)) names.add(key.slice(prefix.length).split("/")[0]);
      return [...names];
    },
    stat: async (rel: string) => ({ mtimeMs: 0, size: (store.get(rel) ?? "").length }),
    exists: async (rel: string) => {
      if (store.has(rel)) return true;
      const prefix = rel.endsWith("/") ? rel : `${rel}/`;
      for (const key of store.keys()) if (key.startsWith(prefix)) return true;
      return false;
    },
    unlink: async (rel: string) => void store.delete(rel),
  };
  return { store, ops };
}

function makeRuntime(fetch?: (url: string) => Promise<Response>) {
  const data = memFileOps();
  const noop = () => undefined;
  const runtime = {
    pubsub: { publish: noop },
    files: { data: data.ops, config: memFileOps().ops },
    log: { debug: noop, info: noop, warn: noop, error: noop },
    locale: "en",
    fetch,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { plugin: createPlugin(runtime as any), store: data.store };
}

test("save → list → read → update(merge) → citationTable → relatedWork → export → delete", async () => {
  const { plugin, store } = makeRuntime();

  const saved = (await plugin.manageLiterature({
    kind: "save",
    slug: "mem-a",
    title: "Long-term memory",
    authors: ["Jane Doe"],
    year: 2024,
    venue: "NeurIPS",
    themes: ["Agentic Memory"],
    relationToMyWork: "baseline for my content store",
    citationPurposes: [{ purpose: "existing long-term memory design", suggestedSection: "Related Work" }],
  })) as any;
  assert.equal(saved.data.view, "detail");
  assert.equal(saved.data.card.slug, "mem-a");
  assert.ok(store.has("papers/mem-a.json"), "card persisted to papers/mem-a.json");

  const list = (await plugin.manageLiterature({ kind: "list" })) as any;
  assert.equal(list.data.cards.length, 1);

  // update with only themes must preserve relationToMyWork (partial merge)
  await plugin.manageLiterature({ kind: "update", slug: "mem-a", themes: ["Agentic Memory", "Memory"] });
  const reread = (await plugin.manageLiterature({ kind: "read", slug: "mem-a" })) as any;
  assert.equal(reread.data.card.relationToMyWork, "baseline for my content store");
  assert.deepEqual(reread.data.card.themes, ["Agentic Memory", "Memory"]);

  const ct = (await plugin.manageLiterature({ kind: "citationTable", theme: "Agentic Memory" })) as any;
  assert.equal(ct.data.rows.length, 1);
  assert.equal(ct.data.rows[0].purpose, "existing long-term memory design");

  // relatedWork: the co-theme "Memory" (added by the update above) becomes the group.
  const rw = (await plugin.manageLiterature({ kind: "relatedWork", theme: "Agentic Memory" })) as any;
  assert.equal(rw.data.view, "relatedWork");
  assert.equal(rw.data.outline.paperCount, 1);
  assert.equal(rw.data.outline.groups[0].label, "Memory");
  assert.deepEqual(rw.data.outline.groups[0].points, [{ slug: "mem-a", title: "Long-term memory", text: "baseline for my content store" }]);
  assert.match(rw.data.markdown, /# Related Work アウトライン — Agentic Memory/);
  assert.match(rw.jsonData, /引用目的: existing long-term memory design（Related Work）/);
  assert.equal(store.get("related-work/agentic-memory.md"), rw.data.markdown, "outline markdown persisted per theme");

  const bib = (await plugin.manageLiterature({ kind: "export", format: "bibtex" })) as any;
  assert.match(bib.data.content, /@article\{doe2024,/);

  const del = (await plugin.manageLiterature({ kind: "delete", slug: "mem-a" })) as any;
  assert.equal(del.data.view, "list");
  assert.equal(store.has("papers/mem-a.json"), false);
});

test("save rejects an invalid (non-kebab) slug", async () => {
  const { plugin } = makeRuntime();
  const res = (await plugin.manageLiterature({ kind: "save", slug: "Bad Slug", title: "x" })) as any;
  assert.ok(res.error, "should return an error envelope");
});

test("update on a missing slug returns not-found", async () => {
  const { plugin } = makeRuntime();
  const res = (await plugin.manageLiterature({ kind: "update", slug: "ghost", title: "x" })) as any;
  assert.ok(res.error, "should return an error envelope");
});

test("fetchMetadata(arxivId) routes through runtime.fetch and returns a patch envelope", async () => {
  const xml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2401.99999v1</id>
    <published>2024-05-01T00:00:00Z</published>
    <title>Test arXiv paper</title>
    <summary>A short abstract.</summary>
    <author><name>Eve Author</name></author>
  </entry>
</feed>`;
  const fakeFetch = async (_url: string) => new Response(xml, { status: 200 });
  const { plugin } = makeRuntime(fakeFetch);
  const res = (await plugin.manageLiterature({ kind: "fetchMetadata", arxivId: "2401.99999" })) as any;
  assert.equal(res.data, undefined, "fetchMetadata returns no canvas data (LLM-only payload)");
  assert.equal(res.jsonData.title, "Test arXiv paper");
  assert.equal(res.jsonData.year, 2024);
  assert.deepEqual(res.jsonData.authors, ["Eve Author"]);
  assert.equal(res.jsonData.arxivId, "2401.99999");
});

test("fetchMetadata without arxivId or doi returns a 400 error envelope", async () => {
  const { plugin } = makeRuntime();
  const res = (await plugin.manageLiterature({ kind: "fetchMetadata" })) as any;
  assert.equal(res.status, 400);
  assert.match(res.error, /arxivId or doi/);
});

test("save blocks a second card with the same DOI; force=true overrides; mergePapers preserves spine", async () => {
  const { plugin, store } = makeRuntime();

  // Round 1: first save succeeds, spine attached.
  const first = (await plugin.manageLiterature({
    kind: "save",
    slug: "mem-a",
    title: "Long-term memory",
    authors: ["Jane Doe"],
    year: 2024,
    doi: "10.1234/example",
    themes: ["Agentic Memory"],
    relationToMyWork: "baseline for my content store",
    citationPurposes: [{ purpose: "existing long-term memory design", suggestedSection: "Related Work" }],
  })) as any;
  assert.equal(first.data.view, "detail");

  // Round 2: a second slug with the same DOI must be blocked.
  const blocked = (await plugin.manageLiterature({
    kind: "save",
    slug: "mem-a-redux",
    title: "Long-term memory (variant)",
    doi: "10.1234/example",
    themes: ["Memory"],
  })) as any;
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.view, "conflict");
  assert.equal(blocked.data.duplicates.length, 1);
  assert.equal(blocked.data.duplicates[0].slug, "mem-a");
  assert.equal(blocked.data.duplicates[0].reason, "doi");
  assert.equal(store.has("papers/mem-a-redux.json"), false, "blocked save must not write a file");

  // Round 3: mergePapers preserves the relational spine while adopting the new themes / year.
  const merged = (await plugin.manageLiterature({
    kind: "mergePapers",
    targetSlug: "mem-a",
    title: "Long-term memory (variant)",
    year: 2025,
    themes: ["Memory"],
  })) as any;
  assert.equal(merged.data.view, "detail");
  assert.equal(merged.data.card.slug, "mem-a");
  assert.equal(merged.data.card.year, 2025);
  assert.deepEqual(merged.data.card.themes, ["Agentic Memory", "Memory"]);
  assert.equal(merged.data.card.relationToMyWork, "baseline for my content store", "spine preserved by mergeFull");
  assert.equal(merged.data.card.citationPurposes.length, 1, "citation purposes preserved");
});

test("save with force=true bypasses the duplicate check", async () => {
  const { plugin, store } = makeRuntime();
  await plugin.manageLiterature({ kind: "save", slug: "p1", title: "Paper", arxivId: "2401.99999" });
  const forced = (await plugin.manageLiterature({
    kind: "save",
    slug: "p2",
    title: "Paper variant",
    arxivId: "2401.99999",
    force: true,
  })) as any;
  assert.equal(forced.data?.view, "detail", "force=true bypasses the conflict block");
  assert.ok(store.has("papers/p2.json"), "forced save persists the new slug");
});

test("save with only a title near-match returns success + a warning field", async () => {
  const { plugin } = makeRuntime();
  await plugin.manageLiterature({ kind: "save", slug: "p1", title: "MemGPT: Towards LLMs as Operating Systems" });
  // No DOI or arxivId — only a normalized title collision.
  const res = (await plugin.manageLiterature({
    kind: "save",
    slug: "p2",
    title: "memgpt towards llms as operating systems",
  })) as any;
  assert.equal(res.data?.view, "detail", "soft match still saves");
  assert.ok(Array.isArray(res.warning), "warning array attached for the soft match");
  assert.match(res.warning[0], /p1/);
});

test("mergePapers returns not-found when the target slug doesn't exist", async () => {
  const { plugin } = makeRuntime();
  const res = (await plugin.manageLiterature({ kind: "mergePapers", targetSlug: "ghost", title: "x" })) as any;
  assert.equal(res.status, 404);
});

// ── Ideation (ideate / saveIdea / listIdeas / updateIdea / deleteIdea) ──

async function seedCards(plugin: any): Promise<void> {
  await plugin.manageLiterature({ kind: "save", slug: "mem-a", title: "Long-term memory", arxivId: "2401.00001", themes: ["Agentic Memory"], limitations: ["flat entries"], relationToMyWork: "baseline" });
  await plugin.manageLiterature({ kind: "save", slug: "idx-b", title: "Dynamic index", themes: ["Compressed Indexing", "Agentic Memory"], reusableIdeas: ["succinct sampling"] });
}

test("ideate by slugs returns material + missingSlugs, no canvas data", async () => {
  const { plugin } = makeRuntime();
  await seedCards(plugin);
  await plugin.manageLiterature({ kind: "setProfile", focus: "compressed agent memory" });

  const res = (await plugin.manageLiterature({ kind: "ideate", slugs: ["mem-a", "ghost"] })) as any;
  assert.equal(res.data, undefined, "ideate returns no canvas data (LLM-only payload)");
  assert.deepEqual(res.jsonData.papers.map((p: any) => p.slug), ["mem-a"]);
  assert.deepEqual(res.jsonData.missingSlugs, ["ghost"]);
  assert.equal(res.jsonData.profile.focus, "compressed agent memory");
  assert.match(res.message, /ghost/, "missing slug surfaced in the message");
  assert.match(res.message, /idea-miner/, "mining procedure included");
  assert.match(res.message, /mem-a/, "arxivId-bearing paper listed as minable");
});

test("ideate unions slugs and theme, deduped; thinCards and empty profile noted", async () => {
  const { plugin } = makeRuntime();
  await seedCards(plugin);

  // mem-a matches both the explicit slug and the theme — must appear once.
  const res = (await plugin.manageLiterature({ kind: "ideate", slugs: ["mem-a"], theme: "Agentic Memory" })) as any;
  assert.deepEqual(res.jsonData.papers.map((p: any) => p.slug), ["mem-a", "idx-b"]);
  assert.equal(res.jsonData.profile, null);
  assert.match(res.message, /profile is EMPTY/i);
  assert.deepEqual(res.jsonData.sharedThemes, ["Agentic Memory"]);
});

test("ideate requires slugs or theme (400) and 404s when nothing resolves", async () => {
  const { plugin } = makeRuntime();
  const bad = (await plugin.manageLiterature({ kind: "ideate" })) as any;
  assert.equal(bad.status, 400);
  const none = (await plugin.manageLiterature({ kind: "ideate", slugs: ["ghost"] })) as any;
  assert.equal(none.status, 404);
  assert.match(none.error, /ghost/);
});

test("saveIdea persists with defaults; listIdeas round-trips; invalid slug 400", async () => {
  const { plugin, store } = makeRuntime();
  await seedCards(plugin);

  const saved = (await plugin.manageLiterature({
    kind: "saveIdea",
    slug: "compressed-decisions",
    title: "Compressed decision log",
    description: "Index decisions with a self-index.",
    sourcePapers: ["mem-a", "idx-b"],
    themes: ["Agentic Memory"],
  })) as any;
  assert.equal(saved.data, undefined, "ideas have no canvas view");
  assert.equal(saved.jsonData.status, "raw", "status defaults to raw");
  assert.equal(saved.warning, undefined, "known sourcePapers produce no warning");
  assert.ok(store.has("ideas/compressed-decisions.json"));

  const list = (await plugin.manageLiterature({ kind: "listIdeas" })) as any;
  assert.equal(list.jsonData.length, 1);
  assert.equal(list.jsonData[0].slug, "compressed-decisions");

  const bad = (await plugin.manageLiterature({ kind: "saveIdea", slug: "Bad Slug", title: "x", description: "d" })) as any;
  assert.equal(bad.status, 400);
});

test("saveIdea warns on unknown sourcePapers but still saves", async () => {
  const { plugin, store } = makeRuntime();
  const res = (await plugin.manageLiterature({
    kind: "saveIdea",
    slug: "orphan-idea",
    title: "t",
    description: "d",
    sourcePapers: ["nonexistent-card"],
  })) as any;
  assert.ok(store.has("ideas/orphan-idea.json"), "saved despite unknown source");
  assert.ok(Array.isArray(res.warning));
  assert.match(res.warning[0], /nonexistent-card/);
});

test("saveIdea collision → 409 without overwrite; force=true overwrites and preserves created", async () => {
  const { plugin, store } = makeRuntime();
  await plugin.manageLiterature({ kind: "saveIdea", slug: "i1", title: "v1", description: "first" });
  const created = JSON.parse(store.get("ideas/i1.json")!).created;

  const blocked = (await plugin.manageLiterature({ kind: "saveIdea", slug: "i1", title: "v2", description: "second" })) as any;
  assert.equal(blocked.status, 409);
  assert.equal(JSON.parse(store.get("ideas/i1.json")!).title, "v1", "blocked save must not overwrite");

  const forced = (await plugin.manageLiterature({ kind: "saveIdea", slug: "i1", title: "v2", description: "second", force: true })) as any;
  assert.equal(forced.jsonData.title, "v2");
  assert.equal(forced.jsonData.created, created, "force overwrite preserves created");
});

test("listIdeas filters by theme and status; updateIdea patches partially; deleteIdea removes", async () => {
  const { plugin, store } = makeRuntime();
  await plugin.manageLiterature({ kind: "saveIdea", slug: "i1", title: "a", description: "da", themes: ["Memory"] });
  await plugin.manageLiterature({ kind: "saveIdea", slug: "i2", title: "b", description: "db", themes: ["Index"], status: "exploring" });

  const byTheme = (await plugin.manageLiterature({ kind: "listIdeas", theme: "Memory" })) as any;
  assert.deepEqual(byTheme.jsonData.map((i: any) => i.slug), ["i1"]);
  const byStatus = (await plugin.manageLiterature({ kind: "listIdeas", status: "exploring" })) as any;
  assert.deepEqual(byStatus.jsonData.map((i: any) => i.slug), ["i2"]);

  // status-only patch preserves description (partial merge)
  const upd = (await plugin.manageLiterature({ kind: "updateIdea", slug: "i1", status: "adopted" })) as any;
  assert.equal(upd.jsonData.status, "adopted");
  assert.equal(upd.jsonData.description, "da");

  const missing = (await plugin.manageLiterature({ kind: "updateIdea", slug: "ghost", status: "dropped" })) as any;
  assert.equal(missing.status, 404);
  const delMissing = (await plugin.manageLiterature({ kind: "deleteIdea", slug: "ghost" })) as any;
  assert.equal(delMissing.status, 404);

  await plugin.manageLiterature({ kind: "deleteIdea", slug: "i1" });
  assert.equal(store.has("ideas/i1.json"), false);
});

test("setProfile then getProfile round-trips the research profile (partial merge preserves themes)", async () => {
  const { plugin } = makeRuntime();

  const empty = (await plugin.manageLiterature({ kind: "getProfile" })) as any;
  assert.equal(empty.data.view, "profile");
  assert.equal(empty.data.profile.focus, "");

  await plugin.manageLiterature({ kind: "setProfile", focus: "compressed agent memory", themes: ["Agentic Memory"], questions: ["dynamic index?"] });
  const got = (await plugin.manageLiterature({ kind: "getProfile" })) as any;
  assert.equal(got.data.profile.focus, "compressed agent memory");
  assert.deepEqual(got.data.profile.themes, ["Agentic Memory"]);

  // focus-only update must preserve themes
  await plugin.manageLiterature({ kind: "setProfile", focus: "updated focus" });
  const got2 = (await plugin.manageLiterature({ kind: "getProfile" })) as any;
  assert.equal(got2.data.profile.focus, "updated focus");
  assert.deepEqual(got2.data.profile.themes, ["Agentic Memory"]);
});
