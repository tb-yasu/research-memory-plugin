// Pure tests for src/engine.ts — engine config (de)serialize + merge.

import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ENGINE_CONFIG, mergeEngineConfig, parseEngineConfig, serializeEngineConfig, type EngineConfig } from "../src/engine";

test("parse applies defaults for missing keys", () => {
  const config = parseEngineConfig("{}");
  assert.deepEqual(config, { engine: "claude", codexModel: "gpt-5.5", codexReasoning: "medium", updated: "" });
});

test("parse rejects an invalid engine / reasoning enum (minimal is no longer valid)", () => {
  assert.equal(parseEngineConfig(JSON.stringify({ engine: "gemini" })), null);
  assert.equal(parseEngineConfig(JSON.stringify({ codexReasoning: "ultra" })), null);
  assert.equal(parseEngineConfig(JSON.stringify({ codexReasoning: "minimal" })), null);
  assert.equal(parseEngineConfig("not json"), null);
});

test("serialize → parse round-trips", () => {
  const config: EngineConfig = { engine: "codex", codexModel: "gpt-5", codexReasoning: "high", updated: "2026-06-13T00:00:00Z" };
  assert.deepEqual(parseEngineConfig(serializeEngineConfig(config)), config);
});

test("merge overlays only defined keys and stamps updated", () => {
  const merged = mergeEngineConfig(DEFAULT_ENGINE_CONFIG, { engine: "codex" }, "2026-06-13T12:00:00Z");
  // engine flips, model/reasoning stay at their defaults, updated is stamped.
  assert.equal(merged.engine, "codex");
  assert.equal(merged.codexModel, "gpt-5.5");
  assert.equal(merged.codexReasoning, "medium");
  assert.equal(merged.updated, "2026-06-13T12:00:00Z");
});

test("merge ignores undefined patch keys (engine-only change keeps model)", () => {
  const start: EngineConfig = { engine: "codex", codexModel: "o3", codexReasoning: "high", updated: "" };
  const merged = mergeEngineConfig(start, { engine: undefined, codexModel: undefined, codexReasoning: undefined }, "t");
  assert.equal(merged.codexModel, "o3");
  assert.equal(merged.codexReasoning, "high");
});
