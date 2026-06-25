// Plugin server entry — runs inside the host's Node process.
//
// The plugin owns ALL deterministic logic: storage (one JSON file per
// paper under files.data), search/filter/ranking, the citation table,
// and export. The chat LLM only does natural-language extraction (turn a
// pasted abstract into card fields) and then calls `save`.
//
// node:fs / node:path / console / direct fetch are all unused — every I/O
// goes through the runtime. The gui-chat-protocol eslint preset enforces it.

import { spawn } from "node:child_process";
import { definePlugin } from "gui-chat-protocol";
import { z } from "zod";
import { TOOL_DEFINITION } from "./definition";
import { applyThemeRename, cardToMarkdown, CitationPurposeSchema, PaperCardSchema, findDuplicates, isValidSlug, mergeCard, mergeFull, parseCard, serializeCard, type CardPatch, type PaperCard } from "./card";
import { filterCards, sortCards } from "./search";
import { citationTable, toBibTeX, toMarkdownBundle, toReferenceList } from "./citation";
import { buildRelatedWorkOutline, relatedWorkToMarkdown, themeSlug } from "./relatedwork";
import { EMPTY_PROFILE, mergeProfile, parseProfile, serializeProfile, type ProfilePatch, type ResearchProfile } from "./profile";
import { fetchArxiv, fetchDoi, MetadataError } from "./metadata";
import { annotateCandidates, mergeCandidates, searchArxiv, searchOpenAlex } from "./papersearch";
import { fetchArxivFullText } from "./fulltext";
import { IdeaSchema, IdeaStatusSchema, ideaToMarkdown, mergeIdea, parseIdea, serializeIdea, type Idea, type IdeaPatch } from "./idea";
import { gatherIdeationMaterial } from "./ideate";
import { EMPTY_SELECTION, parseSelection, serializeSelection, type IdeationSelection } from "./selection";
import { CodexReasoningSchema, DEFAULT_ENGINE_CONFIG, EngineSchema, mergeEngineConfig, parseEngineConfig, serializeEngineConfig, type EngineConfig, type EngineConfigPatch } from "./engine";
import { buildCodexIdeationPrompt, CodexError, runCodex } from "./codex";

export { TOOL_DEFINITION };

const PAPERS_DIR = "papers";
const IDEAS_DIR = "ideas";
const PROFILE_FILE = "profile.json";
const SELECTION_FILE = "ideation-selection.json";
const ENGINE_CONFIG_FILE = "engine-config.json";
const CHANGED = "changed";

// Polite-pool contact for OpenAlex / Crossref. Unset → never appended
// (behaviour identical to before). `process` is a node global, eslint-allowed.
const MAILTO = process.env.RESEARCH_MEMORY_MAILTO?.trim() || undefined;

// Optional card fields shared by `save` and `update`. `save` overrides
// slug+title to required below; `update` leaves them optional (slug is the
// discriminator-level identity, title is patchable).
const cardFields = {
  title: z.string().optional(),
  authors: z.array(z.string()).optional(),
  year: z.number().int().optional(),
  venue: z.string().optional(),
  url: z.string().optional(),
  doi: z.string().optional(),
  arxivId: z.string().optional(),
  summary: z.string().optional(),
  novelty: z.string().optional(),
  claims: z.array(z.string()).optional(),
  method: z.string().optional(),
  evaluation: z.string().optional(),
  limitations: z.array(z.string()).optional(),
  relatedPapers: z.array(z.string()).optional(),
  relationToMyWork: z.string().optional(),
  researchContext: z.string().optional(),
  citationPurposes: z.array(CitationPurposeSchema).optional(),
  reusableIdeas: z.array(z.string()).optional(),
  nextActions: z.array(z.string()).optional(),
  themes: z.array(z.string()).optional(),
};

// Optional idea fields shared by `saveIdea` and `updateIdea`, mirroring
// `cardFields` above. `saveIdea` overrides slug+title+description to
// required below.
const ideaFields = {
  title: z.string().optional(),
  description: z.string().optional(),
  motivation: z.string().optional(),
  firstExperiment: z.string().optional(),
  sourcePapers: z.array(z.string()).optional(),
  themes: z.array(z.string()).optional(),
  status: IdeaStatusSchema.optional(),
  markdown: z.string().optional(),
};

const Args = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("list"), query: z.string().optional(), theme: z.string().optional(), yearFrom: z.number().int().optional(), sort: z.enum(["recency", "relevance", "title"]).optional() }),
  z.object({ kind: z.literal("read"), slug: z.string() }),
  z.object({ kind: z.literal("save"), ...cardFields, slug: z.string(), title: z.string(), force: z.boolean().optional() }),
  z.object({ kind: z.literal("update"), ...cardFields, slug: z.string() }),
  z.object({ kind: z.literal("delete"), slug: z.string() }),
  z.object({ kind: z.literal("renameTheme"), from: z.string(), to: z.string() }),
  z.object({ kind: z.literal("citationTable"), theme: z.string() }),
  z.object({ kind: z.literal("relatedWork"), theme: z.string() }),
  z.object({ kind: z.literal("export"), format: z.enum(["bibtex", "references", "markdown"]), scope: z.string().optional() }),
  z.object({ kind: z.literal("getProfile") }),
  z.object({ kind: z.literal("setProfile"), focus: z.string().optional(), themes: z.array(z.string()).optional(), questions: z.array(z.string()).optional() }),
  z.object({ kind: z.literal("fetchMetadata"), arxivId: z.string().optional(), doi: z.string().optional() }),
  z.object({ kind: z.literal("searchPapers"), query: z.string(), limit: z.number().int().optional(), yearFrom: z.number().int().optional(), yearTo: z.number().int().optional(), venue: z.string().optional() }),
  z.object({ kind: z.literal("fetchFullText"), arxivId: z.string() }),
  z.object({ kind: z.literal("mergePapers"), ...cardFields, targetSlug: z.string() }),
  z.object({ kind: z.literal("ideate"), slugs: z.array(z.string()).optional(), theme: z.string().optional() }),
  z.object({ kind: z.literal("saveIdea"), ...ideaFields, slug: z.string(), title: z.string(), description: z.string(), force: z.boolean().optional() }),
  z.object({ kind: z.literal("updateIdea"), ...ideaFields, slug: z.string() }),
  z.object({ kind: z.literal("deleteIdea"), slug: z.string() }),
  z.object({ kind: z.literal("listIdeas"), theme: z.string().optional(), status: IdeaStatusSchema.optional() }),
  z.object({ kind: z.literal("setSelection"), slugs: z.array(z.string()) }),
  z.object({ kind: z.literal("getSelection") }),
  z.object({ kind: z.literal("getEngineConfig") }),
  z.object({ kind: z.literal("setEngineConfig"), engine: EngineSchema.optional(), codexModel: z.string().min(1).optional(), codexReasoning: CodexReasoningSchema.optional() }),
]);

type SaveArgs = Extract<z.infer<typeof Args>, { kind: "save" }>;
type UpdateArgs = Extract<z.infer<typeof Args>, { kind: "update" }>;
type MergeArgs = Extract<z.infer<typeof Args>, { kind: "mergePapers" }>;
type SaveIdeaArgs = Extract<z.infer<typeof Args>, { kind: "saveIdea" }>;
type UpdateIdeaArgs = Extract<z.infer<typeof Args>, { kind: "updateIdea" }>;

function paperPath(slug: string): string {
  return `${PAPERS_DIR}/${slug}.json`;
}

// Human-readable mirror alongside the JSON store of record, so a wiki page
// can link to papers/<slug>.md and render the card instead of raw JSON.
function paperMdPath(slug: string): string {
  return `${PAPERS_DIR}/${slug}.md`;
}

function ideaPath(slug: string): string {
  return `${IDEAS_DIR}/${slug}.json`;
}

function patchFromArgs(a: UpdateArgs): CardPatch {
  return {
    title: a.title,
    authors: a.authors,
    year: a.year,
    venue: a.venue,
    url: a.url,
    doi: a.doi,
    arxivId: a.arxivId,
    summary: a.summary,
    novelty: a.novelty,
    claims: a.claims,
    method: a.method,
    evaluation: a.evaluation,
    limitations: a.limitations,
    relatedPapers: a.relatedPapers,
    relationToMyWork: a.relationToMyWork,
    researchContext: a.researchContext,
    citationPurposes: a.citationPurposes,
    reusableIdeas: a.reusableIdeas,
    nextActions: a.nextActions,
    themes: a.themes,
  };
}

/** The LLM-facing procedure for `ideate` — confirm (theme selections),
 *  mining via subagents, then grounded synthesis. Pure so tests can
 *  assert the conditional notes. */
export function ideationMessage(input: { paperCount: number; minable: string[]; missing: string[]; profileEmpty: boolean; thinCards: string[]; themeUsed: boolean; fromSelection: boolean }): string {
  const parts = [
    `Ideation material for ${input.paperCount} paper(s) + the research profile is in jsonData.`,
    input.fromSelection ? "The papers come from the user's checkbox selection in the panel — an explicit choice; no confirmation needed. Tell the user which papers the selection contained." : "",
    input.missing.length > 0 ? `${input.missing.length} requested slug(s) not found: ${input.missing.join(", ")} — tell the user.` : "",
    input.profileEmpty ? "The research profile is EMPTY — ideas can only be grounded in the papers; offer setProfile." : "",
    input.thinCards.length > 0 ? `Thin cards (no limitations/reusableIdeas/nextActions recorded): ${input.thinCards.join(", ")} — their material is limited.` : "",
    "PROCEDURE:",
    input.themeUsed
      ? "(0) CONFIRM — this selection came from a THEME filter; theme tags are coarse, so it may include papers irrelevant to the user's current direction. Present the resolved papers as a numbered list (title + slug) and ask which to keep BEFORE any mining (「全部」 keeps all). Papers the user drops are excluded from mining AND synthesis. Skip this step only if the user already said to use the whole theme."
      : "",
    "(1) MINE — unless the user asked for a cards-only quick pass, spawn the `idea-miner` subagent via the Task tool for EACH paper with an arxivId" +
      (input.minable.length > 0 ? ` (${input.minable.join(", ")})` : "") +
      ", ALL in ONE turn so they run in parallel; pass each: the arXiv id, title, the user's language, a 2-3 line profile summary, and the card's relationToMyWork + known limitations. Papers without an arxivId (or if Task is unavailable) proceed on card material alone.",
    "(2) SYNTHESIZE — generate 3-5 research ideas in the user's language. EVERY idea must cite the specific paper(s) and the specific material it builds on (a mined assumption/limitation/future-work hint, or a card's method/reusableIdea/nextAction, or a profile question); NEVER invent paper content beyond jsonData + mined material. Patterns: (a) a limitation or fragile assumption as the opportunity, (b) method transfer onto another paper's problem or the profile focus, (c) a profile open question × a technique from the papers, (d) combining papers that share a theme (see sharedThemes), (e) a future-work hint × the user's strengths. Each idea: a short title, then EIGHT labeled elements in the user's language (Japanese labels: 背景 / 解決したい問題 / 既存手法の問題点 / 提案アイディア / 期待される成果 / 社会的インパクト / 最初の実験 / 参考文献): (1) 背景 — the context in plain language, understandable WITHOUT having read the papers; (2) the problem it tackles; (3) the gap in existing methods, grounded in the 2-3 MOST relevant papers only — never an exhaustive enumeration; (4) the proposed idea and how it solves the problem; (5) expected outcomes, measurable where possible; (6) societal impact — concrete beneficiaries/use-cases in 1-2 sentences, no grandiose claims; (7) the smallest concrete first experiment; (8) 参考文献 — one reference line per paper CITED in this idea (only those), built from the jsonData bibliographic fields: Authors (first ± et al.) (Year). Title. Venue or arXiv:id. (slug) — never invent bibliographic data. WRITING QUALITY — ideas are prose the user reads, NOT compressed notes: write complete grammatical sentences (in Japanese: no 体言止め fragments, no telegraphic noun-chains, no nested-parenthesis pile-ups), 1-3 full sentences per element. CRUCIAL — unpack every coined or compound term, especially an English-jargon noun-chain into plain Japanese on first use (state what it IS and what it DOES); never drop it as a self-explanatory label. BAD:「上書きを『新版の追記＋supersede エッジ』として記録する」 GOOD:「上書きのとき、古い版を消さず新しい版を追記し、さらに『新版が旧版を置き換えた』という関係リンクを張る」. A domain expert who has NOT read these papers must understand every sentence. Cite evidence inline at the END of the supporting sentence as (slug, §locator) — never as 「採掘：…」 insertions mid-clause.",
    "(3) ASK which ideas to keep; ONLY on explicit selection call saveIdea per chosen idea (kebab-case slug, title, description = 提案アイディア + 期待される成果, motivation = 解決したい問題 + 既存手法の問題点, firstExperiment = 最初の実験, sourcePapers = the cited card slugs, themes, AND markdown = the idea's full presented 8-element text VERBATIM — it is mirrored to ideas/<slug>.md). NEVER auto-save.",
  ];
  return parts.filter(Boolean).join(" ");
}

function renderExport(cards: PaperCard[], format: "bibtex" | "references" | "markdown"): string {
  if (format === "bibtex") return toBibTeX(cards);
  if (format === "references") return toReferenceList(cards);
  return toMarkdownBundle(cards);
}

export default definePlugin(({ pubsub, files, log, fetch }) => {
  // Serialise read-modify-write so two parallel mutations on the same
  // slug don't both read one snapshot and silently drop an update.
  let writeLock: Promise<unknown> = Promise.resolve();
  function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = writeLock.catch(() => undefined).then(fn);
    writeLock = next.catch(() => undefined);
    return next;
  }

  function nowIso(): string {
    return new Date().toISOString();
  }

  async function readCard(slug: string): Promise<PaperCard | null> {
    if (!isValidSlug(slug) || !(await files.data.exists(paperPath(slug)))) return null;
    return parseCard(await files.data.read(paperPath(slug)));
  }

  async function listCards(): Promise<PaperCard[]> {
    if (!(await files.data.exists(PAPERS_DIR))) return [];
    const entries = await files.data.readDir(PAPERS_DIR);
    const out: PaperCard[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const card = parseCard(await files.data.read(`${PAPERS_DIR}/${entry}`));
      if (card) out.push(card);
    }
    return out;
  }

  // JSON is the store of record; the .md mirror is the human-readable
  // artifact a wiki page can link to (mirrors writeIdea's .json + .md).
  async function writeCard(card: PaperCard): Promise<void> {
    await files.data.write(paperPath(card.slug), serializeCard(card));
    await files.data.write(paperMdPath(card.slug), cardToMarkdown(card));
    pubsub.publish(CHANGED, { slug: card.slug });
  }

  // One-time backfill: existing cards predate the .md mirror, so on load
  // write any missing one (best-effort, never blocks the handler). New
  // writes keep both in lockstep via writeCard.
  async function backfillCardMarkdown(): Promise<void> {
    for (const card of await listCards()) {
      if (!(await files.data.exists(paperMdPath(card.slug)))) {
        await files.data.write(paperMdPath(card.slug), cardToMarkdown(card));
      }
    }
  }

  async function handleSave(args: SaveArgs): Promise<unknown> {
    if (!isValidSlug(args.slug)) return { error: "invalid slug — use kebab-case (a-z, 0-9, hyphens)", status: 400 };
    return withWriteLock(async () => {
      const all = await listCards();
      const dup = findDuplicates({ slug: args.slug, title: args.title, doi: args.doi, arxivId: args.arxivId }, all);
      if (dup.hard.length > 0 && !args.force) {
        // Re-dispatchable candidate: every cardField the user/LLM passed
        // in, minus `kind` and `force`. The conflict view button bar
        // forwards this payload directly to `mergePapers` or to `save`
        // with `force: true`.
        const candidate = {
          slug: args.slug,
          title: args.title,
          authors: args.authors,
          year: args.year,
          venue: args.venue,
          url: args.url,
          doi: args.doi,
          arxivId: args.arxivId,
          summary: args.summary,
          novelty: args.novelty,
          claims: args.claims,
          method: args.method,
          evaluation: args.evaluation,
          limitations: args.limitations,
          relatedPapers: args.relatedPapers,
          relationToMyWork: args.relationToMyWork,
          researchContext: args.researchContext,
          citationPurposes: args.citationPurposes,
          reusableIdeas: args.reusableIdeas,
          nextActions: args.nextActions,
          themes: args.themes,
        };
        log.info("save blocked by duplicate", { slug: args.slug, hard: dup.hard });
        return {
          error: "duplicate",
          status: 409,
          data: { view: "conflict", candidate, duplicates: dup.hard },
          message: `"${args.title}" looks like a duplicate of ${dup.hard.map((d) => d.slug).join(", ")} — confirm with the user (merge / overwrite / skip).`,
          // LLM gets the slim version — it already holds the full args.
          jsonData: { candidate: { slug: args.slug, title: args.title }, duplicates: dup.hard },
        };
      }
      const existing = await readCard(args.slug);
      const now = nowIso();
      // PaperCardSchema strips extra keys (kind, force) and applies array defaults.
      const card = PaperCardSchema.parse({ ...args, created: existing?.created ?? now, updated: now });
      await writeCard(card);
      log.info("paper saved", { slug: card.slug });
      const envelope: Record<string, unknown> = { data: { view: "detail", card }, message: `Saved "${card.title}" (${card.slug}).` };
      if (dup.soft.length > 0) envelope.warning = dup.soft.map((d) => `title resembles ${d.slug}: "${d.title}"`);
      return envelope;
    });
  }

  async function handleMerge(args: MergeArgs): Promise<unknown> {
    return withWriteLock(async () => {
      const existing = await readCard(args.targetSlug);
      if (!existing) return { error: `not found: ${args.targetSlug}`, status: 404 };
      const incoming: Partial<PaperCard> = {
        title: args.title,
        authors: args.authors,
        year: args.year,
        venue: args.venue,
        url: args.url,
        doi: args.doi,
        arxivId: args.arxivId,
        summary: args.summary,
        novelty: args.novelty,
        claims: args.claims,
        method: args.method,
        evaluation: args.evaluation,
        limitations: args.limitations,
        relatedPapers: args.relatedPapers,
        relationToMyWork: args.relationToMyWork,
        researchContext: args.researchContext,
        citationPurposes: args.citationPurposes,
        reusableIdeas: args.reusableIdeas,
        nextActions: args.nextActions,
        themes: args.themes,
      };
      const card = mergeFull(existing, incoming, nowIso());
      await writeCard(card);
      log.info("paper merged", { slug: card.slug });
      return { data: { view: "detail", card }, message: `Merged into "${card.title}" (${card.slug}).` };
    });
  }

  async function handleUpdate(args: UpdateArgs): Promise<unknown> {
    return withWriteLock(async () => {
      const existing = await readCard(args.slug);
      if (!existing) return { error: `not found: ${args.slug}`, status: 404 };
      const card = mergeCard(existing, patchFromArgs(args), nowIso());
      await writeCard(card);
      return { data: { view: "detail", card }, message: `Updated "${card.title}" (${card.slug}).` };
    });
  }

  async function handleDelete(slug: string): Promise<unknown> {
    return withWriteLock(async () => {
      if (!(await readCard(slug))) return { error: `not found: ${slug}`, status: 404 };
      await files.data.unlink(paperPath(slug));
      if (await files.data.exists(paperMdPath(slug))) await files.data.unlink(paperMdPath(slug));
      pubsub.publish(CHANGED, { slug });
      const cards = sortCards(await listCards(), "recency");
      return { data: { view: "list", cards }, message: `Deleted ${slug}.` };
    });
  }

  // Bulk-rename a theme across every card that uses it. Category headings
  // group cards by theme, so renaming one tag must touch all sharers at
  // once. created/updated stay put — a category rename is not content edit.
  async function handleRenameTheme(from: string, to: string): Promise<unknown> {
    const fromT = from.trim();
    const toT = to.trim();
    if (!fromT || !toT) return { error: "renameTheme requires non-empty from/to", status: 400 };
    if (fromT === toT) return { error: "from and to are identical", status: 400 };
    return withWriteLock(async () => {
      let count = 0;
      for (const card of await listCards()) {
        const themes = applyThemeRename(card.themes, fromT, toT);
        if (!themes) continue;
        await writeCard({ ...card, themes }); // .json + .md mirror + CHANGED; created/updated untouched
        count++;
      }
      const cards = sortCards(await listCards(), "recency");
      return { data: { view: "list", cards }, message: `Renamed theme "${fromT}" → "${toT}" across ${count} card(s).`, jsonData: { from: fromT, to: toT, count } };
    });
  }

  async function readProfile(): Promise<ResearchProfile> {
    if (!(await files.data.exists(PROFILE_FILE))) return EMPTY_PROFILE;
    return parseProfile(await files.data.read(PROFILE_FILE)) ?? EMPTY_PROFILE;
  }

  // ── Idea storage (mirrors readCard/listCards/writeCard) ────────────

  async function readIdea(slug: string): Promise<Idea | null> {
    if (!isValidSlug(slug) || !(await files.data.exists(ideaPath(slug)))) return null;
    return parseIdea(await files.data.read(ideaPath(slug)));
  }

  async function listIdeasFromDisk(): Promise<Idea[]> {
    if (!(await files.data.exists(IDEAS_DIR))) return [];
    const entries = await files.data.readDir(IDEAS_DIR);
    const out: Idea[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const idea = parseIdea(await files.data.read(`${IDEAS_DIR}/${entry}`));
      if (idea) out.push(idea);
    }
    return out;
  }

  function ideaMdPath(slug: string): string {
    return `${IDEAS_DIR}/${slug}.md`;
  }

  // JSON is the store of record; the .md mirror is the human-readable
  // artifact (the full 8-element text when the LLM supplied it).
  async function writeIdea(idea: Idea): Promise<void> {
    await files.data.write(ideaPath(idea.slug), serializeIdea(idea));
    await files.data.write(ideaMdPath(idea.slug), ideaToMarkdown(idea));
    pubsub.publish(CHANGED, { idea: idea.slug });
  }

  async function readSelection(): Promise<IdeationSelection> {
    if (!(await files.data.exists(SELECTION_FILE))) return EMPTY_SELECTION;
    return parseSelection(await files.data.read(SELECTION_FILE)) ?? EMPTY_SELECTION;
  }

  async function handleSetSelection(slugs: string[]): Promise<unknown> {
    return withWriteLock(async () => {
      const selection: IdeationSelection = { slugs, updated: nowIso() };
      await files.data.write(SELECTION_FILE, serializeSelection(selection));
      pubsub.publish(CHANGED, { selection: true });
      return { message: `Ideation selection updated (${slugs.length} paper(s)).`, jsonData: selection };
    });
  }

  async function readEngineConfig(): Promise<EngineConfig> {
    if (!(await files.data.exists(ENGINE_CONFIG_FILE))) return DEFAULT_ENGINE_CONFIG;
    return parseEngineConfig(await files.data.read(ENGINE_CONFIG_FILE)) ?? DEFAULT_ENGINE_CONFIG;
  }

  async function handleSetEngineConfig(patch: EngineConfigPatch): Promise<unknown> {
    return withWriteLock(async () => {
      const config = mergeEngineConfig(await readEngineConfig(), patch, nowIso());
      await files.data.write(ENGINE_CONFIG_FILE, serializeEngineConfig(config));
      pubsub.publish(CHANGED, { engineConfig: true });
      const detail = config.engine === "codex" ? ` (model ${config.codexModel}, reasoning ${config.codexReasoning})` : "";
      return { message: `Ideation engine set to ${config.engine}${detail}.`, jsonData: config };
    });
  }

  /** Resolve the ideation selection: union of explicit slugs (in request
   *  order) and a theme filter, deduped; `missing` = slugs not found. */
  async function resolveIdeationCards(slugs: string[], theme: string | undefined): Promise<{ cards: PaperCard[]; missing: string[] }> {
    const all = await listCards();
    const bySlug = new Map(all.map((card) => [card.slug, card]));
    const picked = new Map<string, PaperCard>();
    const missing: string[] = [];
    for (const slug of slugs) {
      const card = bySlug.get(slug);
      if (card) picked.set(slug, card);
      else missing.push(slug);
    }
    if (theme) {
      for (const card of all) {
        if (card.themes.includes(theme) && !picked.has(card.slug)) picked.set(card.slug, card);
      }
    }
    return { cards: [...picked.values()], missing };
  }

  /** sourcePapers referencing cards that don't exist — soft warning, not an error. */
  async function unknownSourcePapers(sourcePapers: string[] | undefined): Promise<string[]> {
    if (!sourcePapers || sourcePapers.length === 0) return [];
    const all = await listCards();
    const known = new Set(all.map((card) => card.slug));
    return sourcePapers.filter((slug) => !known.has(slug));
  }

  async function handleSaveIdea(args: SaveIdeaArgs): Promise<unknown> {
    if (!isValidSlug(args.slug)) return { error: "invalid slug — use kebab-case (a-z, 0-9, hyphens)", status: 400 };
    return withWriteLock(async () => {
      const existing = await readIdea(args.slug);
      if (existing && !args.force) {
        return {
          error: "idea slug exists",
          status: 409,
          message: `Idea "${args.slug}" already exists — ask the user: overwrite (saveIdea force:true), patch it (updateIdea), or pick another slug.`,
        };
      }
      const now = nowIso();
      // IdeaSchema strips extra keys (kind, force) and applies defaults.
      const idea = IdeaSchema.parse({ ...args, created: existing?.created ?? now, updated: now });
      await writeIdea(idea);
      log.info("idea saved", { slug: idea.slug });
      const unknown = await unknownSourcePapers(args.sourcePapers);
      const envelope: Record<string, unknown> = {
        message: `Saved idea "${idea.title}" (${idea.slug}), grounded in ${idea.sourcePapers.length} paper(s). Markdown mirrored to data/plugins/research-memory-plugin/${ideaMdPath(idea.slug)}.${idea.markdown ? "" : " No `markdown` was supplied — the .md is a minimal field render; pass the idea's full presented text in `markdown` to preserve it."}`,
        jsonData: idea,
      };
      if (unknown.length > 0) envelope.warning = [`unknown sourcePapers (no card with these slugs): ${unknown.join(", ")}`];
      return envelope;
    });
  }

  async function handleUpdateIdea(args: UpdateIdeaArgs): Promise<unknown> {
    return withWriteLock(async () => {
      const existing = await readIdea(args.slug);
      if (!existing) return { error: `idea not found: ${args.slug}`, status: 404 };
      const patch: IdeaPatch = {
        title: args.title,
        description: args.description,
        motivation: args.motivation,
        firstExperiment: args.firstExperiment,
        sourcePapers: args.sourcePapers,
        themes: args.themes,
        status: args.status,
        markdown: args.markdown,
      };
      const idea = mergeIdea(existing, patch, nowIso());
      await writeIdea(idea);
      const unknown = await unknownSourcePapers(args.sourcePapers);
      const envelope: Record<string, unknown> = { message: `Updated idea "${idea.title}" (${idea.slug}, status: ${idea.status}).`, jsonData: idea };
      if (unknown.length > 0) envelope.warning = [`unknown sourcePapers (no card with these slugs): ${unknown.join(", ")}`];
      return envelope;
    });
  }

  async function handleDeleteIdea(slug: string): Promise<unknown> {
    return withWriteLock(async () => {
      if (!(await readIdea(slug))) return { error: `idea not found: ${slug}`, status: 404 };
      await files.data.unlink(ideaPath(slug));
      if (await files.data.exists(ideaMdPath(slug))) await files.data.unlink(ideaMdPath(slug));
      pubsub.publish(CHANGED, { idea: slug });
      return { message: `Deleted idea ${slug}.` };
    });
  }

  async function handleSetProfile(patch: ProfilePatch): Promise<unknown> {
    return withWriteLock(async () => {
      const profile = mergeProfile(await readProfile(), patch, nowIso());
      await files.data.write(PROFILE_FILE, serializeProfile(profile));
      pubsub.publish(CHANGED, { profile: true });
      return { data: { view: "profile", profile }, message: "Research profile updated." };
    });
  }

  // Best-effort, fire-and-forget: ensure pre-existing cards get their .md
  // mirror without delaying plugin readiness or failing the load.
  void backfillCardMarkdown().catch((err) => log.warn("card markdown backfill failed", { error: String(err) }));

  return {
    TOOL_DEFINITION,

    async manageLiterature(rawArgs: unknown) {
      const args = Args.parse(rawArgs);
      switch (args.kind) {
        case "list": {
          const filtered = filterCards(await listCards(), { query: args.query, theme: args.theme, yearFrom: args.yearFrom });
          const cards = sortCards(filtered, args.sort, args.query);
          // Carry the filter context so the canvas can reflect a scoped
          // request (e.g. theme:"Agentic Memory", yearFrom:2025) instead of
          // showing all.
          return { data: { view: "list", cards, theme: args.theme ?? null, query: args.query ?? null, yearFrom: args.yearFrom ?? null }, message: `Listed ${cards.length} paper(s) in the panel.`, jsonData: cards.map((c) => ({ slug: c.slug, title: c.title, year: c.year, themes: c.themes })) };
        }
        case "read": {
          const card = await readCard(args.slug);
          return card ? { data: { view: "detail", card }, message: `Opened "${card.title}".` } : { error: `not found: ${args.slug}`, status: 404 };
        }
        case "save":
          return handleSave(args);
        case "update":
          return handleUpdate(args);
        case "mergePapers":
          return handleMerge(args);
        case "delete":
          return handleDelete(args.slug);
        case "renameTheme":
          return handleRenameTheme(args.from, args.to);
        case "citationTable": {
          const rows = citationTable(await listCards(), args.theme);
          return { data: { view: "citationTable", theme: args.theme, rows }, message: `Citation table for "${args.theme}": ${rows.length} row(s) in the panel.`, jsonData: rows };
        }
        case "relatedWork": {
          // profile.focus rides along so the outline can state what 「本研究」
          // refers to — the points are contrasts against it.
          const profile = await readProfile();
          const outline = buildRelatedWorkOutline(await listCards(), args.theme, profile.focus);
          const markdown = relatedWorkToMarkdown(outline);
          // Persist the artifact — files are the source of truth. One file
          // per theme, overwritten on each call, so a later "save it / draft
          // on top of it" request reads the file instead of reverse-
          // engineering the format from a long-gone tool result.
          const mdPath = `related-work/${themeSlug(args.theme)}.md`;
          await files.data.write(mdPath, markdown);
          // jsonData carries the deterministic markdown skeleton. The panel
          // shows it too, but the deliverable is the markdown itself — so the
          // message tells the LLM to reproduce it verbatim. Rewriting is
          // forbidden: merging per-paper statements into one paragraph is
          // what produces broken, telegraphic prose.
          return {
            data: { view: "relatedWork", outline, markdown },
            message: `Related Work outline for "${args.theme}": ${outline.paperCount} paper(s) in ${outline.groups.length} group(s). Saved to data/plugins/research-memory-plugin/${mdPath} (overwritten per theme). Reproduce the markdown from jsonData in your reply VERBATIM — do not rewrite, merge, summarize, or relabel its bullets (translate the fixed Japanese labels only if the user writes in another language). To reuse the outline later (saving elsewhere, drafting prose), call relatedWork again or read the saved file — NEVER reconstruct the format by hand or from plugin source. If the user wants full Related Work prose, write it separately: one paragraph per group, complete sentences, each claim grounded only in that paper's own bullets.`,
            jsonData: markdown,
          };
        }
        case "export": {
          const all = await listCards();
          const scoped = args.scope ? all.filter((card) => card.themes.includes(args.scope as string)) : all;
          const content = renderExport(scoped, args.format);
          return { data: { view: "export", format: args.format, scope: args.scope ?? null, content }, message: `Exported ${args.format} for ${scoped.length} paper(s) — shown in the panel.`, jsonData: content };
        }
        case "getProfile": {
          const profile = await readProfile();
          return { data: { view: "profile", profile }, message: `Research focus: ${profile.focus || "(not set)"}`, jsonData: profile };
        }
        case "setProfile":
          return handleSetProfile({ focus: args.focus, themes: args.themes, questions: args.questions });
        case "fetchMetadata": {
          if (!args.arxivId && !args.doi) return { error: "fetchMetadata requires arxivId or doi", status: 400 };
          try {
            const patch = args.arxivId ? await fetchArxiv(args.arxivId, fetch) : await fetchDoi(args.doi as string, fetch, MAILTO);
            const label = args.arxivId ? `arXiv:${args.arxivId}` : `DOI:${args.doi}`;
            // No `data` field — the canvas stays untouched. The LLM uses
            // `jsonData` to compose a follow-up save call.
            return { message: `Fetched metadata for ${label}: "${patch.title}".`, jsonData: patch };
          } catch (err) {
            if (err instanceof MetadataError) return { error: err.message, status: err.code === "not-found" ? 404 : 502 };
            return { error: String(err), status: 500 };
          }
        }
        case "searchPapers": {
          // venue → OpenAlex only (arXiv preprints carry no structured venue).
          // Otherwise run BOTH in parallel: OpenAlex (broad/established) +
          // arXiv (freshest preprints OpenAlex still lags on), then merge &
          // de-duplicate. One source failing never sinks the other.
          const tasks = [searchOpenAlex(args.query, { limit: args.limit, yearFrom: args.yearFrom, yearTo: args.yearTo, venue: args.venue, mailto: MAILTO }, fetch)];
          if (!args.venue) tasks.push(searchArxiv(args.query, { limit: args.limit, yearFrom: args.yearFrom }, fetch));
          const [oaRes, axRes] = await Promise.allSettled(tasks);
          const oaCands = oaRes.status === "fulfilled" ? oaRes.value : [];
          const axCands = axRes && axRes.status === "fulfilled" ? axRes.value : [];
          if (oaRes.status === "rejected" && (!axRes || axRes.status === "rejected")) {
            const reason = oaRes.reason;
            if (reason instanceof MetadataError) return { error: reason.message, status: reason.code === "not-found" ? 404 : 502 };
            return { error: String(reason), status: 500 };
          }
          // Flag candidates the store already holds so the LLM marks them
          // 登録済み instead of re-saving. No `data` field — the canvas stays
          // untouched; the numbered list lives in chat.
          const candidates = annotateCandidates(mergeCandidates(oaCands, axCands), await listCards());
          log.info("paper search", { query: args.query, openalex: oaCands.length, arxiv: axCands.length, merged: candidates.length });
          const degraded = oaRes.status === "rejected" ? " (arXiv only — OpenAlex was unavailable)" : axRes && axRes.status === "rejected" ? " (OpenAlex only — arXiv was unavailable)" : "";
          const sourceNote = args.venue ? "" : " Results merge OpenAlex (broad/established) + arXiv (freshest preprints), de-duplicated.";
          const venueNote = args.venue
            ? ` Note: the venue filter "${args.venue}" relies on OpenAlex's conference linkage, which is INCOMPLETE — many conference papers are indexed only under their arXiv preprint and won't match. If the list looks sparse, tell the user to drop the venue and rely on the topic + year.`
            : "";
          return {
            message: `Found ${candidates.length} candidate(s) for "${args.query}"${args.venue ? ` (venue: ${args.venue})` : ""}${degraded}.${sourceNote} Present them as a numbered list (mark existingSlugs entries as already registered) and ask the user which to register — do NOT save without an explicit selection.${venueNote}`,
            jsonData: candidates,
          };
        }
        case "fetchFullText": {
          try {
            const { source, text } = await fetchArxivFullText(args.arxivId, fetch);
            log.info("full text fetched", { arxivId: args.arxivId, source, chars: text.length });
            return {
              message: `Fetched the body of arXiv:${args.arxivId} from ${source} (${text.length} chars; references stripped, middle elided). Extract the FULL Ochiai template from it, then call save.`,
              jsonData: { source, text },
            };
          } catch (err) {
            if (err instanceof MetadataError) return { error: err.message, status: err.code === "not-found" ? 404 : 502 };
            return { error: String(err), status: 500 };
          }
        }
        case "ideate": {
          let slugs = args.slugs ?? [];
          // No explicit selection in the call → fall back to the panel's
          // checkbox selection (persisted by the View via setSelection).
          let fromSelection = false;
          if (slugs.length === 0 && !args.theme) {
            const selection = await readSelection();
            if (selection.slugs.length === 0) return { error: "ideate requires slugs, a theme, or papers checked in the panel (checkboxes)", status: 400 };
            slugs = selection.slugs;
            fromSelection = true;
          }
          const { cards, missing } = await resolveIdeationCards(slugs, args.theme);
          if (cards.length === 0) {
            const detail = missing.length > 0 ? `no cards found for slugs: ${missing.join(", ")}` : `no cards in theme "${args.theme}"`;
            return { error: detail, status: 404 };
          }
          const material = gatherIdeationMaterial(cards, await readProfile());
          log.info("ideation material", { papers: cards.length, missing: missing.length });
          // Engine switch: Codex synthesizes inside the plugin (shells out
          // to the CLI) and returns ready-made ideas; Claude (default) gets
          // material + the procedure message and synthesizes in chat.
          const engineConfig = await readEngineConfig();
          if (engineConfig.engine === "codex") {
            try {
              const ideasMarkdown = await runCodex(buildCodexIdeationPrompt(material), { model: engineConfig.codexModel, reasoning: engineConfig.codexReasoning }, spawn);
              log.info("codex ideation", { papers: cards.length, model: engineConfig.codexModel, reasoning: engineConfig.codexReasoning });
              const missingNote = missing.length > 0 ? ` ${missing.length} requested slug(s) not found: ${missing.join(", ")}.` : "";
              return {
                message:
                  `Ideas generated by Codex (model ${engineConfig.codexModel}, reasoning ${engineConfig.codexReasoning}) from ${cards.length} paper(s).${missingNote} ` +
                  "Present jsonData.ideasMarkdown to the user VERBATIM — do NOT regenerate, rewrite, or re-mine. Then ASK which ideas to keep and, only on explicit selection, call saveIdea per chosen idea (kebab-case slug, title, description = 提案アイディア + 期待される成果, motivation = 解決したい問題 + 既存手法の問題点, firstExperiment = 最初の実験, sourcePapers = the cited card slugs, themes, AND markdown = that idea's full 8-element text VERBATIM).",
                jsonData: { engine: "codex", model: engineConfig.codexModel, reasoning: engineConfig.codexReasoning, ideasMarkdown, missingSlugs: missing, fromSelection },
              };
            } catch (err) {
              if (err instanceof CodexError) return { error: err.message, status: err.code === "not-found" ? 503 : 502 };
              return { error: String(err), status: 500 };
            }
          }
          // No `data` field — the canvas stays untouched; ideas live in chat.
          return {
            message: ideationMessage({
              paperCount: cards.length,
              minable: material.papers.filter((p) => p.arxivId).map((p) => p.slug),
              missing,
              profileEmpty: material.profile === null,
              thinCards: material.thinCards,
              themeUsed: Boolean(args.theme),
              fromSelection,
            }),
            jsonData: { ...material, missingSlugs: missing, fromSelection },
          };
        }
        case "saveIdea":
          return handleSaveIdea(args);
        case "updateIdea":
          return handleUpdateIdea(args);
        case "deleteIdea":
          return handleDeleteIdea(args.slug);
        case "listIdeas": {
          const all = await listIdeasFromDisk();
          const filtered = all
            .filter((idea) => (args.theme ? idea.themes.includes(args.theme) : true))
            .filter((idea) => (args.status ? idea.status === args.status : true))
            .sort((a, b) => b.updated.localeCompare(a.updated));
          const filterNote = [args.theme && `theme "${args.theme}"`, args.status && `status ${args.status}`].filter(Boolean).join(", ");
          return {
            message: `${filtered.length} idea(s)${filterNote ? ` matching ${filterNote}` : ""}. Present them as a numbered list in chat — title, status, themes, source papers, description. Ideas have NO canvas view.`,
            jsonData: filtered,
          };
        }
        case "setSelection":
          return handleSetSelection(args.slugs);
        case "getSelection": {
          const selection = await readSelection();
          return { message: `Ideation selection: ${selection.slugs.length} paper(s).`, jsonData: selection };
        }
        case "getEngineConfig": {
          const config = await readEngineConfig();
          return { message: `Ideation engine: ${config.engine}${config.engine === "codex" ? ` (model ${config.codexModel}, reasoning ${config.codexReasoning})` : ""}.`, jsonData: config };
        }
        case "setEngineConfig":
          return handleSetEngineConfig({ engine: args.engine, codexModel: args.codexModel, codexReasoning: args.codexReasoning });
        default: {
          const exhaustive: never = args;
          throw new Error(`unknown kind: ${JSON.stringify(exhaustive)}`);
        }
      }
    },
  };
});
