// Tool schema, shared by the server entry (index.ts) and the browser
// entry (vue.ts). `name: "manageLiterature" as const` narrows the literal
// so definePlugin requires a handler exported under exactly this key.

export const TOOL_DEFINITION = {
  type: "function" as const,
  name: "manageLiterature" as const,
  description:
    "Personal Literature Memory: capture papers you read as reusable, research-connected cards and reuse them later. Each card has TWO parts — (A) the paper in the Ochiai 6-question reading template: summary (1. what is it), novelty (2. vs prior work), method (3. key technique), evaluation (4. how validated), limitations (5. discussion), relatedPapers (6. what to read next); plus (B) the relational spine — how it connects to YOUR research: relationToMyWork, citationPurposes, reusableIdeas, nextActions, themes. " +
    "Before writing relationToMyWork/researchContext, call `getProfile` to read the user's research profile and ground the relation in it (use `setProfile` with focus/themes/questions to create or update it; if the profile is empty, ask the user via presentForm first). `save` after the user pastes an abstract/notes (kebab-case slug). `update` patches an existing card (omitted fields preserved). `list` searches/filters (query, theme, yearFrom, sort). `citationTable` returns, for a theme, which papers to cite where. `export` emits BibTeX / a reference list / a markdown bundle.",
  parameters: {
    type: "object" as const,
    properties: {
      kind: { type: "string", enum: ["list", "read", "save", "update", "delete", "citationTable", "export", "getProfile", "setProfile"], description: "Operation. Default: list." },
      slug: { type: "string", description: "Card id (filename). kebab-case, 1-100 chars. Required for read/save/update/delete." },
      title: { type: "string", description: "Paper title. Required for save." },
      authors: { type: "array", items: { type: "string" }, description: "Author full names." },
      year: { type: "integer" },
      venue: { type: "string", description: "Conference / journal." },
      url: { type: "string" },
      doi: { type: "string" },
      arxivId: { type: "string", description: "e.g. 2401.12345" },
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
      themes: { type: "array", items: { type: "string" }, description: "Research themes this card belongs to (used by filter + citation table)." },
      query: { type: "string", description: "Free-text search (list)." },
      theme: { type: "string", description: "Theme to filter by (list) or build a citation table for (citationTable). Required for citationTable." },
      yearFrom: { type: "integer", description: "list filter: only papers published in this year or later (e.g. for '2025年以降' / 'since 2025', pass 2025). Papers with no recorded year are excluded." },
      sort: { type: "string", enum: ["recency", "relevance", "title"], description: "list sort. relevance needs query." },
      format: { type: "string", enum: ["bibtex", "references", "markdown"], description: "export format. Required for export." },
      scope: { type: "string", description: "export scope: a theme name, or omit for all cards." },
      focus: { type: "string", description: "setProfile: a short statement of the user's current research focus." },
      questions: { type: "array", items: { type: "string" }, description: "setProfile: the user's open research questions / current threads." },
    },
    required: ["kind"],
  },
};
