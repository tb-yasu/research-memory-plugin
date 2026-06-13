// Codex CLI bridge — synthesize ideas with an OpenAI model via the
// `codex exec` non-interactive command, as an alternative to the host
// Claude. Pure arg/prompt builders + a thin spawn wrapper with the
// child_process function injected so tests never shell out.
//
// This is the ONE place that knows the codex command shape. If your
// installed codex version uses different flags, adjust buildCodexArgs.
// Requires the `codex` CLI on PATH and a completed `codex login`
// (ChatGPT subscription or API key) — see the README.

import type { spawn as NodeSpawn } from "node:child_process";
import type { CodexReasoning } from "./engine";
import type { IdeationMaterial } from "./ideate";

// 5 minutes — high reasoning effort over several papers can be slow, and
// the agent tool call blocks until codex returns.
export const DEFAULT_CODEX_TIMEOUT_MS = 300_000;

export type CodexErrorCode = "not-found" | "failed" | "timeout";

export class CodexError extends Error {
  constructor(
    message: string,
    readonly code: CodexErrorCode,
  ) {
    super(message);
    this.name = "CodexError";
  }
}

// `codex exec` flags (verified against codex-cli 0.139):
//   --model            picks the model
//   -c key=value       overrides config; model_reasoning_effort tunes the
//                      thinking budget (value parsed as TOML, falling back
//                      to a literal string)
//   --sandbox read-only  the model can't write/exec — this is pure text
//                        generation, so deny side effects defensively
//   --color never      no ANSI escapes in the captured output
//   --skip-git-repo-check  run even if the host cwd isn't a git repo
// The session preamble (model/sandbox/prompt echo) goes to STDERR; the
// final answer is the only thing on STDOUT. The prompt is fed on stdin
// (see runCodex) so a large material payload never hits the argv limit.
export function buildCodexArgs(model: string, reasoning: CodexReasoning): string[] {
  return ["exec", "--model", model, "-c", `model_reasoning_effort=${reasoning}`, "--sandbox", "read-only", "--color", "never", "--skip-git-repo-check"];
}

// The standalone synthesis contract handed to Codex. Mirrors the Claude
// procedure in index.ts (ideationMessage step 2) MINUS the subagent
// full-text mining — Codex works from the gathered card material only.
const IDEATION_CONTRACT = `You are a research ideation assistant. From the JSON material below (paper cards the user has read + their research profile), generate 3-5 concrete next-research ideas.

RULES
- Ground EVERY idea in the specific papers and the specific material it builds on (a limitation, a method, a reusableIdea, a nextAction, or a profile question). NEVER invent paper content beyond the material.
- Useful patterns: (a) a limitation or fragile assumption as the opportunity, (b) transferring a method onto another paper's problem or the profile focus, (c) a profile open question x a technique from the papers, (d) combining papers that share a theme (see sharedThemes), (e) a future-work hint x the user's strengths.
- Respond in the SAME language as the material below (if the cards/profile are written in Japanese, write Japanese).
- Output ONLY the ideas as markdown. Do NOT run shell commands, edit files, search the web, or print logs.

EACH IDEA — a short title, then EIGHT labeled elements (Japanese labels; translate them only if you are writing in another language):
1. 背景 — the context in plain language, understandable WITHOUT having read the papers.
2. 解決したい問題 — the problem it tackles.
3. 既存手法の問題点 — the gap in existing methods, grounded in the 2-3 MOST relevant papers only, never an exhaustive enumeration.
4. 提案アイディア — the proposed idea and how it solves the problem.
5. 期待される成果 — expected outcomes, measurable where possible.
6. 社会的インパクト — concrete beneficiaries / use-cases in 1-2 sentences, no grandiose claims.
7. 最初の実験 — the smallest concrete first experiment.
8. 参考文献 — one reference line per paper CITED in this idea (only those), built from the bibliographic fields: Authors (first +- et al.) (Year). Title. Venue or arXiv:id. (slug). Never invent bibliographic data.

WRITING QUALITY — ideas are prose the user reads, not compressed notes: complete grammatical sentences (in Japanese: no 体言止め fragments, no telegraphic noun-chains), 1-3 sentences per element. Unpack any coined or compound term into plain language on first use (state what it IS and what it DOES). Cite evidence inline at the END of the supporting sentence as (slug, §locator).

MATERIAL (JSON)
`;

export function buildCodexIdeationPrompt(material: IdeationMaterial): string {
  return IDEATION_CONTRACT + JSON.stringify(material, null, 2) + "\n";
}

export interface RunCodexOptions {
  model: string;
  reasoning: CodexReasoning;
  timeoutMs?: number;
}

// `spawn` is injected (index.ts passes node's spawn; tests pass a fake
// cast to this type) so the codex command shape stays in one testable
// place. Typed as node's spawn so the real binding matches exactly.
export type CodexSpawn = typeof NodeSpawn;

// Run `codex exec`, feeding the prompt on stdin and resolving with its
// trimmed stdout.
export function runCodex(prompt: string, options: RunCodexOptions, spawn: CodexSpawn): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CODEX_TIMEOUT_MS;
  return new Promise<string>((resolve, reject) => {
    let child: ReturnType<CodexSpawn>;
    try {
      child = spawn("codex", buildCodexArgs(options.model, options.reasoning), { stdio: ["pipe", "pipe", "pipe"] });
    } catch (err) {
      reject(new CodexError(`failed to launch codex: ${String(err)}`, "failed"));
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new CodexError(`codex timed out after ${Math.round(timeoutMs / 1000)}s`, "timeout")));
    }, timeoutMs);
    child.on("error", (err) => {
      const notFound = (err as NodeJS.ErrnoException).code === "ENOENT";
      finish(() =>
        reject(
          new CodexError(
            notFound ? "codex CLI not found on PATH — install it and run `codex login` (see README)." : `failed to launch codex: ${err.message}`,
            notFound ? "not-found" : "failed",
          ),
        ),
      );
    });
    child.stdout?.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
    child.on("close", (code) => {
      finish(() => (code === 0 ? resolve(stdout.trim()) : reject(new CodexError(`codex exited with code ${code}: ${stderr.trim() || "(no stderr)"}`, "failed"))));
    });
    child.stdin?.write(prompt);
    child.stdin?.end();
  });
}
