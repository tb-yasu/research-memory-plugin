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

function makeRuntime() {
  const data = memFileOps();
  const noop = () => undefined;
  const runtime = {
    pubsub: { publish: noop },
    files: { data: data.ops, config: memFileOps().ops },
    log: { debug: noop, info: noop, warn: noop, error: noop },
    locale: "en",
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { plugin: createPlugin(runtime as any), store: data.store };
}

test("save → list → read → update(merge) → citationTable → export → delete", async () => {
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
