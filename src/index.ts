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
import { CitationPurposeSchema, PaperCardSchema, isValidSlug, mergeCard, parseCard, serializeCard, type CardPatch, type PaperCard } from "./card";
import { filterCards, sortCards } from "./search";
import { citationTable, toBibTeX, toMarkdownBundle, toReferenceList } from "./citation";
import { EMPTY_PROFILE, mergeProfile, parseProfile, serializeProfile, type ProfilePatch, type ResearchProfile } from "./profile";

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
  z.object({ kind: z.literal("list"), query: z.string().optional(), theme: z.string().optional(), sort: z.enum(["recency", "relevance", "title"]).optional() }),
  z.object({ kind: z.literal("read"), slug: z.string() }),
  z.object({ kind: z.literal("save"), ...cardFields, slug: z.string(), title: z.string() }),
  z.object({ kind: z.literal("update"), ...cardFields, slug: z.string() }),
  z.object({ kind: z.literal("delete"), slug: z.string() }),
  z.object({ kind: z.literal("citationTable"), theme: z.string() }),
  z.object({ kind: z.literal("export"), format: z.enum(["bibtex", "references", "markdown"]), scope: z.string().optional() }),
  z.object({ kind: z.literal("getProfile") }),
  z.object({ kind: z.literal("setProfile"), focus: z.string().optional(), themes: z.array(z.string()).optional(), questions: z.array(z.string()).optional() }),
]);

type SaveArgs = Extract<z.infer<typeof Args>, { kind: "save" }>;
type UpdateArgs = Extract<z.infer<typeof Args>, { kind: "update" }>;

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

export default definePlugin(({ pubsub, files, log }) => {
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
      const existing = await readCard(args.slug);
      const now = nowIso();
      // PaperCardSchema strips the extra `kind` key and applies array defaults.
      const card = PaperCardSchema.parse({ ...args, created: existing?.created ?? now, updated: now });
      await writeCard(card);
      log.info("paper saved", { slug: card.slug });
      return { data: { view: "detail", card }, message: `Saved "${card.title}" (${card.slug}).` };
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
          const filtered = filterCards(await listCards(), { query: args.query, theme: args.theme });
          const cards = sortCards(filtered, args.sort, args.query);
          return { data: { view: "list", cards }, message: `Listed ${cards.length} paper(s) in the panel.`, jsonData: cards.map((c) => ({ slug: c.slug, title: c.title, year: c.year, themes: c.themes })) };
        }
        case "read": {
          const card = await readCard(args.slug);
          return card ? { data: { view: "detail", card }, message: `Opened "${card.title}".` } : { error: `not found: ${args.slug}`, status: 404 };
        }
        case "save":
          return handleSave(args);
        case "update":
          return handleUpdate(args);
        case "delete":
          return handleDelete(args.slug);
        case "citationTable": {
          const rows = citationTable(await listCards(), args.theme);
          return { data: { view: "citationTable", theme: args.theme, rows }, message: `Citation table for "${args.theme}": ${rows.length} row(s) in the panel.`, jsonData: rows };
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
        default: {
          const exhaustive: never = args;
          throw new Error(`unknown kind: ${JSON.stringify(exhaustive)}`);
        }
      }
    },
  };
});
