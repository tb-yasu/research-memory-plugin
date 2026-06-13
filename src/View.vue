<script setup lang="ts">
// Personal Literature Memory — canvas View. Modes driven by the tool
// result's discriminator (`view`): browse (list + detail in the Ochiai
// 6-question template + relational spine), citation table, export, and the
// research profile. Browse also offers an add/edit form so the plugin is
// fully usable without the LLM.

import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import { useRuntime } from "gui-chat-protocol/vue";
import * as XLSX from "xlsx";
import { useT } from "./lang";
import { buildWorkbook } from "./excel";
import { CODEX_MODELS, CODEX_REASONING_LEVELS, DEFAULT_ENGINE_CONFIG } from "./engine";

interface CitationPurpose {
  purpose: string;
  suggestedSection?: string;
  note?: string;
}
interface PaperCard {
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
  claims: string[];
  method?: string;
  evaluation?: string;
  limitations: string[];
  relatedPapers: string[];
  relationToMyWork?: string;
  researchContext?: string;
  citationPurposes: CitationPurpose[];
  reusableIdeas: string[];
  nextActions: string[];
  themes: string[];
  created: string;
  updated: string;
}
interface CitationRow {
  slug: string;
  title: string;
  purpose: string;
  suggestedSection: string;
  relationToMyWork: string;
}
// Related Work outline — deterministic skeleton built by src/relatedwork.ts.
interface OutlinePurpose {
  purpose: string;
  suggestedSection?: string;
}
interface OutlineEntry {
  slug: string;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  gist?: string;
  purposes: OutlinePurpose[];
}
interface OutlinePoint {
  slug: string;
  title: string;
  text: string;
}
interface OutlineGroup {
  label: string | null;
  points: OutlinePoint[];
  entries: OutlineEntry[];
}
interface RelatedWorkOutline {
  theme: string;
  focus: string | null;
  paperCount: number;
  groups: OutlineGroup[];
  gaps: { slug: string; title: string }[];
}
interface ResearchProfile {
  focus: string;
  themes: string[];
  questions: string[];
  updated: string;
}
interface DupHit {
  slug: string;
  title: string;
  reason: "doi" | "arxivId" | "title";
}
// The candidate payload the conflict view re-dispatches as either a
// `mergePapers` (with `targetSlug` picked by the user) or a `save` with
// `force: true`. Mirrors the cardFields union from the server entry.
interface ConflictCandidate {
  slug: string;
  title: string;
  authors?: string[];
  year?: number;
  venue?: string;
  url?: string;
  doi?: string;
  arxivId?: string;
  summary?: string;
  novelty?: string;
  claims?: string[];
  method?: string;
  evaluation?: string;
  limitations?: string[];
  relatedPapers?: string[];
  relationToMyWork?: string;
  researchContext?: string;
  citationPurposes?: CitationPurpose[];
  reusableIdeas?: string[];
  nextActions?: string[];
  themes?: string[];
}
// The host posts the handler's `data` payload as `selectedResult.data`
// (mcp-server.ts gates canvas rendering on the `data` field), and the
// dispatch endpoint returns the same `{ data, message }` envelope.
type ResultData =
  | { view: "list"; cards: PaperCard[]; theme?: string | null; query?: string | null; yearFrom?: number | null }
  | { view: "detail"; card: PaperCard }
  | { view: "citationTable"; theme: string; rows: CitationRow[] }
  | { view: "relatedWork"; outline: RelatedWorkOutline; markdown: string }
  | { view: "export"; format: string; scope: string | null; content: string }
  | { view: "profile"; profile: ResearchProfile }
  | { view: "conflict"; candidate: ConflictCandidate; duplicates: DupHit[] };
type DispatchResult = { data?: ResultData; message?: string; error?: string };

export interface Props {
  selectedResult: { data?: ResultData; message?: string; error?: string };
}
const props = defineProps<Props>();

const { dispatch, pubsub, log } = useRuntime();
const t = useT();

// Localize the suggestedSection enum for display only; the stored value
// stays the English enum (citation table + LLM controlled vocab).
function sectionLabel(section: string): string {
  return t.value.sections[section] ?? section;
}

type Mode = "browse" | "citation" | "relatedWork" | "export" | "profile" | "conflict";
const mode = ref<Mode>("browse");

const conflictCandidate = ref<ConflictCandidate | null>(null);
const conflictDuplicates = ref<DupHit[]>([]);

const EMPTY_PROFILE: ResearchProfile = { focus: "", themes: [], questions: [], updated: "" };

const sd = props.selectedResult.data;
const cards = ref<PaperCard[]>(sd?.view === "list" ? sd.cards : sd?.view === "detail" ? [sd.card] : []);
const selectedSlug = ref<string | null>(sd?.view === "detail" ? sd.card.slug : sd?.view === "list" ? (sd.cards[0]?.slug ?? null) : null);
// Seed the on-screen filters from the tool result so a scoped request
// ("show Agentic Memory papers") shows only that theme. cards.value still
// holds the full library (refetch keeps it fresh), so clearing the filter
// reveals everything again.
const query = ref(sd?.view === "list" ? (sd.query ?? "") : "");
const themeFilter = ref(sd?.view === "list" ? (sd.theme ?? "") : "");
const yearFromInput = ref(sd?.view === "list" && sd.yearFrom != null ? String(sd.yearFrom) : "");
const sortBy = ref<"recency" | "title">("recency");
const collapsed = reactive(new Set<string>());
const NO_THEME = "__no_theme__";

// Checkbox selection for ideation. The View cannot start the LLM (no
// chat-injection API), so checks persist server-side via setSelection
// and the user triggers generation with a chat phrase (see t.ideateHint).
const checkedSlugs = reactive(new Set<string>());

const citationRows = ref<CitationRow[]>(sd?.view === "citationTable" ? sd.rows : []);
const citationTheme = ref(sd?.view === "citationTable" ? sd.theme : "");
const outline = ref<RelatedWorkOutline | null>(sd?.view === "relatedWork" ? sd.outline : null);
const outlineMarkdown = ref(sd?.view === "relatedWork" ? sd.markdown : "");
const exportContent = ref(sd?.view === "export" ? sd.content : "");
const exportFormat = ref(sd?.view === "export" ? sd.format : "");
const copied = ref(false);

const profile = ref<ResearchProfile>(sd?.view === "profile" ? sd.profile : EMPTY_PROFILE);
const editingProfile = ref(false);
const pForm = reactive({ focus: "", themes: "", questions: "" });

if (sd?.view === "citationTable") mode.value = "citation";
else if (sd?.view === "relatedWork") mode.value = "relatedWork";
else if (sd?.view === "export") mode.value = "export";
else if (sd?.view === "profile") mode.value = "profile";
else if (sd?.view === "conflict") {
  conflictCandidate.value = sd.candidate;
  conflictDuplicates.value = sd.duplicates;
  mode.value = "conflict";
}

// ── derived ────────────────────────────────────────────────────────────
const allThemes = computed(() => [...new Set(cards.value.flatMap((c) => c.themes))].sort((a, b) => a.localeCompare(b)));

// "" / non-numeric → no year filter; otherwise the minimum publication year.
const yearFromNum = computed(() => {
  const n = Number(yearFromInput.value);
  return yearFromInput.value.trim() !== "" && Number.isFinite(n) ? n : null;
});
const visibleCards = computed(() => {
  const q = query.value.trim().toLowerCase();
  const yf = yearFromNum.value;
  return cards.value
    .filter((c) => (themeFilter.value ? c.themes.includes(themeFilter.value) : true))
    .filter((c) => (yf === null ? true : c.year !== undefined && c.year >= yf))
    .filter((c) => (q ? cardText(c).includes(q) : true))
    .sort((a, b) => b.updated.localeCompare(a.updated));
});

const selectedCard = computed(() => cards.value.find((c) => c.slug === selectedSlug.value) ?? null);

function cardText(c: PaperCard): string {
  return [c.title, c.summary ?? "", c.novelty ?? "", c.relationToMyWork ?? "", ...c.authors, ...c.claims].join(" ").toLowerCase();
}
function byline(c: PaperCard): string {
  const authors = c.authors.length > 0 ? c.authors.join(", ") : "";
  const year = c.year !== undefined ? ` (${c.year})` : "";
  return `${authors}${year}`.trim();
}

// Group the (filtered) list by theme so the browse pane stays navigable as
// the corpus grows. A theme filter collapses it to one flat group.
interface ThemeGroup {
  theme: string;
  cards: PaperCard[];
}
function sortCardsBy(list: PaperCard[]): PaperCard[] {
  if (sortBy.value === "title") return [...list].sort((a, b) => a.title.localeCompare(b.title));
  return [...list].sort((a, b) => b.updated.localeCompare(a.updated));
}
const groupedCards = computed<ThemeGroup[]>(() => {
  const base = visibleCards.value;
  if (themeFilter.value) return base.length > 0 ? [{ theme: themeFilter.value, cards: sortCardsBy(base) }] : [];
  const map = new Map<string, PaperCard[]>();
  for (const c of base) {
    for (const th of c.themes.length > 0 ? c.themes : [NO_THEME]) {
      const arr = map.get(th) ?? [];
      arr.push(c);
      map.set(th, arr);
    }
  }
  const names = [...map.keys()].filter((th) => th !== NO_THEME).sort((a, b) => a.localeCompare(b));
  if (map.has(NO_THEME)) names.push(NO_THEME);
  return names.map((th) => ({ theme: th, cards: sortCardsBy(map.get(th) ?? []) }));
});
function toggleCollapse(theme: string): void {
  if (collapsed.has(theme)) collapsed.delete(theme);
  else collapsed.add(theme);
}

// ── ideation selection ──────────────────────────────────────────────────
async function loadSelection(): Promise<void> {
  try {
    const res = await dispatch<{ jsonData?: { slugs?: string[] } }>({ kind: "getSelection" });
    checkedSlugs.clear();
    for (const slug of res.jsonData?.slugs ?? []) checkedSlugs.add(slug);
  } catch (err) {
    log.warn("loadSelection failed", { error: String(err) });
  }
}

async function persistSelection(): Promise<void> {
  try {
    await dispatch({ kind: "setSelection", slugs: [...checkedSlugs] });
  } catch (err) {
    log.warn("persistSelection failed", { error: String(err) });
  }
}

function toggleCheck(slug: string): void {
  if (checkedSlugs.has(slug)) checkedSlugs.delete(slug);
  else checkedSlugs.add(slug);
  void persistSelection();
}

function clearChecks(): void {
  checkedSlugs.clear();
  void persistSelection();
}

// ── ideation engine (Claude vs Codex) ───────────────────────────────────
// Loosely typed: the <select>s bind plain strings; the server validates
// them against the engine/reasoning enums on setEngineConfig.
const engineConfig = reactive<{ engine: string; codexModel: string; codexReasoning: string }>({ ...DEFAULT_ENGINE_CONFIG });

async function loadEngine(): Promise<void> {
  try {
    const res = await dispatch<{ jsonData?: { engine?: string; codexModel?: string; codexReasoning?: string } }>({ kind: "getEngineConfig" });
    const c = res.jsonData;
    if (c) {
      engineConfig.engine = c.engine ?? DEFAULT_ENGINE_CONFIG.engine;
      engineConfig.codexModel = c.codexModel ?? DEFAULT_ENGINE_CONFIG.codexModel;
      engineConfig.codexReasoning = c.codexReasoning ?? DEFAULT_ENGINE_CONFIG.codexReasoning;
    }
  } catch (err) {
    log.warn("loadEngine failed", { error: String(err) });
  }
}

async function saveEngine(): Promise<void> {
  // Omit codexModel when blank so the server keeps the prior value rather
  // than rejecting the empty string (the schema requires non-empty).
  const model = engineConfig.codexModel.trim();
  try {
    await dispatch({ kind: "setEngineConfig", engine: engineConfig.engine, codexModel: model || undefined, codexReasoning: engineConfig.codexReasoning });
  } catch (err) {
    log.warn("saveEngine failed", { error: String(err) });
  }
}

function reasoningLabel(level: string): string {
  return t.value.engineReasoningLevels[level] ?? level;
}

// ── data ───────────────────────────────────────────────────────────────
async function refetch(): Promise<void> {
  try {
    const res = await dispatch<DispatchResult>({ kind: "list" });
    if (res.data?.view === "list") {
      cards.value = res.data.cards;
      if (!selectedSlug.value || !res.data.cards.some((c) => c.slug === selectedSlug.value)) {
        selectedSlug.value = res.data.cards[0]?.slug ?? null;
      }
    }
  } catch (err) {
    log.warn("refetch failed", { error: String(err) });
  }
}

async function openCitation(theme: string): Promise<void> {
  try {
    const res = await dispatch<DispatchResult>({ kind: "citationTable", theme });
    if (res.data?.view === "citationTable") {
      citationRows.value = res.data.rows;
      citationTheme.value = res.data.theme;
      mode.value = "citation";
    }
  } catch (err) {
    log.warn("citationTable failed", { error: String(err) });
  }
}

async function openRelatedWork(theme: string): Promise<void> {
  if (!theme) return;
  try {
    const res = await dispatch<DispatchResult>({ kind: "relatedWork", theme });
    if (res.data?.view === "relatedWork") {
      outline.value = res.data.outline;
      outlineMarkdown.value = res.data.markdown;
      copied.value = false;
      mode.value = "relatedWork";
    }
  } catch (err) {
    log.warn("relatedWork failed", { error: String(err) });
  }
}

async function copyOutline(): Promise<void> {
  try {
    await navigator.clipboard.writeText(outlineMarkdown.value);
    copied.value = true;
  } catch (err) {
    log.warn("clipboard failed", { error: String(err) });
  }
}

// Compact byline for an outline entry: （First Author et al., 2023, arXiv）
function entryMeta(entry: OutlineEntry): string {
  const author = entry.authors.length > 0 ? `${entry.authors[0]}${entry.authors.length > 1 ? " et al." : ""}` : "";
  const parts = [author, entry.year !== undefined ? String(entry.year) : "", entry.venue ?? ""].filter(Boolean);
  return parts.join(", ");
}

async function doExport(format: "bibtex" | "markdown"): Promise<void> {
  try {
    const res = await dispatch<DispatchResult>({ kind: "export", format, scope: themeFilter.value || undefined });
    if (res.data?.view === "export") {
      exportContent.value = res.data.content;
      exportFormat.value = res.data.format;
      copied.value = false;
      mode.value = "export";
    }
  } catch (err) {
    log.warn("export failed", { error: String(err) });
  }
}

async function copyExport(): Promise<void> {
  try {
    await navigator.clipboard.writeText(exportContent.value);
    copied.value = true;
  } catch (err) {
    log.warn("clipboard failed", { error: String(err) });
  }
}

// Excel export runs entirely in the browser: the list already holds full
// cards, so we build the workbook (one sheet per theme + a leading "All"
// sheet) and let SheetJS trigger the download. Always the whole library,
// regardless of the on-screen search/theme filter.
function exportExcel(): void {
  if (cards.value.length === 0) return;
  try {
    const v = t.value;
    const wb = buildWorkbook(cards.value, { all: v.xlsxAll, noTheme: v.noTheme, cols: v.xlsxCols, sections: v.sections });
    XLSX.writeFile(wb, `literature-${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (err) {
    log.warn("excel export failed", { error: String(err) });
  }
}

// ── research profile ─────────────────────────────────────────────────────
async function loadProfile(): Promise<void> {
  try {
    const res = await dispatch<DispatchResult>({ kind: "getProfile" });
    if (res.data?.view === "profile") profile.value = res.data.profile;
  } catch (err) {
    log.warn("getProfile failed", { error: String(err) });
  }
}
async function openProfile(): Promise<void> {
  await loadProfile();
  editingProfile.value = false;
  mode.value = "profile";
}
function startEditProfile(): void {
  pForm.focus = profile.value.focus;
  pForm.themes = profile.value.themes.join(", ");
  pForm.questions = profile.value.questions.join("\n");
  editingProfile.value = true;
}
async function saveProfile(): Promise<void> {
  try {
    const res = await dispatch<DispatchResult>({ kind: "setProfile", focus: pForm.focus.trim(), themes: splitComma(pForm.themes), questions: splitLines(pForm.questions) });
    if (res.data?.view === "profile") profile.value = res.data.profile;
    editingProfile.value = false;
  } catch (err) {
    log.warn("setProfile failed", { error: String(err) });
  }
}

async function removeCard(slug: string): Promise<void> {
  try {
    await dispatch<DispatchResult>({ kind: "delete", slug });
  } catch (err) {
    log.warn("delete failed", { error: String(err) });
  }
}

// ── conflict resolution ─────────────────────────────────────────────────
async function openExistingFromConflict(slug: string): Promise<void> {
  try {
    const res = await dispatch<DispatchResult>({ kind: "read", slug });
    if (res.data?.view === "detail") {
      if (!cards.value.some((c) => c.slug === slug)) cards.value = [...cards.value, res.data.card];
      selectedSlug.value = slug;
      mode.value = "browse";
    }
  } catch (err) {
    log.warn("openExistingFromConflict failed", { error: String(err) });
  }
}
async function mergeIntoExisting(targetSlug: string): Promise<void> {
  const c = conflictCandidate.value;
  if (!c) return;
  try {
    const { slug: _candidateSlug, ...patch } = c;
    void _candidateSlug;
    const res = await dispatch<DispatchResult>({ kind: "mergePapers", targetSlug, ...patch });
    if (res.data?.view === "detail") {
      selectedSlug.value = targetSlug;
      mode.value = "browse";
      conflictCandidate.value = null;
      conflictDuplicates.value = [];
      await refetch();
    }
  } catch (err) {
    log.warn("mergeIntoExisting failed", { error: String(err) });
  }
}
async function overwriteFromConflict(): Promise<void> {
  const c = conflictCandidate.value;
  if (!c) return;
  try {
    const res = await dispatch<DispatchResult>({ kind: "save", ...c, force: true });
    if (res.data?.view === "detail") {
      selectedSlug.value = c.slug;
      mode.value = "browse";
      conflictCandidate.value = null;
      conflictDuplicates.value = [];
      await refetch();
    }
  } catch (err) {
    log.warn("overwriteFromConflict failed", { error: String(err) });
  }
}
function closeConflict(): void {
  conflictCandidate.value = null;
  conflictDuplicates.value = [];
  mode.value = "browse";
}
function dupReasonLabel(reason: DupHit["reason"]): string {
  if (reason === "doi") return t.value.dupReasonDoi;
  if (reason === "arxivId") return t.value.dupReasonArxiv;
  return t.value.dupReasonTitle;
}

// ── add / edit form ──────────────────────────────────────────────────────
const formMode = ref<null | "add" | "edit">(null);
const formError = ref("");
const form = reactive({
  slug: "",
  title: "",
  authors: "",
  year: "",
  venue: "",
  url: "",
  themes: "",
  summary: "",
  novelty: "",
  method: "",
  evaluation: "",
  relatedPapers: "",
  relationToMyWork: "",
  researchContext: "",
  reusableIdeas: "",
  nextActions: "",
  citationPurposes: "",
});

function resetForm(): void {
  Object.assign(form, { slug: "", title: "", authors: "", year: "", venue: "", url: "", themes: "", summary: "", novelty: "", method: "", evaluation: "", relatedPapers: "", relationToMyWork: "", researchContext: "", reusableIdeas: "", nextActions: "", citationPurposes: "" });
  formError.value = "";
}
function openAdd(): void {
  resetForm();
  formMode.value = "add";
}
function openEdit(c: PaperCard): void {
  resetForm();
  Object.assign(form, {
    slug: c.slug,
    title: c.title,
    authors: c.authors.join(", "),
    year: c.year !== undefined ? String(c.year) : "",
    venue: c.venue ?? "",
    url: c.url ?? "",
    themes: c.themes.join(", "),
    summary: c.summary ?? "",
    novelty: c.novelty ?? "",
    method: c.method ?? "",
    evaluation: c.evaluation ?? "",
    relatedPapers: c.relatedPapers.join("\n"),
    relationToMyWork: c.relationToMyWork ?? "",
    researchContext: c.researchContext ?? "",
    reusableIdeas: c.reusableIdeas.join("\n"),
    nextActions: c.nextActions.join("\n"),
    citationPurposes: c.citationPurposes.map((p) => (p.suggestedSection ? `${p.purpose} | ${p.suggestedSection}` : p.purpose)).join("\n"),
  });
  formMode.value = "edit";
}
function closeForm(): void {
  formMode.value = null;
}

function splitComma(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}
function splitLines(s: string): string[] {
  return s.split("\n").map((x) => x.trim()).filter(Boolean);
}
function parseCitations(s: string): CitationPurpose[] {
  return splitLines(s).map((line) => {
    const [purpose, section] = line.split("|").map((x) => x.trim());
    return section ? { purpose, suggestedSection: section } : { purpose };
  });
}

async function submitForm(): Promise<void> {
  if (!form.slug.trim() || !form.title.trim()) {
    formError.value = t.value.errSlugTitle;
    return;
  }
  const payload = {
    slug: form.slug.trim(),
    title: form.title.trim(),
    authors: splitComma(form.authors),
    year: form.year.trim() ? Number(form.year) : undefined,
    venue: form.venue.trim() || undefined,
    url: form.url.trim() || undefined,
    themes: splitComma(form.themes),
    summary: form.summary.trim() || undefined,
    novelty: form.novelty.trim() || undefined,
    method: form.method.trim() || undefined,
    evaluation: form.evaluation.trim() || undefined,
    relatedPapers: splitLines(form.relatedPapers),
    relationToMyWork: form.relationToMyWork.trim() || undefined,
    researchContext: form.researchContext.trim() || undefined,
    reusableIdeas: splitLines(form.reusableIdeas),
    nextActions: splitLines(form.nextActions),
    citationPurposes: parseCitations(form.citationPurposes),
  };
  try {
    await dispatch<DispatchResult>({ kind: formMode.value === "edit" ? "update" : "save", ...payload });
    selectedSlug.value = payload.slug;
    formMode.value = null;
  } catch (err) {
    formError.value = String(err);
  }
}

// ── lifecycle ────────────────────────────────────────────────────────────
let unsubscribe: (() => void) | null = null;
onMounted(() => {
  void refetch();
  void loadProfile();
  void loadSelection();
  void loadEngine();
  unsubscribe = pubsub.subscribe("changed", () => {
    void refetch();
    void loadProfile();
  });
});
onUnmounted(() => unsubscribe?.());
</script>

<template>
  <div class="lit">
    <!-- ── Citation table mode ─────────────────────────────────────────── -->
    <section v-if="mode === 'citation'" class="panel">
      <header class="panel-head">
        <h2>{{ t.citationTitle }} — {{ citationTheme }}</h2>
        <div class="row-gap">
          <button class="btn" :disabled="citationRows.length === 0" @click="openRelatedWork(citationTheme)">{{ t.btnRelatedWork }}</button>
          <button class="btn" @click="mode = 'browse'">{{ t.btnBack }}</button>
        </div>
      </header>
      <p v-if="citationRows.length === 0" class="hint">{{ t.emptyTable }}</p>
      <table v-else class="cite-table">
        <thead>
          <tr><th>{{ t.colPaper }}</th><th>{{ t.colPurpose }}</th><th>{{ t.colSection }}</th><th>{{ t.colRelation }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in citationRows" :key="`${row.slug}-${i}`">
            <td>{{ row.title }}</td><td>{{ row.purpose }}</td><td>{{ sectionLabel(row.suggestedSection) }}</td><td class="muted">{{ row.relationToMyWork }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- ── Related Work outline mode ───────────────────────────────────── -->
    <section v-else-if="mode === 'relatedWork'" class="panel">
      <header class="panel-head">
        <h2>{{ t.rwTitle }} — {{ outline?.theme }}</h2>
        <div class="row-gap">
          <button class="btn" :disabled="!outlineMarkdown" @click="copyOutline">{{ copied ? t.btnCopied : t.btnCopy }}</button>
          <button class="btn" @click="mode = 'browse'">{{ t.btnBack }}</button>
        </div>
      </header>
      <div class="rw-body">
        <p v-if="!outline || outline.paperCount === 0" class="hint">{{ t.emptyTable }}</p>
        <template v-else>
          <p class="rw-hint">{{ t.rwHint }}</p>
          <p v-if="outline.focus" class="rw-focus"><span class="rw-focus-label">{{ t.pFocus }}:</span> {{ outline.focus }}</p>
          <section v-for="(g, gi) in outline.groups" :key="g.label ?? '__rest__'" class="rw-group">
            <h3 class="rw-group-title">{{ gi + 1 }}. {{ g.label ?? t.rwUngrouped }} <span class="count">({{ g.entries.length }})</span></h3>
            <div v-if="g.points.length" class="block spine">
              <h4>{{ t.rwPoints }}</h4>
              <ul><li v-for="p in g.points" :key="p.slug"><strong>{{ p.title }}</strong> — {{ p.text }}</li></ul>
            </div>
            <div class="block">
              <h4>{{ t.rwPapers }}</h4>
              <ul class="rw-paper-list">
                <li v-for="e in g.entries" :key="e.slug" class="rw-paper">
                  <span class="rw-paper-title">{{ e.title }}</span>
                  <span v-if="entryMeta(e)" class="muted small">（{{ entryMeta(e) }}）</span>
                  <p v-if="e.gist" class="rw-gist">{{ e.gist }}</p>
                  <ul class="rw-purposes">
                    <li v-for="(p, i) in e.purposes" :key="i">{{ t.rwPurpose }}: {{ p.purpose }}<span v-if="p.suggestedSection" class="muted"> — {{ sectionLabel(p.suggestedSection) }}</span></li>
                    <li v-if="e.purposes.length === 0" class="muted">{{ t.rwNoPurpose }}</li>
                  </ul>
                </li>
              </ul>
            </div>
          </section>
          <p v-if="outline.gaps.length" class="rw-gaps">⚠ {{ t.rwGaps }}: {{ outline.gaps.map((x) => x.title).join(" / ") }}</p>
        </template>
      </div>
    </section>

    <!-- ── Export mode ─────────────────────────────────────────────────── -->
    <section v-else-if="mode === 'export'" class="panel">
      <header class="panel-head">
        <h2>{{ t.exportTitle }} — {{ exportFormat }}</h2>
        <div class="row-gap">
          <button class="btn" @click="copyExport">{{ copied ? t.btnCopied : t.btnCopy }}</button>
          <button class="btn" @click="mode = 'browse'">{{ t.btnBack }}</button>
        </div>
      </header>
      <pre class="export-pre">{{ exportContent }}</pre>
    </section>

    <!-- ── Conflict mode (duplicate detected on save) ──────────────────── -->
    <section v-else-if="mode === 'conflict'" class="panel">
      <header class="panel-head">
        <h2>{{ t.secConflict }}</h2>
        <button class="btn" @click="closeConflict">{{ t.btnBack }}</button>
      </header>
      <p class="hint">{{ t.conflictHint }}</p>
      <p v-if="conflictCandidate" class="conflict-candidate">
        <span class="muted">{{ t.conflictNew }}:</span>
        <strong>{{ conflictCandidate.title }}</strong>
        <span class="muted"> ({{ conflictCandidate.slug }})</span>
      </p>
      <ul class="conflict-list">
        <li v-for="d in conflictDuplicates" :key="d.slug" class="conflict-row">
          <div class="conflict-row-info">
            <strong>{{ d.title }}</strong>
            <span class="muted"> ({{ d.slug }}) · {{ dupReasonLabel(d.reason) }}</span>
          </div>
          <div class="row-gap">
            <button class="btn" @click="openExistingFromConflict(d.slug)">{{ t.btnOpenExisting }}</button>
            <button class="btn primary" @click="mergeIntoExisting(d.slug)">{{ t.btnMergeInto }}</button>
            <button class="btn warn" @click="overwriteFromConflict">{{ t.btnOverwrite }}</button>
          </div>
        </li>
      </ul>
    </section>

    <!-- ── Research profile mode ───────────────────────────────────────── -->
    <section v-else-if="mode === 'profile'" class="panel">
      <header class="panel-head">
        <h2>{{ t.profileTitle }}</h2>
        <div class="row-gap">
          <button v-if="!editingProfile" class="btn" @click="startEditProfile">{{ t.btnEdit }}</button>
          <button class="btn" @click="mode = 'browse'">{{ t.btnBack }}</button>
        </div>
      </header>
      <div class="profile-body">
        <template v-if="!editingProfile">
          <div class="block"><h4>{{ t.pFocus }}</h4><p class="pre-wrap">{{ profile.focus || t.pEmpty }}</p></div>
          <div v-if="profile.themes.length" class="block"><h4>{{ t.pThemes }}</h4><p class="chips"><span v-for="th in profile.themes" :key="th" class="chip">{{ th }}</span></p></div>
          <div v-if="profile.questions.length" class="block"><h4>{{ t.pQuestions }}</h4><ul><li v-for="(q, i) in profile.questions" :key="i">{{ q }}</li></ul></div>
        </template>
        <template v-else>
          <label class="pfield">{{ t.pEditFocus }}<textarea v-model="pForm.focus" rows="3" /></label>
          <label class="pfield">{{ t.pEditThemes }}<input v-model="pForm.themes" /></label>
          <label class="pfield">{{ t.pEditQuestions }}<textarea v-model="pForm.questions" rows="3" /></label>
          <div class="row-gap end">
            <button class="btn" @click="editingProfile = false">{{ t.btnCancel }}</button>
            <button class="btn primary" @click="saveProfile">{{ t.btnSave }}</button>
          </div>
        </template>
      </div>
    </section>

    <!-- ── Browse mode ─────────────────────────────────────────────────── -->
    <template v-else>
      <header class="topbar">
        <h2 class="brand">{{ t.title }} <span class="count">({{ cards.length }})</span></h2>
        <div class="row-gap">
          <input v-model="query" class="search" :placeholder="t.search" />
          <select v-model="themeFilter" class="select">
            <option value="">{{ t.allThemes }}</option>
            <option v-for="th in allThemes" :key="th" :value="th">{{ th }}</option>
          </select>
          <select v-model="sortBy" class="select">
            <option value="recency">{{ t.sortRecency }}</option>
            <option value="title">{{ t.sortTitle }}</option>
          </select>
          <input v-model="yearFromInput" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="4" class="year-input" :placeholder="t.yearFrom" :title="t.yearFrom" />
          <button class="btn" :disabled="!themeFilter" :title="t.btnCitation" @click="openCitation(themeFilter)">{{ t.btnCitation }}</button>
          <button class="btn" :disabled="!themeFilter" :title="t.rwTitle" @click="openRelatedWork(themeFilter)">{{ t.btnRelatedWork }}</button>
          <button class="btn" @click="doExport('bibtex')">{{ t.btnExportBibtex }}</button>
          <button class="btn" :disabled="cards.length === 0" @click="exportExcel">{{ t.btnExportExcel }}</button>
          <button class="btn" @click="openProfile">{{ t.profileBtn }}</button>
          <button class="btn primary" @click="openAdd">+ {{ t.btnAdd }}</button>
        </div>
      </header>

      <div class="engine-bar">
        <span class="engine-label">{{ t.engineLabel }}</span>
        <select v-model="engineConfig.engine" class="select" :title="t.engineLabel" @change="saveEngine">
          <option value="claude">Claude</option>
          <option value="codex">Codex</option>
        </select>
        <template v-if="engineConfig.engine === 'codex'">
          <input v-model="engineConfig.codexModel" class="engine-model" list="codex-models" :title="t.engineModel" :placeholder="t.engineModel" @change="saveEngine" />
          <datalist id="codex-models">
            <option v-for="m in CODEX_MODELS" :key="m" :value="m" />
          </datalist>
          <select v-model="engineConfig.codexReasoning" class="select" :title="t.engineReasoning" @change="saveEngine">
            <option v-for="r in CODEX_REASONING_LEVELS" :key="r" :value="r">{{ reasoningLabel(r) }}</option>
          </select>
          <span class="engine-hint">{{ t.engineCodexHint }}</span>
        </template>
      </div>

      <div v-if="profile.focus" class="focus-banner">
        <span class="focus-label">{{ t.pFocus }}:</span> {{ profile.focus }}
        <button class="link-btn" @click="openProfile">{{ t.btnEdit }}</button>
      </div>

      <div v-if="checkedSlugs.size > 0" class="selection-bar">
        <span class="sel-count">{{ checkedSlugs.size }} {{ t.selectedForIdeas }}</span>
        <span class="sel-hint">{{ t.ideateHint }}</span>
        <button class="link-btn" @click="clearChecks">{{ t.btnClearSelection }}</button>
      </div>

      <div class="body">
        <div class="list">
          <p v-if="groupedCards.length === 0" class="empty">{{ t.empty }}</p>
          <div v-for="g in groupedCards" :key="g.theme" class="group-block">
            <button class="group-head" @click="toggleCollapse(g.theme)">
              <span class="caret">{{ collapsed.has(g.theme) ? "▸" : "▾" }}</span>
              <span class="group-name">{{ g.theme === NO_THEME ? t.noTheme : g.theme }}</span>
              <span class="group-count">{{ g.cards.length }}</span>
            </button>
            <ul v-show="!collapsed.has(g.theme)" class="group-list">
              <li v-for="c in g.cards" :key="`${g.theme}/${c.slug}`" class="list-li">
                <input type="checkbox" class="check" :checked="checkedSlugs.has(c.slug)" :title="t.checkForIdeas" @change="toggleCheck(c.slug)" />
                <button class="list-row" :class="{ active: selectedSlug === c.slug }" @click="selectedSlug = c.slug">
                  <span class="list-title">{{ c.title }}</span>
                  <span class="list-by">{{ byline(c) }}</span>
                  <span v-if="c.relationToMyWork" class="list-rel">{{ c.relationToMyWork }}</span>
                </button>
              </li>
            </ul>
          </div>
        </div>

        <section class="detail">
          <p v-if="!selectedCard" class="hint">{{ t.selectHint }}</p>
          <template v-else>
            <div class="detail-head">
              <div>
                <h3 class="detail-title">{{ selectedCard.title }}</h3>
                <p class="detail-by">{{ byline(selectedCard) }}<span v-if="selectedCard.venue"> · {{ selectedCard.venue }}</span></p>
                <p v-if="selectedCard.themes.length" class="chips">
                  <span v-for="th in selectedCard.themes" :key="th" class="chip">{{ th }}</span>
                </p>
              </div>
              <div class="row-gap">
                <button class="btn" @click="openEdit(selectedCard)">{{ t.btnEdit }}</button>
                <button class="btn danger" @click="removeCard(selectedCard.slug)">{{ t.btnDelete }}</button>
              </div>
            </div>

            <!-- 論文（落合 6 問） -->
            <h4 class="group">{{ t.secPaper }}</h4>
            <div v-if="selectedCard.summary" class="block"><h4>{{ t.ochiai1 }}</h4><p class="pre-wrap">{{ selectedCard.summary }}</p></div>
            <div v-if="selectedCard.novelty || selectedCard.claims.length" class="block">
              <h4>{{ t.ochiai2 }}</h4>
              <p v-if="selectedCard.novelty" class="pre-wrap">{{ selectedCard.novelty }}</p>
              <ul v-if="selectedCard.claims.length"><li v-for="(x, i) in selectedCard.claims" :key="i">{{ x }}</li></ul>
            </div>
            <div v-if="selectedCard.method" class="block"><h4>{{ t.ochiai3 }}</h4><p class="pre-wrap">{{ selectedCard.method }}</p></div>
            <div v-if="selectedCard.evaluation" class="block"><h4>{{ t.ochiai4 }}</h4><p class="pre-wrap">{{ selectedCard.evaluation }}</p></div>
            <div v-if="selectedCard.limitations.length" class="block"><h4>{{ t.ochiai5 }}</h4><ul><li v-for="(x, i) in selectedCard.limitations" :key="i">{{ x }}</li></ul></div>
            <div v-if="selectedCard.relatedPapers.length" class="block"><h4>{{ t.ochiai6 }}</h4><ul><li v-for="(x, i) in selectedCard.relatedPapers" :key="i">{{ x }}</li></ul></div>
            <p v-if="selectedCard.url" class="block"><a :href="selectedCard.url" target="_blank" rel="noopener">{{ selectedCard.url }}</a></p>

            <!-- 自分の研究との接続（spine） -->
            <h4 class="group connection">{{ t.secConnection }}</h4>
            <div v-if="selectedCard.relationToMyWork" class="block spine">
              <h4>{{ t.secRelation }}</h4><p class="pre-wrap">{{ selectedCard.relationToMyWork }}</p>
              <p v-if="selectedCard.researchContext" class="muted small">↳ {{ t.secResearchContext }}: {{ selectedCard.researchContext }}</p>
            </div>
            <div v-if="selectedCard.citationPurposes.length" class="block spine">
              <h4>{{ t.secCitations }}</h4>
              <ul><li v-for="(p, i) in selectedCard.citationPurposes" :key="i">{{ p.purpose }}<span v-if="p.suggestedSection" class="muted"> — {{ sectionLabel(p.suggestedSection) }}</span></li></ul>
            </div>
            <div v-if="selectedCard.reusableIdeas.length" class="block spine">
              <h4>{{ t.secReusable }}</h4><ul><li v-for="(x, i) in selectedCard.reusableIdeas" :key="i">{{ x }}</li></ul>
            </div>
            <div v-if="selectedCard.nextActions.length" class="block spine">
              <h4>{{ t.secNextActions }}</h4><ul><li v-for="(x, i) in selectedCard.nextActions" :key="i">{{ x }}</li></ul>
            </div>
          </template>
        </section>
      </div>
    </template>

    <!-- ── Add / edit form (overlay) ───────────────────────────────────── -->
    <div v-if="formMode" class="modal-backdrop" @click.self="closeForm">
      <div class="modal">
        <h3>{{ formMode === "edit" ? t.formEditTitle : t.formAddTitle }}</h3>
        <div class="form-grid">
          <label>{{ t.fSlug }}<input v-model="form.slug" :disabled="formMode === 'edit'" /></label>
          <label>{{ t.fTitle }}<input v-model="form.title" /></label>
          <label>{{ t.fAuthors }}<input v-model="form.authors" /></label>
          <label>{{ t.fYear }}<input v-model="form.year" /></label>
          <label>{{ t.fVenue }}<input v-model="form.venue" /></label>
          <label>{{ t.fUrl }}<input v-model="form.url" /></label>
          <label class="wide">{{ t.fThemes }}<input v-model="form.themes" /></label>
          <label class="wide">{{ t.ochiai1 }}<textarea v-model="form.summary" rows="2" /></label>
          <label class="wide">{{ t.ochiai2 }}<textarea v-model="form.novelty" rows="2" /></label>
          <label class="wide">{{ t.ochiai3 }}<textarea v-model="form.method" rows="2" /></label>
          <label class="wide">{{ t.ochiai4 }}<textarea v-model="form.evaluation" rows="2" /></label>
          <label class="wide">{{ t.ochiai6 }}<textarea v-model="form.relatedPapers" rows="2" /></label>
          <label class="wide">{{ t.fRelation }}<textarea v-model="form.relationToMyWork" rows="2" /></label>
          <label class="wide">{{ t.fResearchContext }}<input v-model="form.researchContext" /></label>
          <label class="wide">{{ t.fCitePurposes }}<textarea v-model="form.citationPurposes" rows="2" /></label>
          <label class="wide">{{ t.fReusable }}<textarea v-model="form.reusableIdeas" rows="2" /></label>
          <label class="wide">{{ t.fNextActions }}<textarea v-model="form.nextActions" rows="2" /></label>
        </div>
        <p v-if="formError" class="err">{{ formError }}</p>
        <div class="row-gap end">
          <button class="btn" @click="closeForm">{{ t.btnCancel }}</button>
          <button class="btn primary" @click="submitForm">{{ t.btnSave }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lit {
  height: 100%;
  display: flex;
  flex-direction: column;
  font-family: system-ui, -apple-system, sans-serif;
  color: #1f2937;
  background: #fff;
}
.topbar,
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.625rem 1rem;
  border-bottom: 1px solid #e5e7eb;
  flex-wrap: wrap;
}
.brand {
  font-size: 1.05rem;
  font-weight: 600;
  margin: 0;
}
.count {
  color: #9ca3af;
  font-weight: 400;
  font-size: 0.85rem;
}
.row-gap {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.row-gap.end {
  justify-content: flex-end;
  margin-top: 0.75rem;
}
.search {
  height: 2rem;
  padding: 0 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 0.25rem;
  min-width: 12rem;
}
.select {
  height: 2rem;
  border: 1px solid #d1d5db;
  border-radius: 0.25rem;
  background: #fff;
}
.year-input {
  height: 2rem;
  width: 5.5rem;
  padding: 0 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 0.25rem;
}
.btn {
  height: 2rem;
  padding: 0 0.7rem;
  border: 1px solid #d1d5db;
  background: #fff;
  border-radius: 0.25rem;
  cursor: pointer;
  font: inherit;
  font-size: 0.85rem;
}
.btn:hover:not(:disabled) {
  background: #f9fafb;
}
.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.btn.primary {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
}
.btn.primary:hover {
  background: #1d4ed8;
}
.btn.danger {
  color: #dc2626;
  border-color: #fca5a5;
}
.btn.warn {
  color: #b45309;
  border-color: #fcd34d;
  background: #fffbeb;
}
.btn.warn:hover:not(:disabled) {
  background: #fef3c7;
}
.conflict-candidate {
  margin: 0.5rem 0 1rem;
  font-size: 0.95rem;
}
.conflict-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.conflict-row {
  border: 1px solid #e5e7eb;
  border-radius: 0.4rem;
  padding: 0.7rem 0.9rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
}
.conflict-row-info {
  font-size: 0.92rem;
  flex: 1;
  min-width: 0;
}
.focus-banner {
  padding: 0.4rem 1rem;
  background: #f8faff;
  border-bottom: 1px solid #e5e7eb;
  font-size: 0.82rem;
  color: #374151;
}
.focus-label {
  color: #4338ca;
  font-weight: 600;
}
.link-btn {
  background: none;
  border: none;
  color: #2563eb;
  cursor: pointer;
  font: inherit;
  font-size: 0.78rem;
  margin-left: 0.4rem;
}
.engine-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 1rem;
  background: #f5f3ff;
  border-bottom: 1px solid #e5e7eb;
  font-size: 0.82rem;
  color: #374151;
}
.engine-label {
  font-weight: 600;
  color: #6d28d9;
  white-space: nowrap;
}
.engine-model {
  width: 9rem;
  padding: 0.2rem 0.4rem;
  border: 1px solid #d1d5db;
  border-radius: 0.25rem;
  font: inherit;
  font-size: 0.8rem;
}
.engine-hint {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #6b7280;
}
.selection-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 1rem;
  background: #fefce8;
  border-bottom: 1px solid #e5e7eb;
  font-size: 0.82rem;
  color: #374151;
}
.sel-count {
  font-weight: 600;
  color: #a16207;
  white-space: nowrap;
}
.sel-hint {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.list-li {
  display: flex;
  align-items: flex-start;
}
.check {
  flex: 0 0 auto;
  margin: 0.7rem 0 0 0.5rem;
  cursor: pointer;
  accent-color: #2563eb;
}
.list-li .list-row {
  flex: 1;
  min-width: 0;
}
.body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.list {
  flex: 0 0 17rem;
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  border-right: 1px solid #f3f4f6;
  background: #fafafa;
}
.list-row {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.6rem 0.85rem;
  border: none;
  border-bottom: 1px solid #f3f4f6;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font: inherit;
}
.list-row:hover {
  background: #fff;
}
.list-row.active {
  background: #fff;
  box-shadow: inset 3px 0 0 0 #2563eb;
}
.list-title {
  font-weight: 600;
  font-size: 0.9rem;
}
.list-by {
  font-size: 0.75rem;
  color: #6b7280;
}
.list-rel {
  font-size: 0.75rem;
  color: #4b5563;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.group-block {
  border-bottom: 1px solid #eef0f3;
}
.group-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.4rem 0.6rem;
  border: none;
  background: #eef2ff;
  cursor: pointer;
  font: inherit;
  font-size: 0.76rem;
  font-weight: 700;
  color: #3730a3;
  position: sticky;
  top: 0;
  z-index: 1;
}
.group-head:hover {
  background: #e0e7ff;
}
.caret {
  width: 0.8rem;
  color: #6366f1;
}
.group-name {
  flex: 1;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.group-count {
  font-size: 0.68rem;
  color: #4338ca;
  background: #fff;
  border-radius: 999px;
  padding: 0 0.4rem;
}
.group-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}
.chip {
  font-size: 0.68rem;
  padding: 0.05rem 0.4rem;
  border-radius: 999px;
  background: #eef2ff;
  color: #4338ca;
}
.empty,
.hint {
  padding: 1rem;
  color: #9ca3af;
  font-style: italic;
  font-size: 0.85rem;
}
.detail,
.profile-body {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 1.25rem 1.5rem;
}
.detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}
.detail-title {
  margin: 0 0 0.25rem;
  font-size: 1.2rem;
}
.detail-by {
  margin: 0 0 0.4rem;
  color: #6b7280;
  font-size: 0.85rem;
}
.group {
  margin: 1.5rem 0 0.4rem;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #2563eb;
  border-bottom: 1px solid #e5e7eb;
  padding-bottom: 0.2rem;
}
.group.connection {
  color: #4338ca;
}
.block {
  margin-top: 0.85rem;
}
.block h4 {
  margin: 0 0 0.3rem;
  font-size: 0.82rem;
  font-weight: 600;
  color: #374151;
}
.block ul {
  margin: 0;
  padding-left: 1.2rem;
}
.block li {
  margin: 0.15rem 0;
}
.spine {
  background: #f8faff;
  border-left: 3px solid #2563eb;
  padding: 0.5rem 0.75rem;
  border-radius: 0 0.25rem 0.25rem 0;
}
.pre-wrap {
  white-space: pre-wrap;
  margin: 0;
}
.muted {
  color: #6b7280;
}
.small {
  font-size: 0.78rem;
}
.pfield {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.8rem;
  color: #6b7280;
  margin-bottom: 0.85rem;
}
.pfield input,
.pfield textarea {
  border: 1px solid #d1d5db;
  border-radius: 0.25rem;
  padding: 0.4rem 0.5rem;
  font: inherit;
  font-size: 0.85rem;
  color: #1f2937;
}
.panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.panel-head h2 {
  margin: 0;
  font-size: 1rem;
}
.cite-table {
  border-collapse: collapse;
  width: 100%;
  font-size: 0.85rem;
}
.cite-table th,
.cite-table td {
  border-bottom: 1px solid #eef0f3;
  text-align: left;
  padding: 0.5rem 0.75rem;
  vertical-align: top;
}
.cite-table th {
  background: #fafafa;
  font-weight: 600;
}
.rw-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0.75rem 1.5rem 1.5rem;
}
.rw-hint {
  margin: 0.25rem 0 0;
  color: #9ca3af;
  font-size: 0.78rem;
}
.rw-focus {
  margin: 0.6rem 0 0;
  padding: 0.4rem 0.75rem;
  background: #f8faff;
  border-left: 3px solid #4338ca;
  border-radius: 0 0.25rem 0.25rem 0;
  font-size: 0.85rem;
}
.rw-focus-label {
  color: #4338ca;
  font-weight: 600;
}
.rw-group {
  margin-top: 1.25rem;
}
.rw-group-title {
  margin: 0;
  font-size: 1rem;
  border-bottom: 1px solid #e5e7eb;
  padding-bottom: 0.25rem;
}
.rw-paper-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.rw-paper {
  margin: 0.5rem 0;
}
.rw-paper-title {
  font-weight: 600;
  font-size: 0.9rem;
}
.rw-gist {
  margin: 0.1rem 0 0;
  color: #4b5563;
  font-size: 0.82rem;
}
.rw-purposes {
  margin: 0.15rem 0 0;
  padding-left: 1.2rem;
  font-size: 0.85rem;
}
.rw-gaps {
  margin-top: 1.25rem;
  padding: 0.5rem 0.75rem;
  background: #fffbeb;
  border: 1px solid #fcd34d;
  border-radius: 0.25rem;
  color: #b45309;
  font-size: 0.82rem;
}
.export-pre {
  flex: 1;
  margin: 0;
  padding: 1rem;
  overflow: auto;
  background: #0f172a;
  color: #e2e8f0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8rem;
  white-space: pre-wrap;
}
.modal-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(15, 23, 42, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}
.modal {
  background: #fff;
  border-radius: 0.5rem;
  padding: 1.25rem;
  width: min(40rem, 100%);
  max-height: 90%;
  overflow-y: auto;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.25);
}
.modal h3 {
  margin: 0 0 0.75rem;
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
}
.form-grid label {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.78rem;
  color: #6b7280;
}
.form-grid label.wide {
  grid-column: 1 / -1;
}
.form-grid input,
.form-grid textarea {
  border: 1px solid #d1d5db;
  border-radius: 0.25rem;
  padding: 0.35rem 0.5rem;
  font: inherit;
  font-size: 0.85rem;
  color: #1f2937;
}
.form-grid input:disabled {
  background: #f3f4f6;
}
.err {
  color: #dc2626;
  font-size: 0.85rem;
  margin: 0.5rem 0 0;
}
a {
  color: #2563eb;
}
</style>
