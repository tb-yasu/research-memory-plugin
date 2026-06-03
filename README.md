# Personal Literature Memory

A [MulmoClaude](https://github.com/receptron/mulmoclaude) runtime plugin that turns the papers you read into **reusable, research-connected memory** — not summaries.

> Reading a paper and summarizing it is easy and commoditized. The hard part is remembering, months later, *how this paper relates to your own research* and *where you can reuse it*. This plugin captures exactly that, and lets you (and an LLM) query it.

> **A note on the name.** The npm package is `research-memory-plugin` to match the longer arc — a general *research-state* model spanning Claim / Evidence / Decision / Context (see [Roadmap](#roadmap)). Today's shipped scope is **literature only** — papers, the citation spine, BibTeX/Excel export, and a research profile.

Every paper is stored as a **Paper Card**: the paper's own content (summary, claims, method, limitations) **plus the relational spine** — the part Zotero/Notion don't have:

- **Relation to my work** — competitor / related / inspiration / contrast, specifically.
- **Citation purposes** — what you'd cite it for, and in which section (Related Work, Method, …).
- **Reusable ideas** — techniques you could borrow.
- **Next actions** — papers to read, experiments to try.
- **Themes** — research threads, used by the filter and the citation table.

## What you can do

- **Capture from chat** — paste an abstract and your notes; the LLM extracts a Paper Card and fills the spine relative to your research focus, then saves it.
- **Search & filter** — full-text search, theme filter, and *year-from* filter over your whole corpus (deterministic, in the plugin).
- **Citation table** — for a theme, get a table of *which paper to cite, for what, in which section* — straight into your Related Work.
- **Export** — BibTeX, a numbered reference list, a markdown bundle, or an Excel workbook.
- **Research profile** — capture your current focus, themes, and open questions; the LLM uses this to ground every paper's *Relation to my work* and *Citation purposes*.
- **Add/edit by hand** — a form in the canvas; the plugin is fully usable without the LLM.

## How it works (design)

This follows MulmoClaude's architecture — *the API/logic is the product; GUI and LLM are both clients of it*:

- **The plugin (TypeScript) owns all deterministic logic** — schema & validation, storage (one JSON file per paper under `files.data`), search/ranking, the citation table, and BibTeX/reference/markdown export. Pure, unit-tested modules (`card.ts`, `search.ts`, `citation.ts`).
- **The chat LLM does only natural-language extraction** — turning a pasted abstract into structured card fields. That instruction lives in a workspace **role prompt**, not in code.

So the "intelligence" is the LLM; the plugin is a dependable, testable store with a real UI.

| Module | Responsibility |
|---|---|
| `src/card.ts` | `PaperCard` schema, JSON (de)serialize, slug rules, partial-merge |
| `src/search.ts` | `filterCards` / `rankCards` / `sortCards` (keyword + recency + year-from) |
| `src/citation.ts` | `citationTable`, `toBibTeX`, `toReferenceList`, `toMarkdownBundle` |
| `src/profile.ts` | `ResearchProfile` read / write (focus / themes / open questions) |
| `src/excel.ts` | XLSX workbook for the Excel export |
| `src/index.ts` | `definePlugin` factory: CRUD + list/search + citationTable + export + profile |
| `src/View.vue` | browse (list + detail + theme/year filter + search), citation-table mode, export, add/edit form, profile editor |

The MCP tool is `manageLiterature` (kinds: `list`, `read`, `save`, `update`, `delete`, `citationTable`, `export`, `getProfile`, `setProfile`).

## Develop against MulmoClaude

```bash
yarn install
yarn build            # produces dist/index.js + dist/vue.js (required before loading)
```

Then load it as a dev plugin (two terminals):

```bash
# Terminal A — keep dist/ fresh on every save
yarn dev              # vite build --watch

# Terminal B — boot MulmoClaude with this plugin loaded
mulmoclaude --dev-plugin /ABS/PATH/TO/research-memory-plugin
```

Running MulmoClaude **from a source checkout** instead of the published launcher? The launcher just sets `MULMOCLAUDE_DEV_PLUGINS`, so the equivalent is:

```bash
MULMOCLAUDE_DEV_PLUGINS=/ABS/PATH/TO/research-memory-plugin yarn dev   # in the mulmoclaude repo
```

### Make the tool callable (required)

Runtime-plugin tools are gated by a role's `availablePlugins`. Add a role at `~/mulmoclaude/config/roles/research.json` granting `manageLiterature` (a ready-made one is in [`examples/research-role.json`](examples/research-role.json) — its `prompt` is what teaches the LLM to extract Paper Cards). If the role doesn't appear, create the same role from the in-app `/roles` UI. Then pick the **Research** role in a chat.

### Seed the demo data

```bash
mkdir -p ~/mulmoclaude/data/plugins/research-memory-plugin/papers
cp examples/papers/*.json ~/mulmoclaude/data/plugins/research-memory-plugin/papers/
cp examples/profile.json  ~/mulmoclaude/data/plugins/research-memory-plugin/profile.json
```

Seven sample cards across *Agentic Memory*, *Counterfactual Recourse*, and *Compressed Indexing* so search / theme filter / citation table / export all work immediately — plus a pre-filled research profile so the *Relation to my work* fields are grounded from the start.

## Demo (the loop)

1. **Capture** — Research role → "Register this paper in my Agentic Memory context: \<abstract\>" → a Paper Card appears with the spine filled.
2. **Search** — "Search my papers for recourse cost".
3. **Citation table** — "Give me the citation table for Agentic Memory".
4. **Export** — "Export BibTeX for the Compressed Indexing theme".

## Tests

```bash
yarn test     # tsx --test: card schema, search/ranking, citation/BibTeX, profile read-write, Excel export, fixtures, and an end-to-end handler round-trip
```

## Roadmap

This is the *capture* on-ramp. The longer arc generalizes the relational spine into a research-state model — **Claim / Evidence / Decision / Context** — to support not just papers but research decisions ("why I dropped this dataset"), rebuttal support (which result answers a reviewer), and project resume ("where did I leave off?"). Near-term: arXiv/DOI metadata auto-fill, a theme/citation graph, dedup/merge.

## License

MIT
