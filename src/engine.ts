// Ideation engine configuration — which LLM synthesizes next-research
// ideas, and (for Codex) which model + reasoning effort. Persisted as
// engine-config.json so the choice survives reloads; edited from the
// canvas View (setEngineConfig) or chat. Pure module, mirrors
// profile.ts / selection.ts — no I/O, no Date.
//
//   "claude" → the host Claude synthesizes (the default; `ideate`
//              returns material + a procedure message it follows).
//   "codex"  → the plugin shells out to the `codex` CLI and returns
//              ready-made ideas (see codex.ts).

import { z } from "zod";

export const IDEATION_ENGINES = ["claude", "codex"] as const;
export const EngineSchema = z.enum(IDEATION_ENGINES);
export type IdeationEngine = z.infer<typeof EngineSchema>;

// Codex "思考力" — maps to `-c model_reasoning_effort=<x>` on the CLI.
// "minimal" is intentionally absent: codex enables web_search/image_gen
// tools by default, and the API rejects those under minimal effort
// ("tools cannot be used with reasoning.effort 'minimal'").
export const CODEX_REASONING_LEVELS = ["low", "medium", "high"] as const;
export const CodexReasoningSchema = z.enum(CODEX_REASONING_LEVELS);
export type CodexReasoning = z.infer<typeof CodexReasoningSchema>;

// Suggestion set for the panel's editable model field — NOT an allow-list.
// The valid models depend on how codex is authenticated: a ChatGPT-account
// login only accepts the codex default (gpt-5.5 as of codex 0.139); an
// OpenAI API key unlocks gpt-5-codex / gpt-5 / o3 / o4-mini. codexModel is
// free text validated only as non-empty, so users on either auth can type
// whatever their account supports.
export const CODEX_MODELS = ["gpt-5.5", "gpt-5-codex", "gpt-5", "o3", "o4-mini"] as const;

export const DEFAULT_CODEX_MODEL = "gpt-5.5";
export const DEFAULT_CODEX_REASONING: CodexReasoning = "medium";

export const EngineConfigSchema = z.object({
  engine: EngineSchema.default("claude"),
  codexModel: z.string().min(1).default(DEFAULT_CODEX_MODEL),
  codexReasoning: CodexReasoningSchema.default(DEFAULT_CODEX_REASONING),
  updated: z.string().default(""),
});
export type EngineConfig = z.infer<typeof EngineConfigSchema>;

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  engine: "claude",
  codexModel: DEFAULT_CODEX_MODEL,
  codexReasoning: DEFAULT_CODEX_REASONING,
  updated: "",
};

// The fields a caller may patch (updated is owned by the store).
export type EngineConfigPatch = Partial<Pick<EngineConfig, "engine" | "codexModel" | "codexReasoning">>;

export function serializeEngineConfig(config: EngineConfig): string {
  return JSON.stringify(config, null, 2) + "\n";
}

export function parseEngineConfig(raw: string): EngineConfig | null {
  try {
    return EngineConfigSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

// Overlay only the defined keys of `patch`, stamping a fresh `updated`
// (mirrors mergeProfile/mergeIdea) so an engine-only change never resets
// the saved model/reasoning.
export function mergeEngineConfig(existing: EngineConfig, patch: EngineConfigPatch, updated: string): EngineConfig {
  const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<EngineConfig>;
  return { ...existing, ...defined, updated };
}
