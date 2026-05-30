<script setup lang="ts">
// Personal Literature Memory — canvas View. Modes driven by the tool
// result's discriminator (`view`): browse (list + detail in the Ochiai
// 6-question template + relational spine), citation table, export, and the
// research profile. Browse also offers an add/edit form so the plugin is
// fully usable without the LLM.

import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import { useRuntime } from "gui-chat-protocol/vue";
import { useT } from "./lang";

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
interface ResearchProfile {
  focus: string;
  themes: string[];
  questions: string[];
  updated: string;
}
// The host posts the handler's `data` payload as `selectedResult.data`
// (mcp-server.ts gates canvas rendering on the `data` field), and the
// dispatch endpoint returns the same `{ data, message }` envelope.
type ResultData =
  | { view: "list"; cards: PaperCard[] }
  | { view: "detail"; card: PaperCard }
  | { view: "citationTable"; theme: string; rows: CitationRow[] }
  | { view: "export"; format: string; scope: string | null; content: string }
  | { view: "profile"; profile: ResearchProfile };
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

type Mode = "browse" | "citation" | "export" | "profile";
const mode = ref<Mode>("browse");

const EMPTY_PROFILE: ResearchProfile = { focus: "", themes: [], questions: [], updated: "" };

const sd = props.selectedResult.data;
const cards = ref<PaperCard[]>(sd?.view === "list" ? sd.cards : sd?.view === "detail" ? [sd.card] : []);
const selectedSlug = ref<string | null>(sd?.view === "detail" ? sd.card.slug : sd?.view === "list" ? (sd.cards[0]?.slug ?? null) : null);
const query = ref("");
const themeFilter = ref("");
const sortBy = ref<"recency" | "title">("recency");
const collapsed = reactive(new Set<string>());
const NO_THEME = "__no_theme__";

const citationRows = ref<CitationRow[]>(sd?.view === "citationTable" ? sd.rows : []);
const citationTheme = ref(sd?.view === "citationTable" ? sd.theme : "");
const exportContent = ref(sd?.view === "export" ? sd.content : "");
const exportFormat = ref(sd?.view === "export" ? sd.format : "");
const copied = ref(false);

const profile = ref<ResearchProfile>(sd?.view === "profile" ? sd.profile : EMPTY_PROFILE);
const editingProfile = ref(false);
const pForm = reactive({ focus: "", themes: "", questions: "" });

if (sd?.view === "citationTable") mode.value = "citation";
else if (sd?.view === "export") mode.value = "export";
else if (sd?.view === "profile") mode.value = "profile";

// ── derived ────────────────────────────────────────────────────────────
const allThemes = computed(() => [...new Set(cards.value.flatMap((c) => c.themes))].sort((a, b) => a.localeCompare(b)));

const visibleCards = computed(() => {
  const q = query.value.trim().toLowerCase();
  return cards.value
    .filter((c) => (themeFilter.value ? c.themes.includes(themeFilter.value) : true))
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
        <button class="btn" @click="mode = 'browse'">{{ t.btnBack }}</button>
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
          <button class="btn" :disabled="!themeFilter" :title="t.btnCitation" @click="openCitation(themeFilter)">{{ t.btnCitation }}</button>
          <button class="btn" @click="doExport('bibtex')">{{ t.btnExportBibtex }}</button>
          <button class="btn" @click="openProfile">{{ t.profileBtn }}</button>
          <button class="btn primary" @click="openAdd">+ {{ t.btnAdd }}</button>
        </div>
      </header>

      <div v-if="profile.focus" class="focus-banner">
        <span class="focus-label">{{ t.pFocus }}:</span> {{ profile.focus }}
        <button class="link-btn" @click="openProfile">{{ t.btnEdit }}</button>
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
              <li v-for="c in g.cards" :key="`${g.theme}/${c.slug}`">
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
