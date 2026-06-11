// Tool schema, shared by the server entry (index.ts) and the browser
// entry (vue.ts). `name: "manageLiterature" as const` narrows the literal
// so definePlugin requires a handler exported under exactly this key.

export const TOOL_DEFINITION = {
  type: "function" as const,
  name: "manageLiterature" as const,
  description:
    "Personal Literature Memory: capture papers you read as reusable, research-connected cards and reuse them later. Each card has TWO parts — (A) the paper in the Ochiai 6-question reading template: summary (1. what is it), novelty (2. vs prior work), method (3. key technique), evaluation (4. how validated), limitations (5. discussion), relatedPapers (6. what to read next); plus (B) the relational spine — how it connects to YOUR research: relationToMyWork, citationPurposes, reusableIdeas, nextActions, themes. " +
    "Before writing relationToMyWork/researchContext, call `getProfile` to read the user's research profile and ground the relation in it (use `setProfile` with focus/themes/questions to create or update it; if the profile is empty, ask the user via presentForm first). `save` after the user pastes an abstract/notes (kebab-case slug). `update` patches an existing card (omitted fields preserved). `list` searches/filters (query, theme, yearFrom, sort). `citationTable` returns, for a theme, which papers to cite where. `relatedWork` goes one step further: it deterministically builds a Related Work outline for a theme — papers grouped by co-occurring themes (largest group first, chronological within), each group carrying its discussion points (the cards' relationToMyWork) and each paper its 要点 (novelty/summary) and citation purposes — and returns the markdown skeleton in jsonData, additionally persisting it to data/plugins/research-memory-plugin/related-work/<theme-slug>.md (one file per theme, overwritten per call). To reuse the outline later, call `relatedWork` again or read that file — NEVER reconstruct the markdown format by hand or from plugin source. When the user asks for a Related Work OUTLINE, ALWAYS call `relatedWork` and REPRODUCE THE MARKDOWN FROM jsonData IN YOUR REPLY VERBATIM — the markdown is the deliverable, not the side panel. Do NOT rewrite, merge, summarize, or relabel its bullets (compressing several papers' statements into one paragraph produces broken prose); the only permitted change is translating the fixed Japanese labels when the user writes in another language. When the user asks for the actual Related Work TEXT (本文/draft), call `relatedWork` first, then write the prose separately: one well-formed paragraph per group in the user's language, complete grammatical sentences (no telegraphic fragments, no dash-chained clauses), 1-2 sentences per paper grounded ONLY in that paper's own 要点/論点 bullets, citing as Author et al. (Year), keeping group and paper order exactly; never invent paper content. Groups, paper order, and citation purposes are immutable. Papers flagged 引用目的が未記入 lack citationPurposes — offer to fill them via `update`. `export` emits BibTeX / a reference list / a markdown bundle. " +
    "When the user gives an arXiv id (e.g. `arXiv:2504.19482`) or a DOI (`10.xxxx/yyyy`), FIRST call `fetchMetadata` with the identifier to obtain title/authors/year/venue/summary/url, THEN call `getProfile`, THEN call `save` with the fetched metadata merged with the relational spine you derive from the profile. Do NOT ask the user to retype metadata that fetchMetadata can supply. " +
    "When the user asks to FIND papers on a theme/topic (e.g. 「Xの関連論文を探して登録して」), call `searchPapers` with an ENGLISH query (translate Japanese topics — Semantic Scholar indexes English; optionally yearFrom/limit). Present jsonData as a numbered list — title, authors (first ±et al.), year, venue, citation count, one-line gist from summary — marking any candidate that has `existingSlugs` as already registered (登録済み). Then ASK which ones to register; NEVER save without an explicit selection (「全部」 counts as a selection). For each chosen candidate call `getProfile` once, then `save` per paper with the candidate's metadata (kebab-case slug from first-author surname + year or a short title slug), the searched theme included in `themes`, and a relationToMyWork grounded in the profile (a one-sentence hypothesis is fine at this stage — it can be refined after actually reading the paper). Candidate `summary` fields are TRUNCATED triage gists. To register a chosen candidate: if it has an arxivId, FIRST call `fetchFullText` — it returns the paper body (references stripped, middle elided) — and extract the FULL Ochiai template from it (summary/novelty/method/evaluation/limitations/relatedPapers), then `save`. If `fetchFullText` errors (older paper without an HTML rendering) or the candidate has no arxivId, call `fetchMetadata` (arxivId or doi) for the full abstract and fall back to abstract decomposition. When saving from abstract-only material, do NOT dump the whole abstract into `summary` — DECOMPOSE it across the Ochiai fields it actually supports: summary = what the paper is, novelty = the stated contribution/claim vs prior work, method = the proposed technique, evaluation = reported experiments/numbers. Leave fields the abstract gives no evidence for EMPTY (never pad them by paraphrasing), and add a nextAction like 「本文を読んで evaluation/limitations を埋める」 so the card is visibly abstract-only. " +
    "When the user asks for NEXT-RESEARCH IDEAS from papers (a slug list, a theme, or 「さっき登録した論文」 — recover those slugs from this conversation's save results, or via `list` when unsure), call `ideate` (slugs and/or theme; union, deduped). jsonData returns per-paper ideation material (summary/novelty/method/evaluation/limitations/reusableIdeas/nextActions/relationToMyWork/themes + arxivId) + the research profile + sharedThemes + thinCards. Follow the returned message's procedure: MINE each arxivId paper via the `idea-miner` subagent (Task tool, all in one turn — full texts must never enter this conversation), then SYNTHESIZE 3-5 ideas grounded ONLY in the material (cite specific papers + the specific limitation/method/assumption/profile-question each idea builds on), then ASK which to keep and call `saveIdea` only for explicit selections (slug, title, description, motivation, firstExperiment, sourcePapers = cited card slugs, themes). `listIdeas` (optional theme/status filter) lists saved ideas — present jsonData as a numbered list in chat; ideas have NO canvas view. `updateIdea` patches an idea (typically `status`: raw → exploring → adopted/dropped; omitted fields preserved). `deleteIdea` removes one. If `saveIdea` errors with status 409, the slug exists — ask the user: overwrite (force:true), patch (updateIdea), or rename. " +
    "If `save` returns `view: \"conflict\"`, the paper already exists. ALWAYS ask the user how to proceed — do NOT silently retry with `force: true`. Three options: (a) merge the new metadata into the existing card via `mergePapers` with `targetSlug` set to the conflicting slug (preserves the relational spine), (b) overwrite the existing slug via `save` with `force: true`, (c) skip. A `warning` field on a successful `save` means a title near-match was detected but the save still went through.",
  parameters: {
    type: "object" as const,
    properties: {
      kind: { type: "string", enum: ["list", "read", "save", "update", "delete", "citationTable", "relatedWork", "export", "getProfile", "setProfile", "fetchMetadata", "mergePapers", "searchPapers", "fetchFullText", "ideate", "saveIdea", "listIdeas", "updateIdea", "deleteIdea"], description: "Operation. Default: list." },
      slug: { type: "string", description: "Card id (filename). kebab-case, 1-100 chars. Required for read/save/update/delete. Also the idea id for saveIdea/updateIdea/deleteIdea." },
      slugs: { type: "array", items: { type: "string" }, description: "ideate: explicit card slugs to gather ideation material from. Combine with theme to union both selections." },
      targetSlug: { type: "string", description: "mergePapers: the existing card to merge the incoming metadata into. The result keeps the existing card's slug + relational spine + created timestamp, union-merges arrays, and overlays any non-empty incoming scalar fields." },
      force: { type: "boolean", description: "save/saveIdea: bypass the duplicate check. ONLY set after the user explicitly confirmed they want to overwrite an existing card/idea (e.g. \"はい、上書きでお願いします\"). Never set this silently in response to a conflict envelope." },
      title: { type: "string", description: "Paper title (required for save) — or idea title (required for saveIdea)." },
      description: { type: "string", description: "saveIdea/updateIdea: the idea itself in a few sentences. Required for saveIdea." },
      motivation: { type: "string", description: "saveIdea/updateIdea: why the idea is new — the gap in the source papers it exploits." },
      firstExperiment: { type: "string", description: "saveIdea/updateIdea: the smallest concrete experiment to validate the idea." },
      sourcePapers: { type: "array", items: { type: "string" }, description: "saveIdea/updateIdea: slugs of the registered cards the idea is grounded in." },
      status: { type: "string", enum: ["raw", "exploring", "adopted", "dropped"], description: "Idea lifecycle (saveIdea/updateIdea; listIdeas: filter). raw → exploring → adopted | dropped." },
      authors: { type: "array", items: { type: "string" }, description: "Author full names." },
      year: { type: "integer" },
      venue: { type: "string", description: "Conference / journal." },
      url: { type: "string" },
      doi: { type: "string" },
      arxivId: { type: "string", description: "e.g. 2401.12345. Required for fetchFullText." },
      summary: { type: "string", description: "Ochiai 1 — what is it, in a few sentences." },
      novelty: { type: "string", description: "Ochiai 2 — what's new vs prior work (the contribution)." },
      claims: { type: "array", items: { type: "string" }, description: "The paper's main claims (supporting bullets under novelty)." },
      method: { type: "string", description: "Ochiai 3 — the key technique / how it works." },
      evaluation: { type: "string", description: "Ochiai 4 — how it was validated (datasets, metrics, results)." },
      limitations: { type: "array", items: { type: "string" }, description: "Ochiai 5 — discussion / weaknesses." },
      relatedPapers: { type: "array", items: { type: "string" }, description: "Ochiai 6 — papers to read next (NOT the user's own todos)." },
      relationToMyWork: { type: "string", description: "How this paper relates to the user's research — competitor, related, inspiration, contrast." },
      researchContext: { type: "string", description: "What the relation is *to* — the user's research focus this card was filed under." },
      citationPurposes: {
        type: "array",
        description: "Where/why to cite this in the user's own writing.",
        items: {
          type: "object",
          properties: {
            purpose: { type: "string", description: "What you'd cite it for." },
            suggestedSection: { type: "string", enum: ["Introduction", "Related Work", "Method", "Experiments", "Discussion", "Limitations"] },
            note: { type: "string" },
          },
          required: ["purpose"],
        },
      },
      reusableIdeas: { type: "array", items: { type: "string" }, description: "Ideas/techniques the user could borrow." },
      nextActions: { type: "array", items: { type: "string" }, description: "Follow-ups: papers to read, experiments to try." },
      themes: { type: "array", items: { type: "string" }, description: "Research themes this card belongs to (used by filter + citation table). Also the themes of an idea for saveIdea/updateIdea." },
      query: { type: "string", description: "Free-text search (list), or the Semantic Scholar search query (searchPapers — write it in English). Required for searchPapers." },
      limit: { type: "integer", description: "searchPapers: max candidates to return (default 10, max 100 — the Semantic Scholar per-request ceiling)." },
      theme: { type: "string", description: "Theme to filter by (list, listIdeas), to select all papers of (ideate), or to build a citation table (citationTable) / Related Work outline (relatedWork) for. Required for citationTable and relatedWork." },
      yearFrom: { type: "integer", description: "list filter / searchPapers filter: only papers published in this year or later (e.g. for '2025年以降' / 'since 2025', pass 2025). Omit when the user gives no year — search all years. For list, papers with no recorded year are excluded." },
      yearTo: { type: "integer", description: "searchPapers filter: only papers published in this year or earlier. Combine with yearFrom for a range (e.g. '2020〜2023年' → yearFrom 2020, yearTo 2023)." },
      sort: { type: "string", enum: ["recency", "relevance", "title"], description: "list sort. relevance needs query." },
      format: { type: "string", enum: ["bibtex", "references", "markdown"], description: "export format. Required for export." },
      scope: { type: "string", description: "export scope: a theme name, or omit for all cards." },
      focus: { type: "string", description: "setProfile: a short statement of the user's current research focus." },
      questions: { type: "array", items: { type: "string" }, description: "setProfile: the user's open research questions / current threads." },
    },
    required: ["kind"],
  },
};
