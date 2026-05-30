// Research Profile — a single persistent record of "my research" that the
// agent reads before writing each card's relationToMyWork, and that the
// user edits in the View. Pure module: schema + (de)serialize + merge.
// Stored at files.data/profile.json (sibling of papers/).

import { z } from "zod";

export const ResearchProfileSchema = z.object({
  focus: z.string().default(""),
  themes: z.array(z.string()).default([]),
  questions: z.array(z.string()).default([]),
  updated: z.string().default(""),
});
export type ResearchProfile = z.infer<typeof ResearchProfileSchema>;

export const EMPTY_PROFILE: ResearchProfile = { focus: "", themes: [], questions: [], updated: "" };

export type ProfilePatch = Partial<Pick<ResearchProfile, "focus" | "themes" | "questions">>;

export function serializeProfile(profile: ResearchProfile): string {
  return JSON.stringify(profile, null, 2) + "\n";
}

export function parseProfile(raw: string): ResearchProfile | null {
  try {
    return ResearchProfileSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function mergeProfile(existing: ResearchProfile, patch: ProfilePatch, updated: string): ResearchProfile {
  const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<ResearchProfile>;
  return { ...existing, ...defined, updated };
}
