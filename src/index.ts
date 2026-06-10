// Plugin server entry — runs inside the host's Node process.
//
// The plugin owns ALL deterministic logic: storage (one JSON file per
// paper under files.data), search/filter/ranking, the citation table,
// and export. The chat LLM only does natural-language extraction (turn a
// pasted abstract into card fields) and then calls `save`.
//
// node:fs / node:path / console / direct fetch are all unused — every I/O
// goes through the runtime. The gui-chat-protocol eslint preset enforces it.

import { definePlugin } from "gui-chat-protocol";
import { z } from "zod";
import { TOOL_DEFINITION } from "./definition";
import { CitationPurposeSchema, PaperCardSchema, findDuplicates, isValidSlug, mergeCard, mergeFull, parseCard, serializeCard, type CardPatch, type PaperCard } from "./card";
import { filterCards, sortCards } from "./search";
import { citationTable, toBibTeX, toMarkdownBundle, toReferenceList } from "./citation";
import { buildRelatedWorkOutline, relatedWorkToMarkdown, themeSlug } from "./relatedwork";
import { EMPTY_PROFILE, mergeProfile, parseProfile, serializeProfile, type ProfilePatch, type ResearchProfile } from "./profile";
import { fetchArxiv, fetchDoi, MetadataError } from "./metadata";
import { annotateCandidates, searchSemanticScholar } from "./papersearch";

export { TOOL_DEFINITION };

const PAPERS_DIR = "papers";
const PROFILE_FILE = "profile.json";
const CHANGED = "changed";

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

const Args = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("list"), query: z.string().optional(), theme: z.string().optional(), yearFrom: z.number().int().optional(), sort: z.enum(["recency", "relevance", "title"]).optional() }),
  z.object({ kind: z.literal("read"), slug: z.string() }),
  z.object({ kind: z.literal("save"), ...cardFields, slug: z.string(), title: z.string(), force: z.boolean().optional() }),
  z.object({ kind: z.literal("update"), ...cardFields, slug: z.string() }),
  z.object({ kind: z.literal("delete"), slug: z.string() }),
  z.object({ kind: z.literal("citationTable"), theme: z.string() }),
  z.object({ kind: z.literal("relatedWork"), theme: z.string() }),
  z.object({ kind: z.literal("export"), format: z.enum(["bibtex", "references", "markdown"]), scope: z.string().optional() }),
  z.object({ kind: z.literal("getProfile") }),
  z.object({ kind: z.literal("setProfile"), focus: z.string().optional(), themes: z.array(z.string()).optional(), questions: z.array(z.string()).optional() }),
  z.object({ kind: z.literal("fetchMetadata"), arxivId: z.string().optional(), doi: z.string().optional() }),
  z.object({ kind: z.literal("searchPapers"), query: z.string(), limit: z.number().int().optional(), yearFrom: z.number().int().optional(), yearTo: z.number().int().optional() }),
  z.object({ kind: z.literal("mergePapers"), ...cardFields, targetSlug: z.string() }),
]);

type SaveArgs = Extract<z.infer<typeof Args>, { kind: "save" }>;
type UpdateArgs = Extract<z.infer<typeof Args>, { kind: "update" }>;
type MergeArgs = Extract<z.infer<typeof Args>, { kind: "mergePapers" }>;

function paperPath(slug: string): string {
  return `${PAPERS_DIR}/${slug}.json`;
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

  async function writeCard(card: PaperCard): Promise<void> {
    await files.data.write(paperPath(card.slug), serializeCard(card));
    pubsub.publish(CHANGED, { slug: card.slug });
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
      pubsub.publish(CHANGED, { slug });
      const cards = sortCards(await listCards(), "recency");
      return { data: { view: "list", cards }, message: `Deleted ${slug}.` };
    });
  }

  async function readProfile(): Promise<ResearchProfile> {
    if (!(await files.data.exists(PROFILE_FILE))) return EMPTY_PROFILE;
    return parseProfile(await files.data.read(PROFILE_FILE)) ?? EMPTY_PROFILE;
  }

  async function handleSetProfile(patch: ProfilePatch): Promise<unknown> {
    return withWriteLock(async () => {
      const profile = mergeProfile(await readProfile(), patch, nowIso());
      await files.data.write(PROFILE_FILE, serializeProfile(profile));
      pubsub.publish(CHANGED, { profile: true });
      return { data: { view: "profile", profile }, message: "Research profile updated." };
    });
  }

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
            const patch = args.arxivId ? await fetchArxiv(args.arxivId, fetch) : await fetchDoi(args.doi as string, fetch);
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
          try {
            const found = await searchSemanticScholar(args.query, { limit: args.limit, yearFrom: args.yearFrom, yearTo: args.yearTo }, fetch);
            // Flag candidates the store already holds so the LLM marks
            // them 登録済み instead of re-saving. No `data` field — the
            // canvas stays untouched; the numbered list lives in chat.
            const candidates = annotateCandidates(found, await listCards());
            log.info("paper search", { query: args.query, hits: candidates.length });
            return {
              message: `Found ${candidates.length} candidate(s) for "${args.query}". Present them as a numbered list (mark existingSlugs entries as already registered) and ask the user which to register — do NOT save without an explicit selection.`,
              jsonData: candidates,
            };
          } catch (err) {
            if (err instanceof MetadataError) return { error: err.message, status: err.code === "not-found" ? 404 : 502 };
            return { error: String(err), status: 500 };
          }
        }
        default: {
          const exhaustive: never = args;
          throw new Error(`unknown kind: ${JSON.stringify(exhaustive)}`);
        }
      }
    },
  };
});
