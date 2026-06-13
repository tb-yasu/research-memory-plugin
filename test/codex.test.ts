// Tests for src/codex.ts — arg/prompt builders + the runCodex spawn
// wrapper, exercised with a fake child_process so nothing shells out.
// (Test files run through tsx/esbuild — not type-checked — so the loose
// `as any` on the fake spawn is intentional and contained.)

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { buildCodexArgs, buildCodexIdeationPrompt, CodexError, runCodex } from "../src/codex";
import type { IdeationMaterial } from "../src/ideate";

test("buildCodexArgs encodes model + reasoning effort + safety flags", () => {
  assert.deepEqual(buildCodexArgs("gpt-5.5", "high"), ["exec", "--model", "gpt-5.5", "-c", "model_reasoning_effort=high", "--sandbox", "read-only", "--color", "never", "--skip-git-repo-check"]);
});

const MATERIAL: IdeationMaterial = {
  profile: { focus: "compressed agent memory", themes: ["Agentic Memory"], questions: ["dynamic index?"] },
  papers: [{ slug: "doe-2024", title: "A paper", authors: ["Jane Doe"], limitations: ["scales poorly"], reusableIdeas: [], nextActions: [], themes: ["Agentic Memory"] }],
  sharedThemes: ["Agentic Memory"],
  thinCards: [],
};

test("buildCodexIdeationPrompt embeds the contract and the material JSON", () => {
  const prompt = buildCodexIdeationPrompt(MATERIAL);
  assert.match(prompt, /research ideation assistant/);
  assert.match(prompt, /参考文献/); // the 8-element contract
  assert.match(prompt, /doe-2024/); // material is inlined
  assert.match(prompt, /compressed agent memory/);
});

// A fake child_process whose behaviour the test scripts after listeners
// are attached (queueMicrotask defers past runCodex's synchronous setup).
function fakeSpawn(behavior: (child: any) => void, capture?: { prompt: string }) {
  return (_cmd: string, _args: string[]) => {
    const child: any = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { write: (s: string) => capture && (capture.prompt += s), end: () => undefined };
    child.kill = () => undefined;
    queueMicrotask(() => behavior(child));
    return child;
  };
}

test("runCodex resolves with trimmed stdout and feeds the prompt on stdin", async () => {
  const capture = { prompt: "" };
  const spawn = fakeSpawn((child) => {
    child.stdout.emit("data", "  idea one\n");
    child.stdout.emit("data", "idea two  ");
    child.emit("close", 0);
  }, capture) as any;
  const out = await runCodex("PROMPT-BODY", { model: "gpt-5", reasoning: "low" }, spawn);
  assert.equal(out, "idea one\nidea two");
  assert.equal(capture.prompt, "PROMPT-BODY");
});

test("runCodex maps ENOENT to a not-found CodexError", async () => {
  const spawn = fakeSpawn((child) => {
    const err: NodeJS.ErrnoException = new Error("spawn codex ENOENT");
    err.code = "ENOENT";
    child.emit("error", err);
  }) as any;
  await assert.rejects(
    () => runCodex("p", { model: "gpt-5", reasoning: "low" }, spawn),
    (err: unknown) => err instanceof CodexError && err.code === "not-found",
  );
});

test("runCodex rejects on a non-zero exit with stderr", async () => {
  const spawn = fakeSpawn((child) => {
    child.stderr.emit("data", "boom");
    child.emit("close", 1);
  }) as any;
  await assert.rejects(
    () => runCodex("p", { model: "gpt-5", reasoning: "low" }, spawn),
    (err: unknown) => err instanceof CodexError && err.code === "failed" && /boom/.test(err.message),
  );
});

test("runCodex times out and kills the child", async () => {
  let killed = false;
  const spawn = ((_cmd: string, _args: string[]) => {
    const child: any = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { write: () => undefined, end: () => undefined };
    child.kill = () => (killed = true);
    return child; // never emits close → timer fires
  }) as any;
  await assert.rejects(
    () => runCodex("p", { model: "gpt-5", reasoning: "low", timeoutMs: 10 }, spawn),
    (err: unknown) => err instanceof CodexError && err.code === "timeout",
  );
  assert.equal(killed, true);
});
