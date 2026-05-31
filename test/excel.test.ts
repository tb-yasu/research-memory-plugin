import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { buildWorkbook, safeSheetName, type ExcelCard, type ExcelLabels } from "../src/excel";

const LABELS: ExcelLabels = {
  all: "All",
  noTheme: "(no theme)",
  cols: {
    title: "Title",
    authors: "Authors",
    year: "Year",
    venue: "Venue",
    themes: "Themes",
    summary: "Summary",
    novelty: "Novelty",
    method: "Method",
    evaluation: "Eval",
    limitations: "Limits",
    relatedPapers: "Read next",
    relation: "Relation",
    context: "Context",
    citePurposes: "Cite for",
    reusable: "Reusable",
    nextActions: "Actions",
    url: "URL",
    doi: "DOI",
    arxiv: "arXiv",
    slug: "slug",
  },
  sections: { Method: "Method", "Related Work": "Related Work" },
};

function card(slug: string, title: string, themes: string[]): ExcelCard {
  return {
    slug,
    title,
    authors: ["A. Author", "B. Writer"],
    year: 2024,
    venue: "Venue",
    summary: "what it is",
    limitations: ["a limit"],
    relatedPapers: ["next paper"],
    relationToMyWork: "relates",
    citationPurposes: [{ purpose: "cite here", suggestedSection: "Method" }],
    reusableIdeas: ["idea"],
    nextActions: ["do x"],
    themes,
  };
}

function rows(ws: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];
}

test("buildWorkbook makes an All sheet then one sheet per theme (alphabetical)", () => {
  const wb = buildWorkbook([card("a", "Alpha", ["Indexing"]), card("b", "Beta", ["Indexing", "Memory"])], LABELS);
  assert.deepEqual(wb.SheetNames, ["All", "Indexing", "Memory"]);
});

test("multi-theme paper appears on each theme sheet; round-trips through xlsx bytes", () => {
  const wb = buildWorkbook([card("a", "Alpha", ["Indexing"]), card("b", "Beta", ["Indexing", "Memory"])], LABELS);
  const back = XLSX.read(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

  const all = rows(back.Sheets["All"]);
  assert.equal(all[0][0], "Title"); // header row
  assert.equal(all.length, 3); // header + 2 papers

  const memory = rows(back.Sheets["Memory"]);
  assert.equal(memory.length, 2); // header + Beta only
  assert.equal(memory[1][0], "Beta");

  const indexing = rows(back.Sheets["Indexing"]);
  assert.equal(indexing.length, 3); // header + Alpha + Beta
});

test("cards with no theme land on the noTheme sheet", () => {
  const wb = buildWorkbook([card("a", "Alpha", [])], LABELS);
  assert.deepEqual(wb.SheetNames, ["All", "(no theme)"]);
});

test("citation purposes are localized and joined per cell", () => {
  const wb = buildWorkbook([card("a", "Alpha", ["X"])], LABELS);
  const all = rows(wb.Sheets["All"]);
  const citeCol = all[0].indexOf("Cite for");
  assert.ok(citeCol >= 0);
  assert.equal(all[1][citeCol], "cite here（Method）");
});

test("safeSheetName strips forbidden chars, truncates to 31, dedupes", () => {
  const used = new Set<string>();
  assert.equal(safeSheetName("A/B:C*D", used), "A B C D");
  assert.equal(safeSheetName("x".repeat(40), used).length, 31);
  const first = safeSheetName("Dup", used);
  const second = safeSheetName("Dup", used);
  assert.notEqual(first, second);
});
