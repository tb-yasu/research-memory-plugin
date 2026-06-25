# Paper Memory

English | [日本語](README.ja.md)

Paper Memory is a [MulmoClaude](https://github.com/receptron/mulmoclaude) plugin for turning papers into **reusable research memory**.

It doesn't just save summaries. For each paper it records *why the paper matters to your own research*: how it relates to your work, where you might cite it, which ideas you can reuse, and what to do next. The goal is simple — months later, you should be able to ask not only "what did this paper say?" but also "why did I care?" and "how can I use it now?"

## Quick start

For *using* the plugin. Assumes [MulmoClaude](https://github.com/receptron/mulmoclaude) is already cloned and runnable (Node 20+, yarn).

1. **Clone & build the plugin:**

   ```bash
   git clone https://github.com/tb-yasu/paper-memory.git
   cd paper-memory
   yarn install && yarn build
   ```

2. **Add the Research role** (before booting, so MulmoClaude picks it up): copy [`examples/research-role.json`](examples/research-role.json) to `~/mulmoclaude/config/roles/research.json`. This role grants the tool and teaches the LLM to extract Paper Cards.

3. **Boot MulmoClaude with the plugin loaded.** The bundled `./dev.sh` is the recommended path — point `MULMO_DIR` at your MulmoClaude checkout:

   ```bash
   MULMO_DIR=/abs/path/to/mulmoclaude ./dev.sh
   ```

4. **Open <http://localhost:5173/>** and pick the **Research** role.

Paste an abstract or say `Register arXiv:2504.19482` and your first card appears. (For the manual / contributor setup, see [Development](#development).)

## Features

- Register papers from an arXiv ID, DOI, or pasted abstract — metadata auto-filled from arXiv / Crossref.
- Store each paper as a structured **Paper Card** with research notes: relevance, citation purpose, reusable ideas, next actions, themes.
- Find papers by theme across **OpenAlex + arXiv**, and register only the ones you pick.
- Search and filter your library by keyword, theme, and year.
- Generate **citation tables** and **Related Work outlines** for a theme.
- Turn selected papers into grounded **next-research ideas** (via Claude or Codex).
- Export to BibTeX, a reference list, Markdown, or Excel.
- Detect duplicates and merge records without clobbering months-old notes.
- Mirror each card to readable Markdown (`papers/<slug>.md`) so wiki pages can link to it.
- Add and edit cards by hand in the canvas — fully usable without the LLM.

## Core concepts

- **Paper Card** — one JSON record per paper. The paper's own content (summary, claims, method, limitations) plus your notes, captured as structured reading notes (an Ochiai-style reading template).
- **Relational spine** — Paper Memory stores not just *what a paper says*, but *how it relates to your research*. That relation layer is the relational spine — relation to my work, citation purposes, reusable ideas, next actions, themes. It's what general-purpose reference managers don't make easy to keep structured.
- **Research profile** — your current focus, themes, and open questions. The LLM uses it to ground each card's *relation to my work* and *citation purposes*.

## Usage example

In the **Research** role:

1. **Register by identifier** — "Register `arXiv:2504.19482`" → metadata is fetched, then the LLM adds the relational spine from your profile.
2. **Register by abstract** — "Register this paper in my Agentic Memory context: \<abstract\>" (when there's no arXiv id or DOI).
3. **Find papers** — "2024年以降の Agentic Memory の論文を探して" → pick which to register.
4. **Citation table** — "Give me the citation table for Agentic Memory".
5. **Related Work outline** — "Generate a Related Work outline for theme: Agentic Memory" → the reply *is* the outline; then "draft the Related Work prose on top of this outline".
6. **Export** — "Export BibTeX for the Compressed Indexing theme".

To seed sample data so these work immediately, see [Seed demo data](#seed-demo-data).

## Advanced usage

### Full-text reading on registration

Picked candidates with an arXiv id get their body fetched (arxiv.org/html, with an ar5iv fallback; references stripped, middle elided) so the card is a full structured extraction, not an abstract dump.

### Subagents (optional)

Two Claude Code subagent definitions live in [`examples/agents/`](examples/agents/): `paper-reader` (register one paper: fetch body → full card) and `idea-miner` (mine one paper's body for idea fuel). They read each paper in a disposable context — in parallel, without bloating the chat. To enable:

1. Copy [`examples/agents/`](examples/agents/) to `~/mulmoclaude/.claude/agents/`.
2. Allow the Task tool: `~/mulmoclaude/config/settings.json` → `{ "extraAllowedTools": ["Task"] }`.

Without them everything still works — the plugin falls back to inline full-text fetch / card-only ideation.

### Idea engine: Claude or Codex

The canvas panel has an *Idea engine* switch. With **Claude** (default) the host synthesizes ideas in chat. With **Codex** the plugin shells out to the `codex` CLI (`codex exec`, prompt on stdin, sandboxed read-only) and returns ready-made ideas; you also pick the model and the reasoning effort (思考力: low / medium / high). The choice persists in `engine-config.json`.

Codex requires the `codex` CLI installed and a completed `codex login`. Valid models depend on your auth method (and Codex CLI version): a **ChatGPT-account** login accepts only the codex default model, while an **OpenAI API key** unlocks the full list (`gpt-5-codex`, `gpt-5`, the `o`-series, …). The Codex path uses the gathered card material only (it does not run the `idea-miner` subagents).

## Configuration

- **`MULMO_DIR`** — where your MulmoClaude checkout lives (used by `dev.sh`).
- **`RESEARCH_MEMORY_MAILTO`** — set to your email to join the OpenAlex / Crossref [polite pool](https://docs.openalex.org/how-to-use-the-api/rate-limits-and-authentication#the-polite-pool) (better throttling under load). Unset, behaviour is unchanged. `dev.sh` forwards it:

  ```bash
  RESEARCH_MEMORY_MAILTO=you@example.com MULMO_DIR=/abs/path/to/mulmoclaude ./dev.sh
  ```

## Limitations

- Full-text extraction supports **arXiv (HTML) only**; other sources fall back to the metadata abstract.
- Codex-based ideation requires the Codex CLI and `codex login`; available models depend on the auth method.
- The canvas View cannot directly trigger the host LLM — selected papers are persisted server-side and picked up from a chat phrase (the plugin runtime has no chat-injection API).
- OpenAlex conference-venue linkage is incomplete; prefer topic + year, use the venue filter only as a refinement.

## Development

For *modifying* the plugin.

```bash
yarn install
yarn build            # produces dist/index.js + dist/vue.js (required before loading)
```

Load it as a dev plugin (two terminals):

```bash
# Terminal A — keep dist/ fresh on every save
yarn dev              # vite build --watch

# Terminal B — boot MulmoClaude with this plugin loaded
mulmoclaude --dev-plugin /ABS/PATH/TO/paper-memory
```

Running MulmoClaude from a source checkout instead of the published launcher? The launcher just sets `MULMOCLAUDE_DEV_PLUGINS`, so the equivalent is:

```bash
MULMOCLAUDE_DEV_PLUGINS=/ABS/PATH/TO/paper-memory yarn dev   # in the mulmoclaude repo
```

### Role setup

The plugin's tool is gated by a role's `availablePlugins`. If you followed [Quick start](#quick-start) the Research role is already in place; otherwise copy [`examples/research-role.json`](examples/research-role.json) to `~/mulmoclaude/config/roles/research.json` (or recreate it from the in-app `/roles` UI), then pick the **Research** role.

### Seed demo data

```bash
mkdir -p ~/mulmoclaude/data/plugins/paper-memory/papers
cp examples/papers/*.json ~/mulmoclaude/data/plugins/paper-memory/papers/
cp examples/profile.json  ~/mulmoclaude/data/plugins/paper-memory/profile.json
```

Seven sample cards across *Agentic Memory*, *Counterfactual Recourse*, and *Compressed Indexing* (plus a pre-filled profile) so search / theme filter / citation table / Related Work outline / export all work immediately.

### Tests

```bash
yarn test     # tsx --test: schema, search/ranking, citation/BibTeX, Related Work grouping,
              # profile read-write, Excel export, arXiv/Crossref parsers, duplicate detection
              # + two-card merge, theme rename, card markdown mirror, and an end-to-end handler round-trip
```

## Architecture

Paper Memory follows MulmoClaude's architecture — *the API/logic is the product; the GUI and the LLM are both clients of it*:

- **The plugin (TypeScript) owns the reproducible logic** — schema & validation, storage (one JSON file per paper under `files.data`), search/ranking, the citation table, the Related Work outline, and export. These need to be repeatable and testable, so they run in code, not the LLM. Pure, unit-tested modules.
- **The chat LLM does only natural-language extraction** — turning a pasted abstract into structured card fields. That instruction lives in a workspace **role prompt**, not in code.

| Module | Responsibility |
|---|---|
| `src/card.ts` | `PaperCard` schema, JSON (de)serialize, slug rules, partial-merge, duplicate detection + two-card `mergeFull`, theme rename, Markdown mirror |
| `src/search.ts` | `filterCards` / `rankCards` / `sortCards` (keyword + recency + year-from) |
| `src/citation.ts` | `citationTable`, `toBibTeX`, `toReferenceList`, `toMarkdownBundle` |
| `src/relatedwork.ts` | `buildRelatedWorkOutline` (co-theme grouping, chronological order, discussion points, gap detection) + `relatedWorkToMarkdown` |
| `src/profile.ts` | `ResearchProfile` read / write |
| `src/metadata.ts` | arXiv Atom + Crossref/DOI parsers; polite-pool `mailto` helper |
| `src/papersearch.ts` | OpenAlex + arXiv search (relevance, year range, venue→source id, gist truncation), candidate merge/de-dup, existing-card annotation |
| `src/fulltext.ts` | arXiv HTML / ar5iv full-text fetcher (markup stripped, references cut, middle elided) |
| `src/idea.ts` / `src/ideate.ts` | `Idea` schema; ideation material gathering (the LLM/Codex does the ideation) |
| `src/engine.ts` / `src/codex.ts` | idea-engine config (Claude/Codex) + Codex CLI bridge |
| `src/excel.ts` | XLSX workbook for the Excel export |
| `src/index.ts` | `definePlugin` factory wiring every operation to `files.data` |
| `src/View.vue` | the canvas UI (browse / detail / citation table / Related Work / export / forms) |

### MCP tool reference

The MCP tool is `manageLiterature`. Kinds: `list`, `read`, `save`, `update`, `delete`, `renameTheme`, `citationTable`, `relatedWork`, `export`, `getProfile`, `setProfile`, `fetchMetadata`, `mergePapers`, `searchPapers`, `fetchFullText`, `ideate`, `saveIdea`, `listIdeas`, `updateIdea`, `deleteIdea`, `setSelection`, `getSelection`, `getEngineConfig`, `setEngineConfig`.

## Roadmap

This is the *capture* on-ramp. The longer arc generalizes the relational spine into a research-state model — **Claim / Evidence / Decision / Context** — to support not just papers but research decisions ("why I dropped this dataset"), rebuttal support (which result answers a reviewer), and project resume ("where did I leave off?"). Near-term: a theme/citation graph, more metadata sources (DBLP, Semantic Scholar) and citation-graph data, and richer near-match heuristics for the soft-duplicate warning.

## License

MIT
