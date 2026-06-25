# Research Memory

A [MulmoClaude](https://github.com/receptron/mulmoclaude) runtime plugin for *research-connected memory*. **Today's scope: literature** — turning the papers you read into a relational, queryable store, not summaries. The longer arc generalizes the spine to a research-state model — Claim / Evidence / Decision / Context (see [Roadmap](#roadmap)).

> Reading a paper and summarizing it is easy and commoditized. The hard part is remembering, months later, *how this paper relates to your own research* and *where you can reuse it*. This plugin captures exactly that, and lets you (and an LLM) query it.

Every paper is stored as a **Paper Card**: the paper's own content (summary, claims, method, limitations) **plus the relational spine** — the part Zotero/Notion don't have:

- **Relation to my work** — competitor / related / inspiration / contrast, specifically.
- **Citation purposes** — what you'd cite it for, and in which section (Related Work, Method, …).
- **Reusable ideas** — techniques you could borrow.
- **Next actions** — papers to read, experiments to try.
- **Themes** — research threads, used by the filter, the citation table, and Related Work grouping.

## What you can do

- **Capture from chat** — paste an abstract or just say `arXiv:2401.12345` / `DOI:10.xxxx/yyyy`; the plugin auto-fills the metadata (title, authors, year, venue, abstract, URL) from arXiv or Crossref, and the LLM adds the relational spine relative to your research focus.
- **Find papers by theme** — `2024年以降の Agentic Memory の論文を探して` searches OpenAlex + arXiv (merged & de-duplicated; year range, up to 100 hits per source, optional venue), marks candidates already in your store, and registers only the ones you pick.
- **Full-paper reading on registration** — picked candidates with an arXiv id get their body fetched (arxiv.org/html, ar5iv fallback; references stripped, middle elided) so the card is a full Ochiai extraction, not an abstract dump. With the optional `paper-reader` subagent (`examples/agents/`), each paper is read in a disposable context — in parallel, without bloating the chat.
- **Next-research ideas from selected papers** — `さっき登録した3本から次の研究アイデアを出して`: the plugin gathers ideation material (limitations, methods, reusable ideas, your relation notes + research profile), the optional `idea-miner` subagent re-reads each paper's body for fuel the cards don't record (fragile assumptions, future-work hints), and the LLM synthesizes 3-5 grounded ideas. Keep the good ones as Idea records (`ideas/<slug>.json`, linked to their source papers, with a raw → exploring → adopted/dropped lifecycle). Papers can also be picked with **checkboxes in the canvas list** — the selection persists server-side, and `選択した論文からアイデアを出して` in chat picks it up (a View button cannot start the LLM — the plugin runtime has no chat-injection API). Theme-wide selections get a confirm-the-list step first; checkbox/slug selections run immediately.
- **Choose the idea engine — Claude or Codex** — the canvas panel has an *Idea engine* switch. With **Claude** (default) the host synthesizes in chat as above. With **Codex** the plugin shells out to the `codex` CLI (`codex exec`, prompt on stdin, sandboxed read-only) and returns ready-made ideas — you also pick the **model** (editable; suggestions in the dropdown) and the **reasoning effort** (思考力: low / medium / high, mapped to `model_reasoning_effort`). The choice persists in `engine-config.json` and applies to every `ideate` call. **Requires the `codex` CLI installed on the host and a completed `codex login`.** Which models are valid depends on the codex auth: a **ChatGPT-account** login accepts only the codex default (**gpt-5.5** as of codex 0.139), while an **OpenAI API key** unlocks gpt-5-codex / gpt-5 / o3 / o4-mini — type whatever your account supports. (`minimal` reasoning is intentionally omitted: codex's default web_search / image_gen tools are rejected under it.) The Codex path uses the gathered card material; it does not run the `idea-miner` full-text subagents (those are Claude-only).
- **Search & filter** — full-text search, theme filter, and *year-from* filter over your whole corpus (deterministic, in the plugin).
- **Citation table** — for a theme, get a table of *which paper to cite, for what, in which section* — straight into your Related Work.
- **Related Work outline** — one step past the citation table: ask `Generate a Related Work outline for theme: Agentic Memory` and the reply IS the outline markdown — paper groups (by co-occurring themes), each group's discussion points (your own *Relation to my work* notes), each paper's 要点 (novelty/summary) and citation purposes. Extraction, grouping, and ordering are deterministic in the plugin; the LLM may only smooth the bullets into prose — grounded in the card content, never reordering or inventing papers. Papers missing a citation purpose are flagged so you can fill the gap before writing. Each call also persists the markdown to `related-work/<theme-slug>.md` in the plugin's data dir (one file per theme, overwritten) — files are the source of truth, so later "save it / draft on it" requests just read the file.
- **Readable card mirror + wiki links** — every saved card is mirrored to a clean `papers/<slug>.md` (the Ochiai template + relational spine), regenerated on each write. Link to a card from a wiki page (or anywhere a workspace link renders) with `[Title](data/plugins/research-memory-plugin/papers/<slug>.md)` — it opens as rendered Markdown, never the raw JSON. The JSON stays the store of record; the `.md` is the human-readable view.
- **Export** — BibTeX, a numbered reference list, a markdown bundle, or an Excel workbook.
- **Research profile** — capture your current focus, themes, and open questions; the LLM uses this to ground every paper's *Relation to my work* and *Citation purposes*.
- **Duplicate detection + merge** — re-registering the same paper (by DOI, arXiv id, or near-identical title) blocks the save and offers *merge*, *overwrite*, or *skip*. Merging unions arrays and preserves your relational spine — the LLM never silently overwrites months-old notes.
- **Add/edit by hand** — a form in the canvas; the plugin is fully usable without the LLM.

## How it works (design)

This follows MulmoClaude's architecture — *the API/logic is the product; GUI and LLM are both clients of it*:

- **The plugin (TypeScript) owns all deterministic logic** — schema & validation, storage (one JSON file per paper under `files.data`), search/ranking, the citation table, the Related Work outline, and BibTeX/reference/markdown export. Pure, unit-tested modules (`card.ts`, `search.ts`, `citation.ts`, `relatedwork.ts`).
- **The chat LLM does only natural-language extraction** — turning a pasted abstract into structured card fields. That instruction lives in a workspace **role prompt**, not in code.

So the "intelligence" is the LLM; the plugin is a dependable, testable store with a real UI.

| Module | Responsibility |
|---|---|
| `src/card.ts` | `PaperCard` schema, JSON (de)serialize, slug rules, partial-merge, duplicate detection + two-card `mergeFull` |
| `src/search.ts` | `filterCards` / `rankCards` / `sortCards` (keyword + recency + year-from) |
| `src/citation.ts` | `citationTable`, `toBibTeX`, `toReferenceList`, `toMarkdownBundle` |
| `src/relatedwork.ts` | `buildRelatedWorkOutline` (co-theme grouping, chronological order, discussion points, purpose ranking, gap detection) + `relatedWorkToMarkdown` |
| `src/profile.ts` | `ResearchProfile` read / write (focus / themes / open questions) |
| `src/metadata.ts` | arXiv Atom + Crossref/DOI parsers; returns a `MetadataPatch` the LLM passes to `save` |
| `src/papersearch.ts` | OpenAlex + arXiv search (relevance, year range, venue→source id, limit clamp, gist truncation), candidate merge/de-dup, and existing-card annotation |
| `src/fulltext.ts` | arXiv HTML / ar5iv full-text fetcher (markup stripped, references cut, middle elided) for full-Ochiai extraction |
| `src/idea.ts` | `Idea` schema (description / motivation / firstExperiment / sourcePapers / status lifecycle), JSON (de)serialize, partial-merge |
| `src/ideate.ts` | `gatherIdeationMaterial` — per-card ideation fuel + profile + shared themes + thin-card detection (deterministic; the LLM does the ideation) |
| `src/engine.ts` | `EngineConfig` (engine claude/codex + Codex model + reasoning effort) read / write / merge — the ideation-engine switch |
| `src/codex.ts` | Codex CLI bridge: `buildCodexArgs` / `buildCodexIdeationPrompt` / `runCodex` (`codex exec`, prompt on stdin, spawn injected for tests) |
| `src/excel.ts` | XLSX workbook for the Excel export |
| `src/index.ts` | `definePlugin` factory: CRUD + list/search + citationTable + relatedWork + export + profile + fetchMetadata/searchPapers/fetchFullText + ideate (Claude or Codex engine) + idea CRUD + conflict-aware save/mergePapers |
| `src/View.vue` | browse (list + detail + theme/year filter + search), citation-table mode, Related Work outline mode, export, add/edit form, profile editor, conflict resolver |

The MCP tool is `manageLiterature` (kinds: `list`, `read`, `save`, `update`, `delete`, `citationTable`, `relatedWork`, `export`, `getProfile`, `setProfile`, `fetchMetadata`, `mergePapers`, `searchPapers`, `fetchFullText`, `ideate`, `saveIdea`, `listIdeas`, `updateIdea`, `deleteIdea`, `setSelection`, `getSelection`, `getEngineConfig`, `setEngineConfig`).

### Optional subagents (parallel reading without context bloat)

Two Claude Code subagent definitions live in [`examples/agents/`](examples/agents/): `paper-reader` (register one paper: fetch body → full Ochiai card) and `idea-miner` (mine one paper's body for idea fuel). To enable them in MulmoClaude:

1. Copy them to `~/mulmoclaude/.claude/agents/`.
2. Allow the Task tool: `~/mulmoclaude/config/settings.json` → `{ "extraAllowedTools": ["Task"] }`.

Without them everything still works — the agent falls back to inline `fetchFullText` / card-only ideation.

## Install & use in MulmoClaude

For just *using* the plugin (not hacking on it). Assumes [MulmoClaude](https://github.com/receptron/mulmoclaude) is already cloned and runnable, with Node 20+ and yarn.

1. **Clone & build this plugin:**

   ```bash
   git clone https://github.com/tb-yasu/research-memory-plugin.git
   cd research-memory-plugin
   yarn install && yarn build
   ```

2. **Load it as a dev plugin.** Easiest is the bundled `./dev.sh`, which kills any stale MulmoClaude stack, then boots exactly one with this plugin loaded (sandbox off, so the agent sees your workspace papers). Point `MULMO_DIR` at your MulmoClaude checkout:

   ```bash
   MULMO_DIR=/abs/path/to/mulmoclaude ./dev.sh
   ```

   `dev.sh` errors out if `MULMO_DIR` doesn't exist, so it never silently falls back to someone else's path. Prefer to wire it up by hand? Run MulmoClaude with the env var directly:

   ```bash
   MULMOCLAUDE_DEV_PLUGINS=/abs/path/to/research-memory-plugin yarn dev   # in the mulmoclaude repo
   ```

3. **Add the Research role.** Copy [`examples/research-role.json`](examples/research-role.json) to `~/mulmoclaude/config/roles/research.json` (its `prompt` is what teaches the LLM to extract Paper Cards). If the role doesn't show up, recreate it from the in-app `/roles` UI.

4. **(Optional) Subagents** for parallel paper reading without context bloat — copy [`examples/agents/`](examples/agents/) to `~/mulmoclaude/.claude/agents/` and allow the Task tool in `~/mulmoclaude/config/settings.json` → `{ "extraAllowedTools": ["Task"] }`. See [Optional subagents](#optional-subagents-parallel-reading-without-context-bloat) below.

5. **(Optional) Polite pool.** Set `RESEARCH_MEMORY_MAILTO=you@example.com` to name yourself to OpenAlex / Crossref (their [polite pool](https://docs.openalex.org/how-to-use-the-api/rate-limits-and-authentication#the-polite-pool) — better throttling behaviour under load). Unset, the plugin behaves exactly as before. `dev.sh` forwards this env var through to MulmoClaude:

   ```bash
   RESEARCH_MEMORY_MAILTO=you@example.com MULMO_DIR=/abs/path/to/mulmoclaude ./dev.sh
   ```

6. Open <http://localhost:5173/> and pick the **Research** role.

> Full-text fetch on registration covers **arXiv (HTML) only**; other sources fall back to the abstract from metadata.

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

Seven sample cards across *Agentic Memory*, *Counterfactual Recourse*, and *Compressed Indexing* so search / theme filter / citation table / Related Work outline / export all work immediately — plus a pre-filled research profile so the *Relation to my work* fields are grounded from the start. (The two *Agentic Memory* cards carry co-themes — *Memory Architecture* / *Memory Retrieval* — which is what the Related Work outline groups by.)

## Demo (the loop)

1. **Capture by identifier** — Research role → "Register `arXiv:2504.19482` for me" → fetchMetadata fills title / authors / year / venue / abstract / URL, then the LLM adds the relational spine from your profile.
2. **Capture by abstract** — "Register this paper in my Agentic Memory context: \<abstract\>" → same result when you don't have an arXiv id or DOI.
3. **Search** — "Search my papers for recourse cost".
4. **Citation table** — "Give me the citation table for Agentic Memory".
5. **Related Work outline** — "Generate a Related Work outline for theme: Agentic Memory" → the chat reply renders the outline markdown (paper groups / discussion points / 要点 / citation purposes, gaps flagged) and the panel shows the same skeleton; then ask "draft the Related Work prose on top of this outline" and the LLM writes around it without reshuffling.
6. **Export** — "Export BibTeX for the Compressed Indexing theme".
7. **Avoid silent overwrites** — try to register the same paper again → the conflict panel shows *merge* / *overwrite* / *skip*; pick *merge* and the relational spine survives.

## Tests

```bash
yarn test     # tsx --test: card schema, search/ranking, citation/BibTeX, Related Work outline grouping, profile read-write, Excel export, arXiv/Crossref parsers, duplicate detection + two-card merge, fixtures, and an end-to-end handler round-trip
```

## Roadmap

This is the *capture* on-ramp. The longer arc generalizes the relational spine into a research-state model — **Claim / Evidence / Decision / Context** — to support not just papers but research decisions ("why I dropped this dataset"), rebuttal support (which result answers a reviewer), and project resume ("where did I leave off?"). Near-term: a theme/citation graph, semantic scholar / OpenAlex as additional metadata sources, and richer near-match heuristics for the soft-duplicate warning.

## License

MIT
