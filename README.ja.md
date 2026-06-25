# Paper Memory

[English](README.md) | 日本語

Paper Memory は、読んだ論文を「後で研究に再利用できる形」で保存する [MulmoClaude](https://github.com/receptron/mulmoclaude) プラグインです。

単なる要約ではなく、その論文が *自分の研究にどう関係するか*、どこで引用できるか、どのアイデアを再利用できるか、次に何をすべきかを記録します。目的はシンプルで、数か月後に「この論文は何を言っていたか」だけでなく「なぜ重要だったのか」「今の研究にどう使えるのか」を思い出せるようにすることです。

## クイックスタート

プラグインを *使う* ための手順です。[MulmoClaude](https://github.com/receptron/mulmoclaude) が clone 済みで動く状態（Node 20+ / yarn）を前提とします。

1. **プラグインを clone & build:**

   ```bash
   git clone https://github.com/tb-yasu/paper-memory.git
   cd paper-memory
   yarn install && yarn build
   ```

2. **Research ロールを設置**（起動前に置くと MulmoClaude が確実に拾います）: [`examples/research-role.json`](examples/research-role.json) を `~/mulmoclaude/config/roles/research.json` にコピー。このロールがツールを許可し、LLM に Paper Card の抽出を教えます。

3. **プラグインを載せた MulmoClaude を起動。** 推奨は同梱の `./dev.sh`。`MULMO_DIR` を MulmoClaude の場所に向けます:

   ```bash
   MULMO_DIR=/abs/path/to/mulmoclaude ./dev.sh
   ```

4. **<http://localhost:5173/> を開き** **Research** ロールを選択。

abstract を貼るか「`arXiv:2504.19482` を登録して」と言えば、最初のカードができます。（手動セットアップやコントリビュータ向けは [開発](#開発) を参照。）

## 機能

- arXiv ID / DOI / 貼り付けた abstract から論文を登録 — メタデータは arXiv / Crossref から自動取得。
- 各論文を構造化された **Paper Card** として保存し、研究メモ（関係・引用目的・再利用アイデア・次にやること・テーマ）を付与。
- **OpenAlex + arXiv** をまたいでテーマで論文を探し、選んだものだけ登録。
- キーワード・テーマ・年でライブラリを検索/フィルタ。
- テーマごとに **引用表** と **Related Work アウトライン** を生成。
- 選んだ論文から、根拠付きの **次の研究アイデア** を生成（Claude または Codex）。
- BibTeX / 参考文献リスト / Markdown / Excel にエクスポート。
- 重複を検出し、数か月前のメモを壊さずにレコードをマージ。
- 各カードを読みやすい Markdown（`papers/<slug>.md`）にミラーし、wiki から参照可能に。
- canvas のフォームで手動追加/編集 — LLM なしでも完全に使えます。

## 中核となる概念

- **Paper Card** — 論文1件 = 1 JSON レコード。論文自体の内容（要約・主張・手法・限界）に、あなたのメモを加えたもの。落合フォーマット風の構造化読解メモとして保存します。
- **relational spine（関係の背骨）** — Paper Memory は、論文が *何を言っているか* だけでなく、*自分の研究にどう関係するか* も保存します。この関係の層を relational spine と呼びます — 自分の研究との関係・引用目的・再利用アイデア・次にやること・テーマ。一般的な文献管理ツールでは構造化して残しにくい部分です。
- **研究プロフィール** — 現在のフォーカス・テーマ・問い。LLM が各カードの *自分の研究との関係* と *引用目的* を grounding するのに使います。

## 使用例

**Research** ロールで:

1. **識別子で登録** — 「`arXiv:2504.19482` を登録して」→ メタデータを取得し、LLM がプロフィールから relational spine を付与。
2. **abstract で登録** — 「この論文を私の Agentic Memory 文脈で登録して: \<abstract\>」（arXiv id も DOI も無いとき）。
3. **論文を探す** — 「2024年以降の Agentic Memory の論文を探して」→ 登録するものを選択。
4. **引用表** — 「Agentic Memory の引用表を出して」。
5. **Related Work アウトライン** — 「Generate a Related Work outline for theme: Agentic Memory」→ 返信そのものがアウトライン。続けて「このアウトラインを下敷きに Related Work 本文を書いて」。
6. **エクスポート** — 「Compressed Indexing テーマの BibTeX を出して」。

これらをすぐ試すためのサンプルデータ投入は [デモデータの投入](#デモデータの投入) を参照。

## 高度な使い方

### 登録時の全文読み込み

arXiv id のある候補は本文を取得し（arxiv.org/html、無ければ ar5iv にフォールバック。references 除去・中間省略）、abstract の丸写しではなく構造化されたフル抽出にします。

### Subagents（任意）

[`examples/agents/`](examples/agents/) に Claude Code subagent の定義が2つあります: `paper-reader`（論文1件を登録: 本文取得 → フルカード）と `idea-miner`（論文1件の本文からアイデアの燃料を採掘）。各論文を使い捨てコンテキストで並列に読み、チャットを膨らませません。有効化:

1. [`examples/agents/`](examples/agents/) を `~/mulmoclaude/.claude/agents/` にコピー。
2. Task tool を許可: `~/mulmoclaude/config/settings.json` → `{ "extraAllowedTools": ["Task"] }`。

無くても全機能は動きます — inline の全文取得 / カードのみの ideation にフォールバックします。

### アイデア生成エンジン: Claude または Codex

canvas パネルに *Idea engine* スイッチがあります。**Claude**（既定）はホストがチャットで合成。**Codex** はプラグインが `codex` CLI を起動し（`codex exec`、prompt は stdin、sandbox は read-only）、完成済みのアイデアを返します。モデルと思考力（low / medium / high）も選べます。選択は `engine-config.json` に永続化されます。

Codex には `codex` CLI のインストールと `codex login` が必要です。使えるモデルは認証方式（と Codex CLI のバージョン）に依存します。**ChatGPT アカウント**ログインは codex 既定のモデルのみ、**OpenAI API キー**なら全モデル（`gpt-5-codex` / `gpt-5` / `o` 系 など）が使えます。Codex 経路は集めたカード素材のみを使います（`idea-miner` subagent は走りません）。

## 設定

- **`MULMO_DIR`** — MulmoClaude チェックアウトの場所（`dev.sh` が使用）。
- **`RESEARCH_MEMORY_MAILTO`** — 自分の email を設定すると OpenAlex / Crossref の [polite pool](https://docs.openalex.org/how-to-use-the-api/rate-limits-and-authentication#the-polite-pool) に入れます（負荷時の throttle が穏当に）。未設定なら挙動は変わりません。`dev.sh` が forward します:

  ```bash
  RESEARCH_MEMORY_MAILTO=you@example.com MULMO_DIR=/abs/path/to/mulmoclaude ./dev.sh
  ```

## 制約

- 全文取得は **arXiv（HTML）のみ**対応。他ソースはメタデータの abstract にフォールバックします。
- Codex によるアイデア生成は Codex CLI と `codex login` が必要で、使えるモデルは認証方式に依存します。
- canvas の View からホスト LLM を直接起動できません — 選択した論文はサーバー側に永続化され、チャットの一言で拾います（プラグイン runtime にチャット注入 API が無いため）。
- OpenAlex の会議 venue 連携は不完全です。topic + 年を優先し、venue フィルタは絞り込みの補助としてのみ使ってください。

## 開発

プラグインを *改造する* ための手順です。

```bash
yarn install
yarn build            # dist/index.js + dist/vue.js を生成（ロード前に必須）
```

dev plugin としてロード（ターミナル2枚）:

```bash
# ターミナル A — 保存のたびに dist/ を最新に保つ
yarn dev              # vite build --watch

# ターミナル B — このプラグインを載せて MulmoClaude を起動
mulmoclaude --dev-plugin /ABS/PATH/TO/paper-memory
```

公開ランチャーではなくソースチェックアウトから MulmoClaude を動かす場合、ランチャーは `MULMOCLAUDE_DEV_PLUGINS` を設定しているだけなので、等価なのは:

```bash
MULMOCLAUDE_DEV_PLUGINS=/ABS/PATH/TO/paper-memory yarn dev   # mulmoclaude リポジトリ内で
```

### Research ロールの設定

プラグインのツールは、ロールの `availablePlugins` でゲートされています。[クイックスタート](#クイックスタート)を実施済みなら Research ロールは既に置かれています。そうでなければ [`examples/research-role.json`](examples/research-role.json) を `~/mulmoclaude/config/roles/research.json` にコピー（または `/roles` UI から作成）し、**Research** ロールを選択してください。

### デモデータの投入

```bash
mkdir -p ~/mulmoclaude/data/plugins/paper-memory/papers
cp examples/papers/*.json ~/mulmoclaude/data/plugins/paper-memory/papers/
cp examples/profile.json  ~/mulmoclaude/data/plugins/paper-memory/profile.json
```

*Agentic Memory*・*Counterfactual Recourse*・*Compressed Indexing* にまたがるサンプルカード7枚（＋記入済みプロフィール）。検索 / テーマフィルタ / 引用表 / Related Work アウトライン / エクスポートがすぐ動きます。

### テスト

```bash
yarn test     # tsx --test: スキーマ、検索/ランキング、引用/BibTeX、Related Work グループ化、
              # プロフィール読み書き、Excel エクスポート、arXiv/Crossref パーサ、重複検出 + 2カードマージ、
              # テーマ rename、カードの Markdown ミラー、end-to-end のハンドラ往復
```

## アーキテクチャ

Paper Memory は MulmoClaude のアーキテクチャに従います — *API/ロジックが製品で、GUI も LLM もそのクライアント*:

- **プラグイン（TypeScript）が再現性の必要なロジックを持つ** — スキーマ＆検証、ストレージ（`files.data` 下に論文1件 = 1 JSON）、検索/ランキング、引用表、Related Work アウトライン、エクスポート。検索・重複検出・エクスポートなど再現性が必要な処理は、LLM ではなくコード側で実行します。純粋でユニットテスト済みのモジュールです。
- **チャット LLM は自然言語抽出のみ** — 貼られた abstract を構造化カードフィールドに変換するだけ。その指示はコードではなくワークスペースの **role prompt** にあります。

| モジュール | 役割 |
|---|---|
| `src/card.ts` | `PaperCard` スキーマ、JSON (de)serialize、slug 規則、partial-merge、重複検出 + 2カード `mergeFull`、テーマ rename、Markdown ミラー |
| `src/search.ts` | `filterCards` / `rankCards` / `sortCards`（キーワード + 新着 + ○年以降） |
| `src/citation.ts` | `citationTable`, `toBibTeX`, `toReferenceList`, `toMarkdownBundle` |
| `src/relatedwork.ts` | `buildRelatedWorkOutline`（共起テーマでグループ化、年代順、論点、ギャップ検出）+ `relatedWorkToMarkdown` |
| `src/profile.ts` | `ResearchProfile` の読み書き |
| `src/metadata.ts` | arXiv Atom + Crossref/DOI パーサ、polite-pool の `mailto` ヘルパー |
| `src/papersearch.ts` | OpenAlex + arXiv 検索（関連度、年範囲、venue→source id、gist 切詰め）、候補のマージ/重複排除、登録済みカードの注記 |
| `src/fulltext.ts` | arXiv HTML / ar5iv 全文取得（markup 除去、references 切除、中間省略） |
| `src/idea.ts` / `src/ideate.ts` | `Idea` スキーマ、ideation 素材の収集（ideation 自体は LLM/Codex） |
| `src/engine.ts` / `src/codex.ts` | アイデアエンジン設定（Claude/Codex）+ Codex CLI ブリッジ |
| `src/excel.ts` | Excel エクスポート用 XLSX ワークブック |
| `src/index.ts` | 各操作を `files.data` に配線する `definePlugin` ファクトリ |
| `src/View.vue` | canvas UI（browse / 詳細 / 引用表 / Related Work / export / フォーム） |

### MCP ツール一覧

MCP ツールは `manageLiterature`。kind: `list`, `read`, `save`, `update`, `delete`, `renameTheme`, `citationTable`, `relatedWork`, `export`, `getProfile`, `setProfile`, `fetchMetadata`, `mergePapers`, `searchPapers`, `fetchFullText`, `ideate`, `saveIdea`, `listIdeas`, `updateIdea`, `deleteIdea`, `setSelection`, `getSelection`, `getEngineConfig`, `setEngineConfig`。

## ロードマップ

これは *捕捉（capture）* の入り口です。長期的には relational spine を研究状態モデル — **Claim / Evidence / Decision / Context** — へ一般化し、論文だけでなく研究上の判断（「なぜこのデータセットを捨てたか」）、リバッタル支援（どの結果が査読者に答えるか）、プロジェクト再開（「どこまでやったか」）まで支えることを目指します。近い将来: テーマ/引用グラフ、メタデータソースの追加（DBLP, Semantic Scholar）と引用グラフデータ、soft-duplicate 警告の近傍一致ヒューリスティック強化。

## ライセンス

MIT
