// Excel (.xlsx) workbook builder — pure, DOM-free, so it is unit-testable
// in Node (test/excel.test.ts) and reusable from the browser View.
//
// The View hands us the full paper list plus localized labels; we return a
// SheetJS workbook with one "All" sheet followed by one sheet per theme
// (genre). The View is the only place that touches the browser — it calls
// XLSX.writeFile(wb, name) to trigger the download. Keeping the build step
// here means no DOM dependency leaks into the testable core.

import * as XLSX from "xlsx";

// Structural shape we read off a card — satisfied by both the View's local
// PaperCard interface and card.ts's PaperCard, so neither has to import us.
export interface ExcelCard {
  slug: string;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  url?: string;
  doi?: string;
  arxivId?: string;
  summary?: string;
  novelty?: string;
  method?: string;
  evaluation?: string;
  limitations: string[];
  relatedPapers: string[];
  relationToMyWork?: string;
  researchContext?: string;
  citationPurposes: { purpose: string; suggestedSection?: string }[];
  reusableIdeas: string[];
  nextActions: string[];
  themes: string[];
}

export interface ExcelLabels {
  all: string; // name of the leading "all papers" sheet
  noTheme: string; // sheet name for cards with no theme
  cols: Record<string, string>; // COL_ORDER key -> localized header
  sections: Record<string, string>; // suggestedSection enum -> localized label
}

// Column order is shared by the header row and every data row. The two
// builders below MUST stay in lockstep with this list.
const COL_ORDER = [
  "title",
  "authors",
  "year",
  "venue",
  "themes",
  "summary",
  "novelty",
  "method",
  "evaluation",
  "limitations",
  "relatedPapers",
  "relation",
  "context",
  "citePurposes",
  "reusable",
  "nextActions",
  "url",
  "doi",
  "arxiv",
  "slug",
] as const;

const COL_WIDTHS = [40, 24, 6, 16, 20, 42, 42, 42, 42, 40, 36, 42, 24, 42, 36, 36, 30, 22, 14, 24].map((wch) => ({ wch }));

const NL = "\n";

function joinPurposes(card: ExcelCard, sections: Record<string, string>): string {
  return card.citationPurposes.map((p) => (p.suggestedSection ? `${p.purpose}（${sections[p.suggestedSection] ?? p.suggestedSection}）` : p.purpose)).join(NL);
}

function headerRow(labels: ExcelLabels): string[] {
  return COL_ORDER.map((key) => labels.cols[key] ?? key);
}

function cardCells(card: ExcelCard, labels: ExcelLabels): (string | number)[] {
  return [
    card.title,
    card.authors.join(", "),
    card.year ?? "",
    card.venue ?? "",
    card.themes.join(", "),
    card.summary ?? "",
    card.novelty ?? "",
    card.method ?? "",
    card.evaluation ?? "",
    card.limitations.join(NL),
    card.relatedPapers.join(NL),
    card.relationToMyWork ?? "",
    card.researchContext ?? "",
    joinPurposes(card, labels.sections),
    card.reusableIdeas.join(NL),
    card.nextActions.join(NL),
    card.url ?? "",
    card.doi ?? "",
    card.arxivId ?? "",
    card.slug,
  ];
}

// Excel sheet names: <=31 chars, none of : \ / ? * [ ], non-empty, unique.
export function safeSheetName(raw: string, used: Set<string>): string {
  const cleaned = raw.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31);
  const base = cleaned.length > 0 ? cleaned : "Sheet";
  let name = base;
  let i = 2;
  while (used.has(name)) {
    const suffix = ` (${i})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
    i += 1;
  }
  used.add(name);
  return name;
}

function sheetFor(cards: ExcelCard[], labels: ExcelLabels): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet([headerRow(labels), ...cards.map((c) => cardCells(c, labels))]);
  ws["!cols"] = COL_WIDTHS;
  return ws;
}

function groupByTheme(cards: ExcelCard[], noTheme: string): Map<string, ExcelCard[]> {
  const map = new Map<string, ExcelCard[]>();
  for (const card of cards) {
    for (const theme of card.themes.length > 0 ? card.themes : [noTheme]) {
      const arr = map.get(theme) ?? [];
      arr.push(card);
      map.set(theme, arr);
    }
  }
  return map;
}

/**
 * Build a workbook: a leading "all papers" sheet, then one sheet per theme
 * (alphabetical). A paper with N themes appears on N theme sheets; a paper
 * with no theme lands on the `noTheme` sheet.
 */
export function buildWorkbook(cards: ExcelCard[], labels: ExcelLabels): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  XLSX.utils.book_append_sheet(wb, sheetFor(cards, labels), safeSheetName(labels.all, used));
  const groups = groupByTheme(cards, labels.noTheme);
  for (const theme of [...groups.keys()].sort((a, b) => a.localeCompare(b))) {
    XLSX.utils.book_append_sheet(wb, sheetFor(groups.get(theme) ?? [], labels), safeSheetName(theme, used));
  }
  return wb;
}
