// Ideation selection — the card slugs the user checked in the canvas
// View. The View cannot trigger the chat LLM (no chat-injection API in
// gui-chat-protocol), so the checkboxes persist their state here and a
// chat phrase (「選択した論文からアイデアを出して」 → ideate with no
// slugs/theme) picks it up. Pure module, mirrors profile.ts.

import { z } from "zod";

export const SelectionSchema = z.object({
  slugs: z.array(z.string()).default([]),
  updated: z.string().default(""),
});
export type IdeationSelection = z.infer<typeof SelectionSchema>;

export const EMPTY_SELECTION: IdeationSelection = { slugs: [], updated: "" };

export function serializeSelection(selection: IdeationSelection): string {
  return JSON.stringify(selection, null, 2) + "\n";
}

export function parseSelection(raw: string): IdeationSelection | null {
  try {
    return SelectionSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}
