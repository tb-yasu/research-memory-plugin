# Research Memory

[English](README.md) | 日本語

*研究につながるメモリ* のための [MulmoClaude](https://github.com/receptron/mulmoclaude) ランタイムプラグイン。**現在の対象は文献** — 読んだ論文を、要約ではなく「関係づけて検索できるストア」にします。長期的には spine（関係の背骨）を研究状態モデル（Claim / Evidence / Decision / Context）へ一般化する構想です（[ロードマップ](#ロードマップ)参照）。

> 論文を読んで要約するのは簡単で、もはやコモディティです。難しいのは数か月後に「この論文が自分の研究にどう関係するか」「どこで再利用できるか」を思い出すこと。このプラグインはまさにそれを記録し、あなた（と LLM）が検索できるようにします。

各論文は **Paper Card** として保存します。論文自体の内容（要約・主張・手法・限界）に加えて、Zotero/Notion にはない **relational spine（関係の背骨）** を持ちます。

- **自分の研究との関係** — 競合 / 関連 / 着想元 / 対比 を具体的に。
- **引用目的** — 何のために、どの節（Related Work, Method, …）で引用するか。
- **再利用できる考え方** — 借用できるテクニック。
- **次にやること** — 読むべき論文、試す実験。
- **テーマ** — 研究の筋。フィルタ・引用表・Related Work のグループ化に使う。

## できること

- **チャットから登録** — abstract を貼るか `arXiv:2401.12345` / `DOI:10.xxxx/yyyy` と言うだけ。プラグインが arXiv / Crossref からメタデータ（タイトル・著者・年・発表先・abstract・URL）を自動取得し、LLM があなたの研究フォーカスに沿って relational spine を付けます。
- **テーマで論文を探す** — 「2024年以降の Agentic Memory の論文を探して」で OpenAlex + arXiv を検索（マージ＆重複排除。年範囲、ソースごと最大100件、venue 任意）。登録済みの候補には印を付け、選んだものだけ登録します。
- **登録時に全文を読む** — arXiv id のある候補は本文を取得し（arxiv.org/html、無ければ ar5iv にフォールバック。references 除去・中間省略）、abstract の丸写しではなく落合フォーマットのフル抽出にします。任意の `paper-reader` subagent（`examples/agents/`）を使うと、各論文を使い捨てコンテキストで並列に読み、チャットを膨らませません。
- **選んだ論文から次の研究アイデア** — 「さっき登録した3本から次の研究アイデアを出して」。プラグインが素材（限界・手法・再利用案・あなたの関係メモ＋研究プロフィール）を集め、任意の `idea-miner` subagent が各論文の本文からカードに無い燃料（脆い仮定・future-work のヒント）を採掘し、LLM が根拠付きで 3〜5 案を合成します。良い案は Idea レコード（`ideas/<slug>.json`、出典論文にリンク、raw → exploring → adopted/dropped のライフサイクル）として保存。論文は **canvas 一覧のチェックボックス**でも選べます（選択はサーバー側に永続化され、チャットで「選択した論文からアイデアを出して」で拾います。View のボタンは LLM を起動できません — プラグイン runtime にチャット注入 API が無いため）。テーマ全体の選択はまず確認ステップが入り、チェックボックス/slug 指定は即実行します。
- **アイデア生成エンジンの切替 — Claude / Codex** — canvas パネルに *Idea engine* スイッチがあります。**Claude**（既定）はこれまで通りホストがチャットで合成します。**Codex** はプラグインが `codex` CLI を起動し（`codex exec`、prompt は stdin、sandbox は read-only）、完成済みのアイデアを返します。**モデル**（編集可、候補はドロップダウン）と**思考力**（low / medium / high、`model_reasoning_effort` に対応）も選べます。選択は `engine-config.json` に永続化され、以後の `ideate` 全てに適用されます。**`codex` CLI のインストールと `codex login` が必要です。** 使えるモデルは codex の認証方式次第で、**ChatGPT アカウント**ログインは codex 既定（codex 0.139 時点で **gpt-5.5**）のみ、**OpenAI API キー**なら gpt-5-codex / gpt-5 / o3 / o4-mini が使えます — 自分のアカウントで使えるものを入力してください。（`minimal` 思考力は意図的に除外。codex 既定の web_search / image_gen ツールが minimal では拒否されるため。）Codex 経路は集めたカード素材のみを使い、`idea-miner` の全文採掘は走りません（Claude 限定）。
- **検索＆フィルタ** — 全文検索・テーマフィルタ・*○年以降* フィルタを corpus 全体に（プラグイン内で決定的に）。
- **引用表** — テーマごとに「どの論文を、何のために、どの節で引用するか」の表。そのまま Related Work に使えます。
- **Related Work アウトライン** — 引用表の一歩先。「Generate a Related Work outline for theme: Agentic Memory」と頼むと、返信そのものがアウトライン markdown になります — 論文グループ（共起テーマ別）、各グループの論点（あなたの *自分の研究との関係* メモ）、各論文の要点（新規性/要約）と引用目的。抽出・グループ化・順序はプラグイン内で決定的です。LLM は bullet を散文に整えるだけ（カード内容に基づき、並べ替えや捏造はしません）。引用目的が無い論文には印が付き、執筆前に埋められます。各呼び出しで markdown を `related-work/<theme-slug>.md`（テーマごと1ファイル、毎回上書き）にも保存します — ファイルが正なので、後の「保存して/これを下敷きに書いて」はそのファイルを読みます。
- **読みやすいカードのミラー＋wiki リンク** — 保存したカードは毎回 `papers/<slug>.md`（落合テンプレ＋relational spine）にミラーされます。wiki ページ（やワークスペースリンクが描画される場所）からは `[Title](data/plugins/research-memory-plugin/papers/<slug>.md)` でリンクすると、生 JSON ではなく整形 Markdown で開きます。JSON が正、`.md` は人間用ビューです。
- **エクスポート** — BibTeX、番号付き参考文献リスト、markdown バンドル、Excel ワークブック。
- **研究プロフィール** — 現在のフォーカス・テーマ・問いを記録。LLM が各論文の *自分の研究との関係* と *引用目的* を grounding するのに使います。
- **重複検出＋マージ** — 同じ論文（DOI / arXiv id / 酷似タイトル）を再登録しようとすると保存をブロックし、*merge* / *overwrite* / *skip* を提示します。merge は配列を union し relational spine を保持 — LLM が数か月前のメモを黙って上書きしません。
- **手動で追加/編集** — canvas のフォーム。LLM なしでも完全に使えます。

## 仕組み（設計）

MulmoClaude のアーキテクチャに従います — *API/ロジックが製品で、GUI も LLM もそのクライアント*:

- **プラグイン（TypeScript）が決定的ロジックを全て持つ** — スキーマ＆検証、ストレージ（`files.data` 下に論文1件 = 1 JSON）、検索/ランキング、引用表、Related Work アウトライン、BibTeX/参考文献/markdown エクスポート。純粋でユニットテスト済みのモジュール（`card.ts`, `search.ts`, `citation.ts`, `relatedwork.ts`）。
- **チャット LLM は自然言語抽出のみ** — 貼られた abstract を構造化カードフィールドに変換するだけ。その指示はコードではなくワークスペースの **role prompt** にあります。

つまり「知能」は LLM、プラグインは実 UI を備えた、信頼でき・テストできるストアです。

| モジュール | 役割 |
|---|---|
| `src/card.ts` | `PaperCard` スキーマ、JSON (de)serialize、slug 規則、partial-merge、重複検出 + 2カード `mergeFull` |
| `src/search.ts` | `filterCards` / `rankCards` / `sortCards`（キーワード + 新着 + ○年以降） |
| `src/citation.ts` | `citationTable`, `toBibTeX`, `toReferenceList`, `toMarkdownBundle` |
| `src/relatedwork.ts` | `buildRelatedWorkOutline`（共起テーマでグループ化、年代順、論点、引用目的のランク付け、ギャップ検出）+ `relatedWorkToMarkdown` |
| `src/profile.ts` | `ResearchProfile` の読み書き（フォーカス / テーマ / 問い） |
| `src/metadata.ts` | arXiv Atom + Crossref/DOI パーサ。LLM が `save` に渡す `MetadataPatch` を返す |
| `src/papersearch.ts` | OpenAlex + arXiv 検索（関連度、年範囲、venue→source id、limit クランプ、gist 切詰め）、候補のマージ/重複排除、登録済みカードの注記 |
| `src/fulltext.ts` | arXiv HTML / ar5iv 全文取得（markup 除去、references 切除、中間省略）— 落合フル抽出用 |
| `src/idea.ts` | `Idea` スキーマ（description / motivation / firstExperiment / sourcePapers / status ライフサイクル）、JSON (de)serialize、partial-merge |
| `src/ideate.ts` | `gatherIdeationMaterial` — カード単位の ideation 燃料 + プロフィール + 共起テーマ + thin-card 検出（決定的。ideation 自体は LLM） |
| `src/engine.ts` | `EngineConfig`（engine claude/codex + Codex モデル + 思考力）の読み書き/merge — ideation エンジンの切替 |
| `src/codex.ts` | Codex CLI ブリッジ: `buildCodexArgs` / `buildCodexIdeationPrompt` / `runCodex`（`codex exec`、prompt は stdin、spawn はテスト用に注入） |
| `src/excel.ts` | Excel エクスポート用の XLSX ワークブック |
| `src/index.ts` | `definePlugin` ファクトリ: CRUD + list/search + citationTable + relatedWork + export + profile + fetchMetadata/searchPapers/fetchFullText + ideate（Claude または Codex エンジン）+ idea CRUD + 競合考慮の save/mergePapers |
| `src/View.vue` | browse（一覧 + 詳細 + テーマ/年フィルタ + 検索）、引用表モード、Related Work アウトラインモード、export、追加/編集フォーム、プロフィール編集、競合リゾルバ |

MCP ツールは `manageLiterature`（kind: `list`, `read`, `save`, `update`, `delete`, `citationTable`, `relatedWork`, `export`, `getProfile`, `setProfile`, `fetchMetadata`, `mergePapers`, `searchPapers`, `fetchFullText`, `ideate`, `saveIdea`, `listIdeas`, `updateIdea`, `deleteIdea`, `setSelection`, `getSelection`, `getEngineConfig`, `setEngineConfig`）。

### 任意の subagents（コンテキストを膨らませない並列読み）

[`examples/agents/`](examples/agents/) に Claude Code subagent の定義が2つあります: `paper-reader`（論文1件を登録: 本文取得 → 落合カード）と `idea-miner`（論文1件の本文からアイデアの燃料を採掘）。MulmoClaude で有効化するには:

1. `~/mulmoclaude/.claude/agents/` にコピー。
2. Task tool を許可: `~/mulmoclaude/config/settings.json` → `{ "extraAllowedTools": ["Task"] }`。

無くても全機能は動きます — inline の `fetchFullText` / カードのみの ideation にフォールバックします。

## MulmoClaude での導入と利用

プラグインを *使う* だけの手順（改造ではなく）。[MulmoClaude](https://github.com/receptron/mulmoclaude) が clone 済みで動く状態、Node 20+ と yarn を前提とします。

1. **このプラグインを clone & build:**

   ```bash
   git clone https://github.com/tb-yasu/research-memory-plugin.git
   cd research-memory-plugin
   yarn install && yarn build
   ```

2. **dev plugin としてロード。** 同梱の `./dev.sh` が簡単です。stale な MulmoClaude スタックを kill し、このプラグインを載せた1本だけを起動します（sandbox off なので agent がワークスペースの論文を見られます）。`MULMO_DIR` を MulmoClaude の場所に向けてください:

   ```bash
   MULMO_DIR=/abs/path/to/mulmoclaude ./dev.sh
   ```

   `dev.sh` は `MULMO_DIR` が存在しないとエラー終了し、他人の path に黙ってフォールバックしません。手で配線したい場合は env 変数で直接:

   ```bash
   MULMOCLAUDE_DEV_PLUGINS=/abs/path/to/research-memory-plugin yarn dev   # mulmoclaude リポジトリ内で
   ```

3. **Research ロールを追加。** [`examples/research-role.json`](examples/research-role.json) を `~/mulmoclaude/config/roles/research.json` にコピーします（その `prompt` が LLM に Paper Card の抽出を教えます）。ロールが出てこなければ、アプリ内の `/roles` UI から作り直してください。

4. **(任意) Subagents** — コンテキストを膨らませず並列に論文を読むため、[`examples/agents/`](examples/agents/) を `~/mulmoclaude/.claude/agents/` にコピーし、`~/mulmoclaude/config/settings.json` → `{ "extraAllowedTools": ["Task"] }` で Task tool を許可します。下の [任意の subagents](#任意の-subagentsコンテキストを膨らませない並列読み) も参照。

5. **(任意) Polite pool。** `RESEARCH_MEMORY_MAILTO=you@example.com` を設定すると OpenAlex / Crossref に自分を名乗ります（両者の [polite pool](https://docs.openalex.org/how-to-use-the-api/rate-limits-and-authentication#the-polite-pool) — 負荷時の throttle が穏当になります）。未設定なら従来通りの挙動です。`dev.sh` はこの env 変数を MulmoClaude へ forward します:

   ```bash
   RESEARCH_MEMORY_MAILTO=you@example.com MULMO_DIR=/abs/path/to/mulmoclaude ./dev.sh
   ```

6. <http://localhost:5173/> を開き **Research** ロールを選択。

> 登録時の全文取得は **arXiv（HTML）のみ**対応です。他ソースはメタデータの abstract にフォールバックします。

## MulmoClaude に対して開発する

```bash
yarn install
yarn build            # dist/index.js + dist/vue.js を生成（ロード前に必須）
```

その後 dev plugin としてロード（ターミナル2枚）:

```bash
# ターミナル A — 保存のたびに dist/ を最新に保つ
yarn dev              # vite build --watch

# ターミナル B — このプラグインを載せて MulmoClaude を起動
mulmoclaude --dev-plugin /ABS/PATH/TO/research-memory-plugin
```

公開ランチャーではなく **ソースチェックアウトから** MulmoClaude を動かす場合は、ランチャーが `MULMOCLAUDE_DEV_PLUGINS` を設定しているだけなので、等価なのは:

```bash
MULMOCLAUDE_DEV_PLUGINS=/ABS/PATH/TO/research-memory-plugin yarn dev   # mulmoclaude リポジトリ内で
```

### ツールを呼べるようにする（必須）

ランタイムプラグインのツールは、ロールの `availablePlugins` でゲートされています。`~/mulmoclaude/config/roles/research.json` に `manageLiterature` を許可するロールを追加してください（既製のものが [`examples/research-role.json`](examples/research-role.json) にあり、その `prompt` が LLM に Paper Card の抽出を教えます）。ロールが現れなければ、アプリ内 `/roles` UI から同じロールを作成。その後チャットで **Research** ロールを選びます。

### デモデータの投入

```bash
mkdir -p ~/mulmoclaude/data/plugins/research-memory-plugin/papers
cp examples/papers/*.json ~/mulmoclaude/data/plugins/research-memory-plugin/papers/
cp examples/profile.json  ~/mulmoclaude/data/plugins/research-memory-plugin/profile.json
```

*Agentic Memory*・*Counterfactual Recourse*・*Compressed Indexing* にまたがるサンプルカード7枚で、検索 / テーマフィルタ / 引用表 / Related Work アウトライン / エクスポートがすぐ動きます。さらに記入済みの研究プロフィールも入るので、*自分の研究との関係* フィールドが最初から grounding されます。（*Agentic Memory* の2枚は共起テーマ — *Memory Architecture* / *Memory Retrieval* — を持ち、これが Related Work アウトラインのグループ化軸になります。）

## デモ（一連の流れ）

1. **識別子で登録** — Research ロール → 「`arXiv:2504.19482` を登録して」→ fetchMetadata がタイトル / 著者 / 年 / 発表先 / abstract / URL を埋め、LLM がプロフィールから relational spine を付けます。
2. **abstract で登録** — 「この論文を私の Agentic Memory 文脈で登録して: \<abstract\>」→ arXiv id も DOI も無いとき同じ結果に。
3. **検索** — 「recourse cost で自分の論文を検索して」。
4. **引用表** — 「Agentic Memory の引用表を出して」。
5. **Related Work アウトライン** — 「Generate a Related Work outline for theme: Agentic Memory」→ チャット返信がアウトライン markdown（論文グループ / 論点 / 要点 / 引用目的、ギャップに印）を描画し、パネルにも同じ骨格が出ます。続けて「このアウトラインを下敷きに Related Work 本文を書いて」と頼むと、LLM が並べ替えずにその上で書きます。
6. **エクスポート** — 「Compressed Indexing テーマの BibTeX を出して」。
7. **黙った上書きを防ぐ** — 同じ論文を再登録しようとする → 競合パネルが *merge* / *overwrite* / *skip* を表示。*merge* を選べば relational spine が残ります。

## テスト

```bash
yarn test     # tsx --test: カードスキーマ、検索/ランキング、引用/BibTeX、Related Work アウトラインのグループ化、プロフィール読み書き、Excel エクスポート、arXiv/Crossref パーサ、重複検出 + 2カードマージ、fixtures、end-to-end のハンドラ往復
```

## ロードマップ

これは *捕捉（capture）* の入り口です。長期的には relational spine を研究状態モデル — **Claim / Evidence / Decision / Context** — へ一般化し、論文だけでなく研究上の判断（「なぜこのデータセットを捨てたか」）、リバッタル支援（どの結果が査読者に答えるか）、プロジェクト再開（「どこまでやったか」）まで支えることを目指します。近い将来: テーマ/引用グラフ、メタデータソースの追加（DBLP, Semantic Scholar）と引用グラフデータ、soft-duplicate 警告のための近傍一致ヒューリスティックの強化。

## ライセンス

MIT
