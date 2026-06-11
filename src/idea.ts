// Research Idea — a saved next-research idea grounded in Paper Cards.
// Pure module: schema + (de)serialize + partial merge. No I/O, no Date —
// the server entry (index.ts) supplies timestamps, mirroring card.ts.

import { z } from "zod";

// raw → exploring → adopted | dropped
export const IDEA_STATUSES = ["raw", "exploring", "adopted", "dropped"] as const;
export const IdeaStatusSchema = z.enum(IDEA_STATUSES);
export type IdeaStatus = z.infer<typeof IdeaStatusSchema>;

export const IdeaSchema = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string(), // the idea itself — an idea without a body is useless months later
  motivation: z.string().optional(), // why it is new — the gap in the source papers it exploits
  firstExperiment: z.string().optional(), // smallest concrete validation experiment
  sourcePapers: z.array(z.string()).default([]), // card slugs the idea is grounded in
  themes: z.array(z.string()).default([]), // reuse the card/profile theme vocabulary
  status: IdeaStatusSchema.default("raw"),
  // The idea's full presented text (the 8-element markdown shown in chat).
  // The structured fields above are the queryable subset; this preserves
  // the whole artifact and is mirrored to ideas/<slug>.md on every write.
  markdown: z.string().optional(),
  created: z.string(),
  updated: z.string(),
});
export type Idea = z.infer<typeof IdeaSchema>;

// The idea-shaped fields a caller may patch (slug is the identity;
// created/updated are owned by the store).
export type IdeaPatch = Partial<Omit<Idea, "slug" | "created" | "updated">>;

export function serializeIdea(idea: Idea): string {
  return JSON.stringify(idea, null, 2) + "\n";
}

export function parseIdea(raw: string): Idea | null {
  try {
    return IdeaSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

// Overlay only the defined keys of `patch` onto `existing`, stamping a
// fresh `updated` — same semantics as mergeCard, so a status-only patch
// never wipes description/motivation.
export function mergeIdea(existing: Idea, patch: IdeaPatch, updated: string): Idea {
  const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<Idea>;
  return { ...existing, ...defined, updated };
}

/** The content of ideas/<slug>.md: the stored full markdown when the
 *  LLM supplied one, else a minimal deterministic render of the
 *  structured fields so the file is never empty or missing. */
export function ideaToMarkdown(idea: Idea): string {
  if (idea.markdown) return idea.markdown.endsWith("\n") ? idea.markdown : idea.markdown + "\n";
  const lines = [
    `# ${idea.title}`,
    "",
    `- status: ${idea.status}`,
    idea.themes.length > 0 ? `- themes: ${idea.themes.join(", ")}` : "",
    idea.sourcePapers.length > 0 ? `- sourcePapers: ${idea.sourcePapers.join(", ")}` : "",
    "",
    `## 提案アイディア`,
    idea.description,
    idea.motivation ? `\n## 動機（問題と既存手法のギャップ）\n${idea.motivation}` : "",
    idea.firstExperiment ? `\n## 最初の実験\n${idea.firstExperiment}` : "",
  ];
  return lines.filter((line) => line !== "").join("\n") + "\n";
}
