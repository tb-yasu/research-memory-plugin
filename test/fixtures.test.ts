// The demo fixtures (examples/papers/*.json) must always parse against the
// schema, and each file's name must match its card.slug — otherwise a
// hand-placed fixture won't be found by read(slug).

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCard } from "../src/card";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../examples/papers");

test("all example cards parse and their filename matches the slug", () => {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 4, "expected at least 4 demo fixtures");
  for (const file of files) {
    const card = parseCard(readFileSync(join(dir, file), "utf8"));
    assert.ok(card, `failed to parse ${file}`);
    assert.equal(`${card.slug}.json`, file, `filename must equal <slug>.json for ${file}`);
  }
});
