# 仕様書: カテゴリ（テーマ）名のリネーム

## 1. 背景と目的

このプラグインで「カテゴリ」に当たるのは各 Paper Card の `themes`（テーマ文字列の配列）で、
canvas パネルの一覧はこれでグループ分けしている（`groupedCards`、グループ見出し = テーマ）。

現状でも **1 枚のカードのテーマ変更**は可能:

- パネルの編集フォーム（テーマ欄、カンマ区切り）
- チャットで `update`（「○○ のテーマを △△ に変えて」）

しかし、**あるテーマを使う全カードを一括でリネームする**手段がない。テーマは複数カードで
共有され、グループ見出し・引用表・Related Work の単位になるため、名前を付け替えるとき
カードを 1 枚ずつ直すのは破綻する。

実例: `gated-deltanet-2-2026`「Gated DeltaNet-2」の `themes` は
`["Linear Attention", "Associative Memory"]`。`"Associative Memory"` が不適切なので
別名に変えたい（現状この語を使うカードは 1 枚だが、機能としては全カード一括で動くべき）。

### ゴール

パネルの**カテゴリ見出しから直接インラインでリネーム**でき、そのテーマを持つ
**全カードに反映**される。バックエンドに一括リネーム用の `renameTheme` を新設する。

## 2. スコープ

| 対象 | 含む / 含まない |
|---|---|
| Paper Card の `themes` 一括リネーム | ✅ 含む |
| `.md` ミラー（`papers/<slug>.md` の「テーマ:」行）への反映 | ✅ 含む（`writeCard` 経由で自動） |
| パネル見出しのインライン編集 UI（✎ → 入力 → 保存/取消） | ✅ 含む |
| Research Profile の `themes` の同時リネーム | ❌ 含まない（プロフィールは別概念。必要なら別途） |
| `NO_THEME`（テーマ無し）グループのリネーム | ❌ 不可（見出しはあるが編集ボタンを出さない） |
| 大文字小文字の揺れ吸収・あいまい一致 | ❌ 含まない（完全一致での置換） |

## 3. バックエンド設計（`src/index.ts` + `src/card.ts`）

### 3.1 純粋ヘルパー（`src/card.ts`、テスト用に分離）

```ts
/** themes 内の from を to に置換した新配列を返す。from を含まなければ null
 *  （= 変更なし、書き込み不要）。to が既存なら重複を畳んで順序を保つ。 */
export function applyThemeRename(themes: string[], from: string, to: string): string[] | null
```

- `from` を含まない → `null`
- 含む → `themes.map(t => t === from ? to : t)` を順序保持で de-dup（`to` が既にあれば 1 つに）

### 3.2 新しい kind: `renameTheme`

- Args（Zod 判別ユニオンに追加）:
  `z.object({ kind: z.literal("renameTheme"), from: z.string(), to: z.string() })`
- ハンドラ `handleRenameTheme(from, to)`（`withWriteLock` で直列化）:
  1. `from`/`to` を `trim`。空 or 同一 → `{ error, status: 400 }`
  2. 全カードを走査し、`applyThemeRename` が非 null のカードだけ
     `{ ...card, themes: <new> }` を **`writeCard` で保存**（`.json` + `.md` ミラー + `CHANGED` publish）。
     `created`/`updated` は据え置き（カテゴリ改名は内容編集ではないので recency を乱さない）。
  3. 戻り値: `{ data: { view: "list", cards }, message: 'Renamed "<from>" → "<to>" across N card(s).', jsonData: { from, to, count } }`
     （`view: "list"` で再描画 → グループ再構成）

### 3.3 エッジケース

- `from` を使うカードが 0 枚 → `count: 0` で正常終了（エラーにしない）。
- `to` が既存テーマ → そのカードでは重複を畳む（テーマが 1 つにまとまる）。
- 並行書き込み → 既存の `withWriteLock` で直列化。

## 4. ツール定義（`src/definition.ts`）

- `kind` enum に `"renameTheme"` を追加。
- `properties` に `from` / `to`（string）を追加。説明:
  「renameTheme: リネーム対象の現テーマ名 / 新テーマ名」。
- description 本文に 1 文追記: あるテーマを全カード一括で改名するときは `renameTheme`
  を使う（1 枚だけなら `update`）。

## 5. フロントエンド設計（`src/View.vue`）

### 5.1 見出しの再構成

現在 `.group-head` は単一 `<button>`（クリックで折りたたみ）。これを **コンテナ div** にし、
中に「折りたたみトグル button」＋「✎ リネーム button」＋（編集中は）「入力＋保存/取消」を置く。

```
<div class="group-head">
  <button class="group-toggle" @click="toggleCollapse(g.theme)">caret + name + count</button>
  <!-- 編集中 -->
  <input v-model="renaming.value" @keyup.enter="commitRename" @keyup.escape="cancelRename" @click.stop>
  <button @click="commitRename">保存</button>  <button @click="cancelRename">取消</button>
  <!-- 非編集かつ NO_THEME 以外 -->
  <button class="rename-btn" @click="startRename(g.theme)">✎</button>
</div>
```

編集中はトグル内の `group-name` を隠し、入力欄に置き換える（caret/count は残す）。

### 5.2 state とハンドラ

```ts
const renaming = reactive<{ theme: string | null; value: string }>({ theme: null, value: "" });
function startRename(theme: string): void   // renaming = { theme, value: theme }
function cancelRename(): void                // renaming.theme = null
async function commitRename(): Promise<void> // 下記
```

`commitRename`:
- `from = renaming.theme`、`to = renaming.value.trim()`
- 空 or `from === to` → 取消扱いで閉じる（dispatch しない）
- `dispatch({ kind: "renameTheme", from, to })` → 成功で `renaming.theme = null` → `refetch()`
- 失敗は `log.warn` のみ（既存 `saveEngine` 等と同パターン）

### 5.3 i18n（`src/lang/en.ts` + `ja.ts`、8 ではなくこの 2 ロケール）

| key | en | ja |
|---|---|---|
| `renameTheme` | "Rename category" | "カテゴリ名を変更" |
| `renamePlaceholder` | "New category name" | "新しいカテゴリ名" |

保存/取消は既存の `btnSave` / `btnCancel` を再利用。

### 5.4 CSS

`.group-head` をコンテナ化（背景・sticky・padding は維持、`width/border/cursor/font` は
`.group-toggle` 側へ移動）。新規 `.group-toggle` / `.rename-btn` / `.rename-input` を追加。
既存の `.group-name` / `.group-count` / `.caret` は流用。

## 6. 変更ファイル

- `src/card.ts` — `applyThemeRename` 追加（純粋）
- `src/index.ts` — Args に `renameTheme`、`handleRenameTheme`、switch 分岐
- `src/definition.ts` — kind enum + `from`/`to` params + 説明 1 文
- `src/View.vue` — 見出し再構成、`renaming` state + 3 ハンドラ、CSS、i18n 参照
- `src/lang/en.ts` / `src/lang/ja.ts` — `renameTheme` / `renamePlaceholder`
- `test/cardrename.test.ts`（新規）— `applyThemeRename` の純粋テスト
- `test/handler.test.ts` への追記 or 新規 — `renameTheme` の e2e（in-memory runtime）

## 7. テスト

- **純粋**（`applyThemeRename`）: from 不在 → null / from→to 置換 / to 既存で de-dup / 順序保持
- **ハンドラ**（in-memory runtime、既存 `handler.test.ts` の `memFileOps` 流用）:
  - 複数カードに跨るテーマを rename → 全カードの `themes` 更新、`count` 一致
  - `.md` ミラーの「テーマ:」行も更新される
  - `from` 不在 → `count: 0`
  - 空 / `from === to` → status 400

## 8. 検証手順

1. `yarn typecheck && yarn lint && yarn test && yarn build`（全緑）
2. プラグイン再ビルド後、`./dev.sh` で再起動（dist は import キャッシュされるため）
3. パネルでカテゴリ見出しの ✎ → "Associative Memory" を新名に変更 → 保存
4. 該当カード（gated-deltanet-2-2026）のテーマが更新され、グループ見出しが新名になることを確認
5. `papers/gated-deltanet-2-2026.md` の「テーマ:」行が新名になっていることを確認

## 9. 代替案（不採用）

- **per-card `update` のみ**（機能追加なし）: 1 枚なら十分だが、複数カードで共有された
  テーマの改名に耐えない。今回は将来の一括改名を見据えて backend を持つ。
- **chat 専用 `renameTheme`（UI なし）**: 実装は軽いが「見出しから直接」という操作性が出ない。
  今回はユーザー選択により UI まで含める。

---

## 10. 実装プラン（順序・コード・検証ゲート）

ボトムアップ（純粋 → backend → 定義 → UI）。`main` 上で作業（このリポジトリは main 直コミット運用）。
コミットはユーザー指示があるまでしない。

### Step 1 — 純粋ヘルパー `applyThemeRename`（`src/card.ts`）

`cardToMarkdown` の近く（Duplicate detection の手前あたり）に追加:

```ts
/** themes 内の from を to に置換した新配列を返す。from を含まなければ null
 *  （変更なし＝書き込み不要）。to が既存なら順序を保って de-dup する。 */
export function applyThemeRename(themes: string[], from: string, to: string): string[] | null {
  if (!themes.includes(from)) return null;
  return [...new Set(themes.map((t) => (t === from ? to : t)))];
}
```

### Step 2 — 純粋テスト（`test/cardrename.test.ts`、新規）

`from` 不在→null / 置換 / `to` 既存で de-dup / 順序保持 / 同一要素のみ の各ケース。

### Step 3 — backend ハンドラ（`src/index.ts`）

1. import 行に `applyThemeRename` を追加（`cardToMarkdown, ...` と同じ `./card` から）。
2. Args 判別ユニオンに追加:
   ```ts
   z.object({ kind: z.literal("renameTheme"), from: z.string(), to: z.string() }),
   ```
3. ハンドラ（他の `handle*` と並べて定義。`withWriteLock` / `listCards` / `writeCard` / `sortCards` は既存）:
   ```ts
   async function handleRenameTheme(from: string, to: string): Promise<unknown> {
     const fromT = from.trim();
     const toT = to.trim();
     if (!fromT || !toT) return { error: "renameTheme requires non-empty from/to", status: 400 };
     if (fromT === toT) return { error: "from and to are identical", status: 400 };
     return withWriteLock(async () => {
       let count = 0;
       for (const card of await listCards()) {
         const themes = applyThemeRename(card.themes, fromT, toT);
         if (!themes) continue;
         await writeCard({ ...card, themes }); // .json + .md ミラー + CHANGED、created/updated 据え置き
         count++;
       }
       const cards = sortCards(await listCards(), "recency");
       return { data: { view: "list", cards }, message: `Renamed theme "${fromT}" → "${toT}" across ${count} card(s).`, jsonData: { from: fromT, to: toT, count } };
     });
   }
   ```
4. switch に分岐: `case "renameTheme": return handleRenameTheme(args.from, args.to);`

### Step 4 — ツール定義（`src/definition.ts`）

- `kind` enum に `"renameTheme"` を追加。
- `properties` に追加:
  ```ts
  from: { type: "string", description: "renameTheme: the current theme (category) name to rename." },
  to: { type: "string", description: "renameTheme: the new theme name. Renames across ALL cards that use `from` (dedupes if `to` already present)." },
  ```
- description 本文に 1 文: あるテーマ（カテゴリ）を全カード一括で改名するときは `renameTheme`（from/to）。
  1 枚だけなら `update` の `themes`。

### Step 5 — backend e2e テスト（`test/handler.test.ts` に追記）

`memFileOps` runtime で：複数カードに跨るテーマを rename → 各 `themes` 更新＆`count` 一致／
`.md` ミラーの「テーマ:」行更新／`from` 不在で `count:0`／空・同一で status 400。

### ✅ ゲート A（UI 前）

`yarn typecheck && yarn lint && yarn test`（純粋＋backend e2e が緑）。ここまでで chat からは使える。

### Step 6 — i18n（`src/lang/en.ts` / `ja.ts`）

グループ表示キー（`sortRecency`/`noTheme` 近辺）に追加:

| key | en | ja |
|---|---|---|
| `renameTheme` | `"Rename category"` | `"カテゴリ名を変更"` |
| `renamePlaceholder` | `"New category name"` | `"新しいカテゴリ名"` |

### Step 7 — View（`src/View.vue`）

1. `<script>` に state＋ハンドラ（`clearChecks` の近く）:
   ```ts
   const renaming = reactive<{ theme: string | null; value: string }>({ theme: null, value: "" });
   function startRename(theme: string): void { renaming.theme = theme; renaming.value = theme; }
   function cancelRename(): void { renaming.theme = null; }
   async function commitRename(): Promise<void> {
     const from = renaming.theme;
     const to = renaming.value.trim();
     renaming.theme = null;
     if (!from || !to || from === to) return;
     try { await dispatch({ kind: "renameTheme", from, to }); await refetch(); }
     catch (err) { log.warn("renameTheme failed", { error: String(err) }); }
   }
   ```
2. テンプレートの `.group-head` を §5.1 の通りコンテナ化（toggle button ＋ ✎ ＋ 編集時 input＋保存/取消）。
   `NO_THEME` グループは ✎ を出さない。`@click.stop` で折りたたみトグルへの伝播を止める。
3. CSS: `.group-head` をコンテナ化（背景/sticky/padding 維持、`width/border/cursor/font` は
   `.group-toggle` へ移動）。`.group-toggle` / `.rename-btn` / `.rename-input` を新規追加。
   `.group-name`/`.group-count`/`.caret` は流用。

### ✅ ゲート B（全体）

`yarn typecheck && yarn lint && yarn test && yarn build`（全緑）。

### Step 8 — 手動検証

1. プラグイン再ビルド後 `./dev.sh` で再起動（dist は import キャッシュされるため必須）。
2. パネルでカテゴリ見出しの ✎ → "Associative Memory" を新名に変更 → 保存（Enter）。
3. `gated-deltanet-2-2026` のテーマ更新・グループ見出しが新名になることを確認。
4. `papers/gated-deltanet-2-2026.md` の「テーマ:」行が新名になっていることを確認。

### 影響範囲・リスク

- 触るのは plugin 内のみ（host 改修なし）。`writeCard` 経由なので `.md` ミラーと整合。
- `created/updated` 据え置きで一覧の並びは乱れない。
- 既存テストへの破壊なし（新 kind は追加のみ、既存 kind 不変）。想定テスト件数: 131 → 約 140。

