// Related Work outline — one step past the citation table. Pure module:
// deterministically turn a theme's Paper Cards into a writing skeleton —
// paper groups (by co-occurring themes), per-group discussion points (the
// cards' relationToMyWork), and per-paper citation purposes — plus a
// ready-to-paste markdown rendering. The LLM may draft prose ON TOP of
// this skeleton; extraction, grouping, and ordering stay plugin-side,
// explainable, and unit-tested.

import { SUGGESTED_SECTIONS, type CitationPurpose, type PaperCard } from "./card";

export interface OutlinePurpose {
  purpose: string;
  suggestedSection?: string;
}

export interface OutlineEntry {
  slug: string;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  /** What the paper contributes (novelty, falling back to summary) —
   *  the substance the prose is grounded in, so the LLM never has to
   *  invent what a paper did. */
  gist?: string;
  purposes: OutlinePurpose[];
}

/** One paper's relationToMyWork, labelled with its paper. The label is
 *  structural, not stylistic: in the group-level 論点 list the text is
 *  displayed detached from its card, so an unlabelled statement loses
 *  its antecedent (「どの論文の話か」が消える). */
export interface OutlinePoint {
  slug: string;
  title: string;
  text: string;
}

export interface OutlineGroup {
  /** Co-occurring theme the group is built from; null = the fallback
   *  bucket for papers that carry no theme besides the queried one. */
  label: string | null;
  /** Per-paper relationToMyWork statements — the contrast/positioning
   *  material for the paragraph, in the group's chronological order. */
  points: OutlinePoint[];
  entries: OutlineEntry[];
}

export interface RelatedWorkOutline {
  theme: string;
  /** The user's research focus (profile.focus) — rendered up front so
   *  every 「本研究」 in the points has an explicit referent. */
  focus: string | null;
  paperCount: number;
  groups: OutlineGroup[];
  /** Papers with no citationPurposes recorded — surfaced so the gap can
   *  be filled before writing, instead of discovered mid-draft. */
  gaps: { slug: string; title: string }[];
}

// Related Work / Introduction purposes lead; the rest keep the section
// enum order; section-less purposes go last. Sort is stable, so input
// order is preserved within a rank.
const SECTION_ORDER = ["Related Work", "Introduction", ...SUGGESTED_SECTIONS.filter((s) => s !== "Related Work" && s !== "Introduction")];

function sectionRank(p: CitationPurpose): number {
  const i = p.suggestedSection ? SECTION_ORDER.indexOf(p.suggestedSection) : -1;
  return i === -1 ? SECTION_ORDER.length : i;
}

// Chronological — the natural Related Work narrative. Unknown year last.
function byChronology(a: PaperCard, b: PaperCard): number {
  const ya = a.year ?? Number.MAX_SAFE_INTEGER;
  const yb = b.year ?? Number.MAX_SAFE_INTEGER;
  return ya - yb || a.title.localeCompare(b.title);
}

// Multi-line card text → one markdown-bullet-safe line.
function oneLine(s: string | undefined): string | undefined {
  const flat = s?.replace(/\s*\n+\s*/g, " ").trim();
  return flat || undefined;
}

function toEntry(card: PaperCard): OutlineEntry {
  const purposes = [...card.citationPurposes].sort((a, b) => sectionRank(a) - sectionRank(b)).map((p) => ({ purpose: p.purpose, suggestedSection: p.suggestedSection }));
  return { slug: card.slug, title: card.title, authors: card.authors, year: card.year, venue: card.venue, gist: oneLine(card.novelty ?? card.summary), purposes };
}

function collectPoints(cards: PaperCard[]): OutlinePoint[] {
  const out: OutlinePoint[] = [];
  for (const card of cards) {
    const text = card.relationToMyWork?.trim();
    if (text) out.push({ slug: card.slug, title: card.title, text });
  }
  return out;
}

// Group labels = the themes that co-occur with the queried one, largest
// group first (count desc, then name). Each paper lands in exactly ONE
// group — its largest co-theme — so the outline never repeats a citation.
function coThemeOrder(cards: PaperCard[], theme: string): string[] {
  const counts = new Map<string, number>();
  for (const card of cards) {
    for (const t of card.themes) {
      if (t !== theme) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return [...counts.keys()].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b));
}

export function buildRelatedWorkOutline(cards: PaperCard[], theme: string, focus?: string): RelatedWorkOutline {
  const inTheme = cards.filter((card) => card.themes.includes(theme)).sort(byChronology);
  const order = coThemeOrder(inTheme, theme);
  const members = new Map<string | null, PaperCard[]>();
  for (const card of inTheme) {
    const label = order.find((t) => card.themes.includes(t)) ?? null;
    members.set(label, [...(members.get(label) ?? []), card]);
  }
  const groups: OutlineGroup[] = [];
  for (const label of [...order, null]) {
    const group = members.get(label) ?? [];
    // A co-theme can lose all its papers to larger groups — drop it.
    if (group.length === 0) continue;
    groups.push({ label, points: collectPoints(group), entries: group.map(toEntry) });
  }
  const gaps = inTheme.filter((card) => card.citationPurposes.length === 0).map((card) => ({ slug: card.slug, title: card.title }));
  return { theme, focus: focus?.trim() || null, paperCount: inTheme.length, groups, gaps };
}

/** Filesystem-safe, deterministic file stem for a theme name — unicode
 *  letters/digits kept (Japanese theme names work), everything else
 *  collapsed to hyphens. "Agentic Memory" → "agentic-memory". */
export function themeSlug(theme: string): string {
  const slug = theme
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "theme";
}

// ── Markdown rendering ───────────────────────────────────────────────
// Japanese labels, matching the toMarkdownBundle export style.

const FALLBACK_LABEL = "その他（共起テーマなし）";

function entryByline(entry: OutlineEntry): string {
  const author = entry.authors.length > 0 ? `${entry.authors[0]}${entry.authors.length > 1 ? " et al." : ""}` : "";
  const parts = [author, entry.year !== undefined ? String(entry.year) : "", entry.venue ?? ""].filter(Boolean);
  return parts.length > 0 ? `（${parts.join(", ")}）` : "";
}

function purposeLines(entry: OutlineEntry): string[] {
  if (entry.purposes.length === 0) return ["  - 引用目的: （未記入）"];
  return entry.purposes.map((p) => `  - 引用目的: ${p.purpose}${p.suggestedSection ? `（${p.suggestedSection}）` : ""}`);
}

function entryToMarkdown(entry: OutlineEntry): string {
  const lines = [`- **${entry.title}**${entryByline(entry)}`];
  if (entry.gist) lines.push(`  - 要点: ${entry.gist}`);
  lines.push(...purposeLines(entry));
  return lines.join("\n");
}

function groupToMarkdown(group: OutlineGroup, index: number): string {
  const blocks = [`## ${index + 1}. ${group.label ?? FALLBACK_LABEL}（${group.entries.length}本）`];
  if (group.points.length > 0) blocks.push(`**論点（自分の研究との対比）:**\n\n${group.points.map((p) => `- **${p.title}** — ${p.text}`).join("\n")}`);
  blocks.push(`**引用する論文:**\n\n${group.entries.map(entryToMarkdown).join("\n")}`);
  return blocks.join("\n\n");
}

export function relatedWorkToMarkdown(outline: RelatedWorkOutline): string {
  const title = `# Related Work アウトライン — ${outline.theme}`;
  if (outline.paperCount === 0) return `${title}\n\n（このテーマの論文はまだありません）`;
  const summary = `${outline.paperCount}本 / ${outline.groups.length}グループ（グループ＝共起テーマ・多い順、グループ内は年代順）`;
  const blocks = [title, summary];
  // 「本研究」の指示対象を成果物の側で明示する — 論点の各文はこれとの対比。
  if (outline.focus) blocks.push(`**自分の研究:** ${outline.focus}`);
  blocks.push(...outline.groups.map(groupToMarkdown));
  if (outline.gaps.length > 0) blocks.push(`> ⚠ 引用目的が未記入: ${outline.gaps.map((g) => g.title).join("／")}`);
  return blocks.join("\n\n");
}
