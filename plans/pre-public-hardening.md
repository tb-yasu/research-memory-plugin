# 仕様書: GitHub 公開前ハードニング

## 0. 背景・ゴール

research-memory-plugin を **GitHub 公開（clone → MulmoClaude の dev-plugin として利用）** する。
コア機能は揃っているため、公開前に必要なのは「OSS の体裁」「他人が使い始められる導線」
「公開 API への行儀」。ユーザー選択により次の 4 項目を実装する。

- A. リリース体裁一式（LICENSE / package.json メタデータ / CI）
- B. README オンボーディング
- C. mailto polite pool（OpenAlex / Crossref）
- D. dev.sh の可搬化

確定情報: 著者 = Yasuo Tabei（`yasuo.tabei@gmail.com`）、
remote = `git@github.com:tb-yasu/research-memory-plugin.git`。

非対象（公開後で可）: テーマ untag、レスポンスキャッシュ、非 arXiv / PDF 全文、追加ロケール。

---

## A. リリース体裁一式

### A-1. LICENSE ファイル（新規 `LICENSE`）

- MIT 全文。著作権表記 `Copyright (c) 2026 Yasuo Tabei`。
- package.json は既に `"license": "MIT"` 宣言済み → 本体ファイルを足すだけ。

### A-2. package.json メタデータ

既存に加えて以下を追加（npm 公開はしないが、公開リポジトリの体裁として）:

```jsonc
"repository": { "type": "git", "url": "git+https://github.com/tb-yasu/research-memory-plugin.git" },
"homepage": "https://github.com/tb-yasu/research-memory-plugin#readme",
"bugs": { "url": "https://github.com/tb-yasu/research-memory-plugin/issues" },
"author": "Yasuo Tabei",
"keywords": ["mulmoclaude", "gui-chat-protocol", "plugin", "research", "literature",
             "papers", "arxiv", "openalex", "crossref", "citations", "zettelkasten"]
```

- `author` は名前のみ（email は git commit で既に公開済みだが package.json への明記は任意。
  入れるなら `"Yasuo Tabei <yasuo.tabei@gmail.com>"`。**既定は名前のみ**）。
- `keywords` は **npm 非公開なら検索効果が薄い → 省略可**（入れても害はない）。今回は省略する。

### A-3. CI（新規 `.github/workflows/ci.yml`）

- トリガー: `push` / `pull_request`（branch 制限なし or main 中心）。
- Node 22、yarn 1（リポジトリは yarn 1.22）。手順:
  `checkout@v4` → `setup-node@v4`(node 22, cache: yarn) → `yarn install --frozen-lockfile`
  → `yarn typecheck` → `yarn lint` → `yarn test` → `yarn build`。
- 単一 job で直列。OS は ubuntu-latest。

---

## B. README オンボーディング（`README.md`）

「他人が clone して使い始める」導線を独立セクションで追加（既存の開発者向け記述の前に）。

### 追加セクション案: `## Install & use in MulmoClaude`

1. 前提: MulmoClaude を別途 clone 済み、Node 20+/yarn。
2. このプラグインを clone → `yarn install && yarn build`。
3. dev-plugin としてロード:
   - 推奨: 同梱の `./dev.sh`（`MULMO_DIR` を MulmoClaude の場所に。下記 D）。
   - or 手動: MulmoClaude 側で `MULMOCLAUDE_DEV_PLUGINS=/abs/path/to/research-memory-plugin yarn dev`。
4. Research ロール設置: `examples/research-role.json` を `~/mulmoclaude/config/roles/research.json` にコピー。
5. （任意）subagents: `examples/agents/` を `~/mulmoclaude/.claude/agents/` にコピー＋
   `~/mulmoclaude/config/settings.json` に `{ "extraAllowedTools": ["Task"] }`（既存 README 記述を参照）。
6. （任意）OpenAlex/Crossref への mailto 設定（下記 C）。
7. ブラウザで `http://localhost:5173/` → Research ロール選択。

既存の "Develop against MulmoClaude" 節は開発者向けとして残す（重複は導線へ集約）。

---

## C. mailto polite pool（OpenAlex / Crossref）

### C-1. 目的

公開ツールが公開 API を多数ユーザーで叩くため、`mailto` で名乗り polite pool に入る
（throttle 回避・行儀）。OpenAlex も Crossref も **`mailto` クエリパラメータ**で対応可
（ヘッダ不要 = runtime fetch のまま）。arXiv は mailto 非対応のため対象外。

**優先度: 任意（安いので入れる）。** polite pool が効くのは大量アクセス時で、1 ユーザーの
散発的な検索なら common pool でも実用上困らない（OpenAlex の 429 は既に検知済み）。
動作可否は変わらず、行儀＋わずかな安定性のための施策。未設定なら挙動は完全に従来通り。

### C-2. 設定ソース

環境変数 **`RESEARCH_MEMORY_MAILTO`**（email）。`index.ts` 冒頭で 1 回読む:

```ts
const MAILTO = process.env.RESEARCH_MEMORY_MAILTO?.trim() || undefined;
```

- 未設定なら一切付与しない（パラメータごと省略）。`process` は node グローバルで eslint 制約外。

### C-3. スレッディング

- `src/papersearch.ts`
  - `SearchOptions` に `mailto?: string` を追加。
  - `buildWorksUrl(query, opts, sourceId)`: `opts.mailto` があれば `mailto` を URL に付与。
  - `resolveVenueSourceId(venue, fetchImpl)`: シグネチャに `mailto?` を足し、/sources URL にも付与
    （または opts を渡す形に）。
  - `searchOpenAlex` は `opts` をそのまま流すので、`opts.mailto` 経由で両 URL に伝播。
- `src/metadata.ts`
  - `fetchDoi(doi, fetchImpl, mailto?)`: Crossref URL に `?mailto=<email>` を付与。
  - `fetchArxiv` は対象外（arXiv）。
- `src/index.ts`
  - `searchPapers` の opts に `mailto: MAILTO` を追加。
  - `fetchMetadata` の DOI 分岐で `fetchDoi(args.doi, fetch, MAILTO)`。

### C-4. URL 付与の実装方針

- OpenAlex: 既存のクエリ組み立て（`per-page`/`select`/`filter`）に `mailto` キーを追加。
- Crossref: `https://api.crossref.org/works/{doi}` に `?mailto=` を付ける
  （既存にクエリが無いので単純付与）。
- 空文字は付けない（`MAILTO` が undefined のときはキー自体を出さない）。

### C-5. テスト（純粋・URL 組み立て）

- `buildWorksUrl`: `mailto` 設定時に `mailto=<email>` を含む / 未設定時は含まない。
- Crossref URL（`fetchDoi` 内 or 抽出した URL ビルダ）: `mailto` 付与の有無。
  - 付与ロジックを小さな純粋関数に切り出すとテストしやすい（例 `withMailto(url, mailto)`）。

---

## D. dev.sh の可搬化（`dev.sh`）

現状 `MULMO_DIR="${MULMO_DIR:-$HOME/Prog/110_agents/mulmoclaude}"`（著者 path が既定）。

- **MULMO_DIR の存在チェック**: 無ければ「`MULMO_DIR=/path/to/mulmoclaude ./dev.sh` で指定して」と
  明示エラーで終了（暗黙に著者 path を使わせない）。
- **`RESEARCH_MEMORY_MAILTO` を forward**: 最終行の `exec env ... yarn dev` に
  `RESEARCH_MEMORY_MAILTO="${RESEARCH_MEMORY_MAILTO:-}"` を渡す（C と連動）。
- README（B）に `MULMO_DIR` / `RESEARCH_MEMORY_MAILTO` の指定方法を明記。
- 既定 path は残しても良いが、存在チェックで他環境でも安全に。

---

## 変更ファイル一覧

- 新規: `LICENSE`、`.github/workflows/ci.yml`
- `package.json` — メタデータ追加
- `README.md` — オンボーディング節
- `src/papersearch.ts` — `SearchOptions.mailto`、`buildWorksUrl` / `resolveVenueSourceId` 付与
- `src/metadata.ts` — `fetchDoi` に `mailto?`
- `src/index.ts` — `MAILTO` 読取 ＋ searchPapers / fetchMetadata へ伝播
- `dev.sh` — 存在チェック ＋ mailto forward
- `test/papersearch.test.ts`（追記）/ 必要なら `test/metadata.test.ts` — mailto URL テスト

## 検証

1. `yarn typecheck && yarn lint && yarn test && yarn build`（全緑）。
2. `RESEARCH_MEMORY_MAILTO` 未設定で従来通り（mailto なし URL）を test で確認。
3. CI: ローカルで `act` までは不要。push 後 GitHub Actions が緑になることを確認。
4. README 手順を別環境想定で読み返し、抜けが無いか確認。
5. `MULMO_DIR` 未設定で `./dev.sh` がエラー終了することを確認。

## 留意

- mailto を入れても **未設定なら挙動は完全に従来通り**（既存 132+ テストに非破壊）。
- npm publish はしない方針（GitHub 配布）。`files`/`exports` は据え置きで可。
- 公開リポジトリに秘密情報なし（カード等のユーザーデータは `~/mulmoclaude` 側で repo 外）。

---

## 実装プラン（順序・コード・検証ゲート）

`main` 上で作業。コミットはユーザー指示まで保留。コードを伴う C を中心にゲートを置く。

### Step 1 — LICENSE（新規 `LICENSE`）

MIT 全文、`Copyright (c) 2026 Yasuo Tabei`。

### Step 2 — package.json メタデータ

`"license": "MIT"` の近くに追記（keywords は入れない）:

```jsonc
"author": "Yasuo Tabei",
"repository": { "type": "git", "url": "git+https://github.com/tb-yasu/research-memory-plugin.git" },
"homepage": "https://github.com/tb-yasu/research-memory-plugin#readme",
"bugs": { "url": "https://github.com/tb-yasu/research-memory-plugin/issues" },
```

### Step 3 — CI（新規 `.github/workflows/ci.yml`）

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: yarn }
      - run: yarn install --frozen-lockfile
      - run: yarn typecheck
      - run: yarn lint
      - run: yarn test
      - run: yarn build
```

### Step 4 — mailto 付与ヘルパー（`src/metadata.ts`、純粋・export）

`fetchDoi` の近くに追加（papersearch からも import する）:

```ts
/** URL に mailto クエリを付与（polite pool）。空/未指定なら無変更。 */
export function withMailto(url: string, mailto: string | undefined): string {
  if (!mailto) return url;
  return url + (url.includes("?") ? "&" : "?") + "mailto=" + encodeURIComponent(mailto);
}
```

### Step 5 — Crossref に mailto（`src/metadata.ts` `fetchDoi`）

- シグネチャ: `fetchDoi(doi: string, fetchImpl: FetchFn, mailto?: string)`。
- リクエスト URL を `withMailto(<crossref works url>, mailto)` に通す。`fetchArxiv` は対象外。

### Step 6 — OpenAlex に mailto（`src/papersearch.ts`）

- `import { ..., withMailto } from "./metadata";`
- `SearchOptions` に `mailto?: string;` を追加。
- `buildWorksUrl(query, opts, sourceId)`: 最終 URL を `withMailto(url, opts.mailto)` に通す。
- `resolveVenueSourceId(venue, fetchImpl, mailto?)`: 引数追加、/sources URL を `withMailto(url, mailto)`。
- `searchOpenAlex`: `resolveVenueSourceId(opts.venue, fetchImpl, opts.mailto)` を渡す
  （`buildWorksUrl` は opts 経由で自動）。

### Step 7 — 配線（`src/index.ts`）

- モジュール冒頭（他 const 付近）:
  ```ts
  const MAILTO = process.env.RESEARCH_MEMORY_MAILTO?.trim() || undefined;
  ```
- `searchPapers` の opts に `mailto: MAILTO` を追加。
- `fetchMetadata` の DOI 分岐: `fetchDoi(args.doi as string, fetch, MAILTO)`。

### Step 8 — テスト（`test/papersearch.test.ts` 追記、+ 任意で metadata）

- `withMailto`: mailto 有→`mailto=` を含む（`?`/`&` 分岐）/ 無→無変更 / encode 確認。
- `buildWorksUrl`: `opts.mailto` 有で `mailto=<enc>` を含む / 無で含まない。

### ✅ ゲート（コード確定）

`yarn typecheck && yarn lint && yarn test && yarn build` 全緑。mailto 未設定で従来 URL 不変を確認。

### Step 9 — dev.sh 可搬化（`dev.sh`）

- `MULMO_DIR` 算出直後に存在チェック → 無ければ明示エラーで `exit 1`:
  ```sh
  if [ ! -d "$MULMO_DIR" ]; then
    echo "✗ MULMO_DIR not found: $MULMO_DIR" >&2
    echo "  set it:  MULMO_DIR=/path/to/mulmoclaude ./dev.sh" >&2
    exit 1
  fi
  ```
- 最終行に mailto を forward:
  ```sh
  exec env DISABLE_SANDBOX=1 MULMOCLAUDE_DEV_PLUGINS="$PLUGIN_DIR" \
    RESEARCH_MEMORY_MAILTO="${RESEARCH_MEMORY_MAILTO:-}" yarn dev
  ```

### Step 10 — README オンボーディング（`README.md`）

§B の `## Install & use in MulmoClaude` 節を追加（clone→build→dev-plugin→Research ロール→
任意 subagents / mailto→:5173）。`MULMO_DIR` / `RESEARCH_MEMORY_MAILTO` の指定法も明記。
「対応範囲: 全文取得は arXiv HTML のみ」を限界として 1 行記載。

### 検証（手動）

- `MULMO_DIR=/wrong ./dev.sh` がエラー終了。
- `RESEARCH_MEMORY_MAILTO=you@example.com` 設定時、searchPapers のログ/挙動が従来通り
  （429 が出にくくなる方向）であること。未設定で完全従来動作。

### 影響範囲

- C 以外（LICENSE/metadata/CI/dev.sh/README）はロジック非変更。
- C は mailto 未設定で完全に従来通り → 既存 140 テスト非破壊。想定 140 → 約 144。

