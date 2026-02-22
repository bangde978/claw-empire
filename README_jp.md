<p align="center">
  <img src="public/claw-empire.svg" width="80" alt="Claw-Empire" />
</p>

<h1 align="center">Claw-Empire</h1>

<p align="center">
  <strong>CEOデスクからAIエージェント帝国を指揮しよう</strong><br>
  <b>CLI</b>、<b>OAuth</b>、<b>API連携</b>プロバイダー（<b>Claude Code</b>、<b>Codex CLI</b>、<b>Gemini CLI</b>、<b>OpenCode</b>、<b>GitHub Copilot</b>、<b>Antigravity</b> など）を自律エージェントの仮想企業として統合運用するローカルファーストAIエージェントオフィスシミュレーター
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.1.5-blue" alt="Version" />
  <img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen" alt="Node.js 22+" />
  <img src="https://img.shields.io/badge/license-Apache%202.0-orange" alt="License" />
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey" alt="Platform" />
  <img src="https://img.shields.io/badge/AI-Claude%20%7C%20Codex%20%7C%20Gemini%20%7C%20OpenCode%20%7C%20Copilot%20%7C%20Antigravity-purple" alt="AI Agents" />
</p>

<p align="center">
  <a href="#クイックスタート">クイックスタート</a> &middot;
  <a href="#ai-installation-guide">AIインストール</a> &middot;
  <a href="docs/releases/v1.1.5.md">リリースノート</a> &middot;
  <a href="#openclaw-integration">OpenClaw連携</a> &middot;
  <a href="#dollar-command-logic">$ コマンド</a> &middot;
  <a href="#機能一覧">機能一覧</a> &middot;
  <a href="#スクリーンショット">スクリーンショット</a> &middot;
  <a href="#技術スタック">技術スタック</a> &middot;
  <a href="#cliプロバイダーの設定">プロバイダー</a> &middot;
  <a href="#セキュリティ">セキュリティ</a>
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README_ko.md">한국어</a> | <b>日本語</b> | <a href="README_zh.md">中文</a>
</p>

<p align="center">
  <img src="Sample_Img/Office.png" alt="Office View" width="100%" />
</p>

---

## Claw-Empireとは？

Claw-Empireは **CLI**、**OAuth**、**直接APIキー** で接続されたAIコーディングアシスタントを、完全にシミュレートされた**仮想ソフトウェア会社**へと変革します。あなたがCEOです。AIエージェントたちが社員として働きます。部署をまたいで協力し、会議を開き、タスクを完遂し、レベルアップしていく様子を、魅力的なピクセルアートのオフィスインターフェースを通じてリアルタイムに観察できます。

### なぜClaw-Empireなのか？

- **一つのインターフェースで複数のAIエージェントを管理** — CLI/OAuth/API接続エージェントを単一のダッシュボードから一元管理
- **ローカルファースト＆プライバシー保護** — すべてのデータはローカルに保存。SQLiteデータベースを使用し、クラウド依存ゼロ
- **直感的なビジュアル体験** — ピクセルアートのオフィスビューがAIオーケストレーションを楽しく、わかりやすく表現
- **真の自律コラボレーション** — エージェントは独立したgit worktreeで作業し、会議に参加して成果物を生み出す

---

## 最新リリース (v1.1.5)

- **プロジェクト名入力中心フロー** — `+ 新規タスク` のプロジェクト選択を、ドロップダウン専用からテキスト入力（`プロジェクト名`）+ クリック展開候補へ変更しました。
- **新規プロジェクト分岐 UX** — 一致プロジェクトがない場合、`新規プロジェクトとして作成しますか？` をインライン表示し、右端に高コントラストの `はい` ボタンを配置します。
- **プロジェクト作成とタスク作成を同時実行** — 新規プロジェクトモードでは送信時にプロジェクトとタスクを同時作成し、`説明` は必須でプロジェクト `core_goal` として保存されます。
- **新規プロジェクトパス入力ステップ** — 新規作成確定後に `project_path` 入力欄を表示し、検証後に作成処理へ進みます。
- **デスクトップ/モバイルのオーバーフロー対応** — デスクトップは 1:1 の2カラムへ拡張し、右側（`優先度`/`担当`）をアニメーション表示。モバイルは縦スクロールを維持してはみ出しを防止します。
- **下書き自動保存 + 復元サブモーダル** — モーダルを閉じると入力内容を自動保存し、`[一時(n)]` 一覧モーダルと統一スタイルの復元サブモーダルを追加しました。
- **復元候補を最大3件に制限** — 復元ポップアップは最新3件のみ表示し、ユーザーが適用する下書きを選択できます。
- **誤クローズ防止** — `+ 新規タスク` は外側クリックで閉じないようになり、長い入力やパス修正中のデータ消失を防ぎます。
- **プロジェクトパス検索ツール統合（タスク + プロジェクト管理）** — `自動パス検索`、`アプリ内フォルダ閲覧`、OS `手動パス選択` を追加し、同機能をプロジェクト管理の `プロジェクトパス` にも拡張しました（新規/編集モード時のみ表示）。
- **プロジェクトパスのガードレール + API 追加** — `path-check`、`path-suggestions`、`path-browse`、`path-native-picker` API と、パス正規化/未存在パス作成確認（`create_path_if_missing`）フローを導入しました。
- **パス補助の下位互換 + エラーUX統一** — 旧サーバーでパス補助APIが未提供（`404`）でも手入力へ自然にフォールバックし、タスク作成のパスエラーは `alert/confirm` ではなくモーダル内フィードバック/サブモーダルで表示します。
- **ヘッドレス環境のネイティブピッカー対応** — OSフォルダ選択を開けない環境では `手動パス選択` の利用不可状態を明示し、代替導線を案内します。
- **重複パス/許可ルートの強制検証** — プロジェクト作成・更新・パス検証で `project_path_conflict`（重複）と `project_path_outside_allowed_roots`（許可ルート外）を一貫して拒否します。
- **Task API のプロジェクトマッピング強化** — タスク作成で `project_id`/`project_path` を送信し、バックエンドは `project_id` がない場合に `project_path` からプロジェクトを解決します。
- **CLI spawn ENOENT 安定化** — プロバイダー起動前にOS別 fallback bin パスを `PATH` へ補完し、`spawn codex/claude ENOENT` の発生を抑制します。
- **プロジェクト単位 Worktree 強制（オーケストレーション経路）** — オーケストレーション実行でも worktree 作成と `agentCwd` 実行（`worktreePath || projectPath`）を復元し、Claude worktree では `CLAUDE.md` を保証します。パス解決は `project_id` の `projects.project_path` を最優先にします。
- **プロジェクトパス QA スモーク追加** — `pnpm run test:qa:project-path`（`QA_API_AUTH_TOKEN` または `API_AUTH_TOKEN` が必要）を追加し、パス補助API/作成/重複パス応答/クリーンアップを検証できます。

- 詳細: [`docs/releases/v1.1.5.md`](docs/releases/v1.1.5.md)

---

## Decision Inbox 追加更新 (2026-02-22)

- **プロジェクトレビュー開始ラベル整理** — 代表選択が不要な単一アクティブ項目では、元の依頼文ではなく `チームリーダー会議を進行` を一貫表示します。
- **プロジェクト意思決定の集約ローディングゲート** — プロジェクトのアクティブ項目がすべて Review に到達すると、先に `企画リードが意見を集約中...` を表示し、集約完了まで選択肢を非表示にします。
- **レビューラウンド1 + 2 の意思決定ゲート化** — 両ラウンドとも `revision_requested` 時点で Decision Inbox に待機し、CEO決定前の自動ラウンド遷移を停止します。
- **レビュー意思決定のチェリーピック複数選択** — 各レビュー意思決定カードで、チームリーダー意見を複数選択して一括補完を実行できます。
- **追加意見の同時反映** — 選択項目に加えて追加意見を直接入力し、同じ補完ラウンドで同時に反映できます。
- **次ラウンドへ SKIP** — ラウンド1 -> 2、ラウンド2 -> 3 へ `次ラウンドへスキップ` で進行でき、重複した新規タスク分岐を防ぎます。
- **集約サマリーの可読性 + 選択肢ガイド強化** — 企画リード集約サマリーの改行整形を改善し、単一項目ケースでは現在選択可能な項目をサマリー本文に明示します。
- **プロジェクト意思決定の SQL 履歴化** — 企画リード集約/代表選択/追加要請/会議開始イベントを SQL に記録し、プロジェクト管理の `代表選択事項` で追跡できます。
- **企画リードのキャラクターアイコン一貫性** — 初回ロード/ライブ同期でも企画リードメタデータを保持するよう修正し、キャラクターアイコンと絵文字が切り替わる表示揺れを解消しました。
- **レポートポップアップを1回表示に統一** — 完了直後の即時ポップアップは抑止し、企画リードのLLM最終統合レポート生成後に1回だけ表示するよう変更しました。
- **タスク非表示状態の移行（localStorage → SQLite）** — タスクの非表示/再表示状態をブラウザの localStorage ではなく DB の `hidden` カラムに保存するよう変更し、サーバー再起動時に非表示 ID が消去されるバグを修正しました。`PATCH /api/tasks/:id` に hidden フィールドサポートを追加し、`POST /api/tasks/bulk-hide` で一括操作に対応しました。
- **レポート履歴のページネーション** — レポート履歴モーダルに全体リスト5件単位のページネーション（フッターの前へ/次へ）を追加しました。各ページ内ではプロジェクトグループ別サブページネーション（グループあたり3件）も維持されます。

- 追加ノート: [`docs/releases/v1.1.5.md`](docs/releases/v1.1.5.md)

---

## AIでインストール

> **以下をAIコーディングエージェント（Claude Code、Codex、Gemini CLI等）に貼り付けるだけです：**
>
> ```
> Install Claw-Empire following the guide at:
> https://github.com/GreenSheep01201/claw-empire
> ```
>
> AIがこのREADMEを読んで自動的にすべてを処理します。

---

## スクリーンショット

<table>
<tr>
<td width="50%">

**ダッシュボード** — リアルタイムKPIメトリクス、エージェントランキング、各部署のステータスを一目で把握

<img src="Sample_Img/Dashboard.png" alt="Dashboard" width="100%" />
</td>
<td width="50%">

**カンバンボード** — 部署・エージェントフィルター付きのドラッグ＆ドロップによるタスク管理

<img src="Sample_Img/Kanban.png" alt="Kanban Board" width="100%" />
</td>
</tr>
<tr>
<td width="50%">

**スキルライブラリ** — カテゴリ別に整理された600以上のエージェントスキルを閲覧・割り当て

<img src="Sample_Img/Skills.png" alt="Skills Library" width="100%" />
</td>
<td width="50%">

**マルチプロバイダーCLI** — Claude Code、Codex、Gemini CLI、OpenCodeをモデル選択付きで設定

<img src="Sample_Img/CLI.png" alt="CLI Tools Settings" width="100%" />
</td>
</tr>
<tr>
<td width="50%">

**OAuth連携** — 暗号化トークンストレージによる安全なGitHub・Google OAuth

<img src="Sample_Img/OAuth.png" alt="OAuth Settings" width="100%" />
</td>
<td width="50%">

**議事録** — AIが生成する会議サマリーと複数ラウンドのレビュー承認フロー

<img src="Sample_Img/Meeting_Minutes.png" alt="Meeting Minutes" width="100%" />
</td>
</tr>
<tr>
<td width="50%">

**メッセンジャー連携** — Telegram、Discord、Slackから `$` CEOディレクティブを送信し、リアルタイムのタスク更新を受信（OpenClaw経由）

<img src="Sample_Img/telegram.png" alt="Messenger Integration" width="100%" />
</td>
<td width="50%">

**設定** — 会社名、CEO名、デフォルトプロバイダー設定（CLI/OAuth/API）、言語などの環境設定

<img src="Sample_Img/Setting.png" alt="Settings" width="100%" />
</td>
</tr>
<tr>
<td width="50%">

**詳細レポート** — リクエスト完了時のレポートポップアップ、履歴、詳細表示のサンプル

<img src="Sample_Img/Report.png" alt="Detailed Report" width="100%" />
</td>
<td width="50%">

**PPT生成例** — レポート依頼から生成されたPPT出力のサンプル

<p align="center">
  <img src="Sample_Img/PPT_Gen0.png" alt="PPT Generation Example 0" width="49%" />
  <img src="Sample_Img/PPT_Gen1.png" alt="PPT Generation Example 1" width="49%" />
</p>
</td>
</tr>
</table>

### PPT サンプルソース

レポートからPPTを生成する機能を確認・拡張するためのサンプルを参照できます。
利用手順: **チャット画面 > Report Request ボタン** を押して依頼内容を入力してください。

- フォルダ: [`docs/reports/Sample_Slides`](docs/reports/Sample_Slides)
- サンプルデッキ（`.pptx`）: [`docs/reports/PPT_Sample.pptx`](docs/reports/PPT_Sample.pptx)
- HTMLスライド: [`slide-01.html`](docs/reports/Sample_Slides/slide-01.html), [`slide-02.html`](docs/reports/Sample_Slides/slide-02.html), [`slide-03.html`](docs/reports/Sample_Slides/slide-03.html), [`slide-04.html`](docs/reports/Sample_Slides/slide-04.html), [`slide-05.html`](docs/reports/Sample_Slides/slide-05.html), [`slide-06.html`](docs/reports/Sample_Slides/slide-06.html), [`slide-07.html`](docs/reports/Sample_Slides/slide-07.html), [`slide-08.html`](docs/reports/Sample_Slides/slide-08.html), [`slide-09.html`](docs/reports/Sample_Slides/slide-09.html)
- ビルドスクリプト: [`build-pptx.mjs`](docs/reports/Sample_Slides/build-pptx.mjs), [`build-pptx.cjs`](docs/reports/Sample_Slides/build-pptx.cjs), [`html2pptx.cjs`](docs/reports/Sample_Slides/html2pptx.cjs)

---

## 機能一覧

| 機能 | 説明 |
|------|------|
| **ピクセルアートオフィス** | 6つの部署でエージェントが歩き回り、作業し、会議に参加するアニメーション付きオフィスビュー |
| **カンバンタスクボード** | 受信箱、計画中、協議中、進行中、レビュー中、完了 — ドラッグ＆ドロップ対応の完全なタスクライフサイクル管理 |
| **CEOチャット＆ディレクティブ** | チームリーダーへの直接コミュニケーション；`$` ディレクティブで会議選択と作業パス/コンテキスト（`project_path`、`project_context`）を指定可能 |
| **マルチプロバイダー対応** | Claude Code、Codex CLI、Gemini CLI、OpenCode、Antigravity — すべて一つのダッシュボードから管理 |
| **外部APIプロバイダー** | 設定 > APIタブからエージェントを外部LLM API（OpenAI、Anthropic、Google、Ollama、OpenRouter、Together、Groq、Cerebras、カスタム）に接続 |
| **OAuth連携** | ローカルSQLiteへのAES暗号化トークンストレージによるGitHub・Google OAuth |
| **リアルタイムWebSocket** | ライブステータス更新、アクティビティフィード、エージェント状態のリアルタイム同期 |
| **アクティブエージェント制御** | 作業中エージェントのプロセス/活動/アイドル情報を可視化し、スタックしたタスクを強制停止 |
| **タスクレポートシステム** | 完了ポップアップ、レポート履歴、チーム別詳細、企画リード統合アーカイブ |
| **エージェントランキング＆XP** | タスク完了でXPを獲得するエージェント；上位パフォーマーを追跡するランキングボード |
| **スキルライブラリ** | Frontend、Backend、Design、AI、DevOps、Securityなど600以上のカテゴリ別スキル |
| **ミーティングシステム** | 予定・臨時ミーティング対応；AIによる議事録自動生成と複数ラウンドレビュー機能 |
| **Git Worktree分離** | 各エージェントは独立したgitブランチで作業し、CEO承認後にのみマージ |
| **多言語UI** | 英語、韓国語、日本語、中国語 — 自動検出または手動設定 |
| **メッセンジャー連携** | Telegram、Discord、Slack等 — OpenClawゲートウェイ経由で `$` CEOディレクティブ送信＆タスク更新受信 |
| **PowerPointエクスポート** | 議事録やレポートからプレゼンテーションスライドを自動生成 |
| **通信QAスクリプト** | `test:comm:*` スクリプトでCLI/OAuth/API疎通を再試行・証跡ログ付きで検証 |
| **インアプリ更新通知** | GitHub 最新リリースを確認し、新バージョンがある場合にOS別 `git pull` 手順とリリースノートリンクを上部バナー表示 |
| **部署管理** | 企画、開発、デザイン、QA/QC、DevSecOps、オペレーション |

---

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| **フロントエンド** | React 19 + Vite 7 + Tailwind CSS 4 + TypeScript 5.9 |
| **ピクセルアートエンジン** | PixiJS 8 |
| **バックエンド** | Express 5 + SQLite（設定不要の組み込みDB） |
| **リアルタイム通信** | WebSocket (ws) |
| **バリデーション** | Zod 4 |
| **アイコン** | Lucide React |
| **ルーティング** | React Router 7 |
| **エクスポート** | PptxGenJS（PowerPoint生成） |

<a id="ai-installation-guide">
## AIインストールガイド

> このセクションはAIコーディングエージェント向けです。各ステップで検証コマンドを実行してから次に進んでください。

### ステップ0: 前提条件の確認

```bash
# Node.js 22+
node -v

# pnpm（未導入ならcorepackを有効化）
pnpm -v || corepack enable

# git
git --version
```

### ステップ1: クローンしてワンクリックセットアップ

```bash
git clone https://github.com/GreenSheep01201/claw-empire.git
cd claw-empire
git submodule update --init --recursive
bash install.sh
```

Windows PowerShell:

```powershell
git clone https://github.com/GreenSheep01201/claw-empire.git
cd claw-empire
git submodule update --init --recursive
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

### ステップ2: セットアップ結果の検証

macOS/Linux:

```bash
# 必須ファイル確認
[ -f .env ] && [ -f scripts/setup.mjs ] && echo "setup files ok"

# AGENTSオーケストレーションルール確認
grep -R "BEGIN claw-empire orchestration rules" ~/.openclaw/workspace/AGENTS.md AGENTS.md 2>/dev/null || true
grep -R "INBOX_SECRET_DISCOVERY_V2" ~/.openclaw/workspace/AGENTS.md AGENTS.md 2>/dev/null || true

# OpenClaw inbox 必須 .env 項目確認
grep -E '^(INBOX_WEBHOOK_SECRET|OPENCLAW_CONFIG)=' .env || true
```

Windows PowerShell:

```powershell
if ((Test-Path .\.env) -and (Test-Path .\scripts\setup.mjs)) { "setup files ok" }
$agentCandidates = @("$env:USERPROFILE\.openclaw\workspace\AGENTS.md", ".\AGENTS.md")
$agentCandidates | ForEach-Object { if (Test-Path $_) { Select-String -Path $_ -Pattern "BEGIN claw-empire orchestration rules" } }
$agentCandidates | ForEach-Object { if (Test-Path $_) { Select-String -Path $_ -Pattern "INBOX_SECRET_DISCOVERY_V2" } }

# OpenClaw inbox 必須 .env 項目確認
Get-Content .\.env | Select-String -Pattern '^(INBOX_WEBHOOK_SECRET|OPENCLAW_CONFIG)='
```

### ステップ3: 起動とヘルスチェック

```bash
pnpm dev:local
```

別ターミナルで:

```bash
curl -s http://127.0.0.1:8790/healthz
```

期待値: `{"ok":true,...}`

`.env` の `OPENCLAW_CONFIG` は絶対パスを推奨します（ドキュメントでは引用符なし推奨）。`v1.0.5` では引用符と先頭 `~` もランタイムで正規化されます。

### ステップ4: OpenClawゲートウェイ + inbox（任意）検証

```bash
curl -s http://127.0.0.1:8790/api/gateway/targets
```

`OPENCLAW_CONFIG` が有効なら、利用可能なメッセンジャーセッションが返ります。

```bash
curl -X POST http://127.0.0.1:8790/api/inbox \
  -H "content-type: application/json" \
  -H "x-inbox-secret: $INBOX_WEBHOOK_SECRET" \
  -d '{"source":"telegram","author":"ceo","text":"$README v1.1.5 inbox 検証","skipPlannedMeeting":true}'
```

期待値:
- サーバーに `INBOX_WEBHOOK_SECRET` が設定され、`x-inbox-secret` が一致する場合は `200`
- ヘッダー欠落/不一致の場合は `401`
- サーバー側 `INBOX_WEBHOOK_SECRET` 未設定の場合は `503`

---

## クイックスタート

### 前提条件

| ツール | バージョン | インストール |
|--------|-----------|-------------|
| **Node.js** | >= 22 | [nodejs.org](https://nodejs.org/) |
| **pnpm** | 最新版 | `corepack enable`（Node.js組み込み） |
| **Git** | 任意 | [git-scm.com](https://git-scm.com/) |

### ワンクリックセットアップ（推奨）

| プラットフォーム | コマンド |
|------------------|----------|
| **macOS / Linux** | `git clone https://github.com/GreenSheep01201/claw-empire.git && cd claw-empire && bash install.sh` |
| **Windows (PowerShell)** | `git clone https://github.com/GreenSheep01201/claw-empire.git; cd claw-empire; powershell -ExecutionPolicy Bypass -File .\install.ps1` |

既にクローン済みの場合:

| プラットフォーム | コマンド |
|------------------|----------|
| **macOS / Linux** | `git submodule update --init --recursive && bash scripts/openclaw-setup.sh` |
| **Windows (PowerShell)** | `git submodule update --init --recursive; powershell -ExecutionPolicy Bypass -File .\scripts\openclaw-setup.ps1` |

### OpenClaw `.env` 必須設定（`/api/inbox` 利用時）

チャットWebhook連携の前に、`.env` に次の2項目を設定してください。

- `INBOX_WEBHOOK_SECRET=<十分に長いランダムシークレット>`
- `OPENCLAW_CONFIG=<openclaw.json の絶対パス>`（引用符なし推奨）

`scripts/openclaw-setup.sh` / `scripts/openclaw-setup.ps1` は `INBOX_WEBHOOK_SECRET` が未設定なら自動生成します。
初期インストール（`bash install.sh` / `install.ps1`）でも同じセットアップスクリプトを通るため、初回から自動適用されます。
既存クローンで `git pull` のみ実施した場合も、`pnpm dev*` / `pnpm start*` 初回実行時に必要条件で1回自動補正し、以後の再実行防止として `CLAW_MIGRATION_V1_0_5_DONE=1` を保存します。

`/api/inbox` はサーバー側 `INBOX_WEBHOOK_SECRET` と `x-inbox-secret` ヘッダーの完全一致が必要です。
- ヘッダー欠落/不一致 -> `401`
- サーバー設定欠落（`INBOX_WEBHOOK_SECRET`） -> `503`

### 手動セットアップ（代替）

<details>
<summary><b>macOS / Linux</b></summary>

```bash
# 1. リポジトリをクローン
git clone https://github.com/GreenSheep01201/claw-empire.git
cd claw-empire

# 2. corepackでpnpmを有効化
corepack enable

# 3. 依存関係をインストール
pnpm install

# 4. ローカル環境ファイルを作成
cp .env.example .env

# 5. ランダムな暗号化シークレットを生成
node -e "
  const fs = require('fs');
  const crypto = require('crypto');
  const p = '.env';
  const content = fs.readFileSync(p, 'utf8');
  fs.writeFileSync(p, content.replace('__CHANGE_ME__', crypto.randomBytes(32).toString('hex')));
"

# 6. AGENTS.mdオーケストレーション規則をセットアップ（AIエージェントにClaw-Empireプロジェクトマネージャーの役割を付与）
pnpm setup -- --port 8790

# 7. 開発サーバーを起動
pnpm dev:local
```

</details>

<details>
<summary><b>Windows (PowerShell)</b></summary>

```powershell
# 1. リポジトリをクローン
git clone https://github.com/GreenSheep01201/claw-empire.git
cd claw-empire

# 2. corepackでpnpmを有効化
corepack enable

# 3. 依存関係をインストール
pnpm install

# 4. ローカル環境ファイルを作成
Copy-Item .env.example .env

# 5. ランダムな暗号化シークレットを生成
node -e "const fs=require('fs');const crypto=require('crypto');const p='.env';const c=fs.readFileSync(p,'utf8');fs.writeFileSync(p,c.replace('__CHANGE_ME__',crypto.randomBytes(32).toString('hex')))"

# 6. AGENTS.mdオーケストレーション規則をセットアップ（AIエージェントにClaw-Empireプロジェクトマネージャーの役割を付与）
pnpm setup -- --port 8790

# 7. 開発サーバーを起動
pnpm dev:local
```

</details>

### AGENTS.md セットアップ

`pnpm setup` コマンドはAIエージェントの `AGENTS.md` ファイルに**CEOディレクティブオーケストレーション規則**を注入します。これによりAIコーディングエージェント（Claude Code、Codex等）が以下を実行できるようになります：

- `$` プレフィックス **CEOディレクティブ** の解釈と優先タスクの委任
- Claw-Empire REST APIを呼び出してタスク作成、エージェント割り当て、ステータス報告
- 安全な並行開発のための独立したgit worktree環境での作業

```bash
# デフォルト：AGENTS.mdの場所を自動検出
pnpm setup

# カスタムパス
pnpm setup -- --agents-path /path/to/your/AGENTS.md

# カスタムポート
pnpm setup -- --port 8790
```

<a id="openclaw-integration"></a>
### OpenClaw連携セットアップ（Telegram/Discord/Slack）

`install.sh` / `install.ps1`（または `scripts/openclaw-setup.*`）は、可能な場合に `OPENCLAW_CONFIG` を自動検出して `.env` に設定します。

推奨 `.env` 形式: `OPENCLAW_CONFIG` は絶対パス（引用符なし推奨）。
`v1.0.5` では互換性のため、引用符と先頭 `~` もランタイムで正規化します。

デフォルトパス:

| OS | パス |
|----|------|
| **macOS / Linux** | `~/.openclaw/openclaw.json` |
| **Windows** | `%USERPROFILE%\.openclaw\openclaw.json` |

手動実行:

```bash
# macOS / Linux
bash scripts/openclaw-setup.sh --openclaw-config ~/.openclaw/openclaw.json
```

```powershell
# Windows PowerShell
powershell -ExecutionPolicy Bypass -File .\scripts\openclaw-setup.ps1 -OpenClawConfig "$env:USERPROFILE\.openclaw\openclaw.json"
```

セッション確認:

```bash
curl -s http://127.0.0.1:8790/api/gateway/targets
```

<a id="dollar-command-logic"></a>
### `$` コマンドによるOpenClawチャット依頼ロジック

チャットメッセージが `$` で始まる場合、Claw-EmpireはCEOディレクティブとして扱います。

1. オーケストレーターがチームリーダー会議を開くか確認します。
2. オーケストレーターが作業対象のプロジェクト（`project_path` または `project_context`）を確認します。
3. `$` プレフィックス付きのメッセージを `x-inbox-secret` ヘッダー付きで `POST /api/inbox` に送信します。
4. 会議を省略する場合は `"skipPlannedMeeting": true` を付けます。
5. サーバーは `directive` として保存し、全社共有後に企画チーム（およびメンション部門）へ委任します。

`x-inbox-secret` が欠落、または `INBOX_WEBHOOK_SECRET` と不一致の場合、サーバーは `401` を返します。
サーバー側で `INBOX_WEBHOOK_SECRET` が未設定の場合は `503` を返します。

会議あり:

```bash
curl -X POST http://127.0.0.1:8790/api/inbox \
  -H "content-type: application/json" \
  -H "x-inbox-secret: $INBOX_WEBHOOK_SECRET" \
  -d '{"source":"telegram","author":"ceo","text":"$金曜までにQA承認付きでv0.2をリリース","project_path":"/workspace/my-project"}'
```

会議なし:

```bash
curl -X POST http://127.0.0.1:8790/api/inbox \
  -H "content-type: application/json" \
  -H "x-inbox-secret: $INBOX_WEBHOOK_SECRET" \
  -d '{"source":"telegram","author":"ceo","text":"$本番ログイン不具合を今すぐホットフィックス","skipPlannedMeeting":true,"project_context":"既存の climpire プロジェクト"}'
```

ブラウザで開く：

| URL | 説明 |
|-----|------|
| `http://127.0.0.1:8800` | フロントエンド（Vite開発サーバー） |
| `http://127.0.0.1:8790/healthz` | APIヘルスチェック |

---

## 環境変数

`.env.example` を `.env` にコピーしてください。すべてのシークレットはローカルに保管されます — `.env` はコミットしないでください。

| 変数 | 必須 | 説明 |
|------|------|------|
| `OAUTH_ENCRYPTION_SECRET` | **必須** | SQLite内のOAuthトークンを暗号化 |
| `PORT` | 任意 | サーバーポート（デフォルト: `8790`） |
| `HOST` | 任意 | バインドアドレス（デフォルト: `127.0.0.1`） |
| `API_AUTH_TOKEN` | 推奨 | ループバック以外のAPI/WebSocketアクセス向けBearerトークン |
| `INBOX_WEBHOOK_SECRET` | **`/api/inbox` 利用時必須** | `x-inbox-secret` ヘッダーと一致させる共有シークレット |
| `OPENCLAW_CONFIG` | OpenClaw利用時推奨 | ゲートウェイターゲット検出/チャット連携で使う `openclaw.json` の絶対パス |
| `DB_PATH` | 任意 | SQLiteデータベースパス（デフォルト: `./claw-empire.sqlite`） |
| `LOGS_DIR` | 任意 | ログディレクトリ（デフォルト: `./logs`） |
| `OAUTH_GITHUB_CLIENT_ID` | 任意 | GitHub OAuth Appクライアント ID |
| `OAUTH_GITHUB_CLIENT_SECRET` | 任意 | GitHub OAuth Appクライアントシークレット |
| `OAUTH_GOOGLE_CLIENT_ID` | 任意 | Google OAuthクライアントID |
| `OAUTH_GOOGLE_CLIENT_SECRET` | 任意 | Google OAuthクライアントシークレット |
| `OPENAI_API_KEY` | 任意 | OpenAI APIキー（Codex用） |
| `UPDATE_CHECK_ENABLED` | 任意 | インアプリ更新確認バナーを有効化（デフォルト `1`、`0` で無効） |
| `UPDATE_CHECK_REPO` | 任意 | 更新確認に使う GitHub リポジトリスラッグ（デフォルト: `GreenSheep01201/claw-empire`） |
| `UPDATE_CHECK_TTL_MS` | 任意 | 更新確認キャッシュ TTL（ミリ秒、デフォルト: `1800000`） |
| `UPDATE_CHECK_TIMEOUT_MS` | 任意 | GitHub リクエストタイムアウト（ミリ秒、デフォルト: `4000`） |
| `AUTO_UPDATE_ENABLED` | 任意 | `settings.autoUpdateEnabled` が未設定時に使う自動更新の既定値（デフォルト `0`） |

`API_AUTH_TOKEN` を有効化した場合、リモートブラウザクライアントは実行時にトークンを入力します。トークンは `sessionStorage` のみに保存され、Viteビルド成果物には埋め込まれません。
`OPENCLAW_CONFIG` は絶対パス推奨で、`v1.0.5` では引用符/先頭 `~` も自動正規化されます。

---

## 実行モード

```bash
# 開発モード（ローカルのみ、推奨）
pnpm dev:local          # 127.0.0.1にバインド

# 開発モード（ネットワークアクセス可）
pnpm dev                # 0.0.0.0にバインド

# プロダクションビルド
pnpm build              # TypeScriptチェック + Viteビルド
pnpm start              # ビルド済みサーバーを起動

# ヘルスチェック
curl -fsS http://127.0.0.1:8790/healthz
```

### 通信QAチェック（v1.1.5）

```bash
# 個別チェック
pnpm run test:comm:llm
pnpm run test:comm:oauth
pnpm run test:comm:api

# 統合チェック（互換エントリ含む）
pnpm run test:comm:suite
pnpm run test:comm-status
```

`test:comm:suite` は機械可読な証跡を `logs/` に、要約レポートを `docs/` に出力します。

### プロジェクトパス QA スモーク（v1.1.5）

```bash
# API 認証トークンが必要
QA_API_AUTH_TOKEN="<API_AUTH_TOKEN>" pnpm run test:qa:project-path
```

`test:qa:project-path` は、パス補助 API、プロジェクト作成フロー、重複 `project_path` 競合レスポンス、クリーンアップ動作を検証します。

### インアプリ更新バナー

GitHub により新しいリリースが公開されると、Claw-Empire は UI 上部に pull 手順とリリースノートリンク付きバナーを表示します。

- Windows PowerShell: `git pull; pnpm install`
- macOS/Linux シェル: `git pull && pnpm install`
- pull/install 後にサーバーを再起動してください。

### 自動更新（セーフモード、オプトイン）

リリース同期を自動化する場合は、Settings の `Auto Update (Global)` を有効化してください。

- `GET /api/update-auto-status` — 自動更新の実行状態/設定状態を取得（**認証必須**）
- `POST /api/update-auto-config` — 自動更新トグル（`enabled`）を再起動なしで即時反映（**認証必須**）
- `POST /api/update-apply` — 手動で更新パイプラインを実行（`dry_run` / `force` / `force_confirm`、**認証必須**）
  - `dirty_worktree`, `channel_check_unavailable` ガードは `force` でも迂回できません。

既定値は引き続き **OFF** です。`AUTO_UPDATE_CHANNEL` が不正な値の場合、サーバーは警告ログを出し `patch` にフォールバックします。

---

<a id="cliプロバイダーの設定"></a>
## プロバイダー設定（CLI / OAuth / API）

Claw-Empireは次の3種類のプロバイダー接続に対応しています：

- **CLIツール** — ローカルCLIをインストールしてプロセス実行
- **OAuthアカウント** — 対応プロバイダーを安全なトークン連携で接続
- **直接APIキー** — **Settings > API** タブから外部LLM APIへ接続

CLIモードを利用する場合は、少なくとも一つをインストールしてください：

| プロバイダー | インストール | 認証 |
|-------------|------------|------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `npm i -g @anthropic-ai/claude-code` | `claude`（プロンプトに従う） |
| [Codex CLI](https://github.com/openai/codex) | `npm i -g @openai/codex` | `.env`に`OPENAI_API_KEY`を設定 |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `npm i -g @google/gemini-cli` | 設定パネルからOAuth認証 |
| [OpenCode](https://github.com/opencode-ai/opencode) | `npm i -g opencode` | プロバイダー固有の設定 |

アプリ内の **Settings > CLI Tools** パネルでプロバイダーとモデルを設定してください。

または、CLI をインストールせずに **Settings > API** タブからエージェントを外部 LLM API に接続することも可能です。APIキーはローカルSQLiteデータベースに暗号化（AES-256-GCM）して保存されます — `.env` やソースコードには含まれません。
スキル学習/解除の自動化は、現在CLI連携プロバイダーを対象に設計されています。

---

## プロジェクト構成

```
claw-empire/
├── server/
│   └── index.ts              # Express 5 + SQLite + WebSocketバックエンド
├── src/
│   ├── App.tsx                # ルーティング付きメインReactアプリ
│   ├── api.ts                 # フロントエンドAPIクライアント
│   ├── i18n.ts                # 多言語サポート（en/ko/ja/zh）
│   ├── components/
│   │   ├── OfficeView.tsx     # PixiJSエージェント付きピクセルアートオフィス
│   │   ├── Dashboard.tsx      # KPIメトリクスとチャート
│   │   ├── TaskBoard.tsx      # カンバン形式のタスク管理
│   │   ├── ChatPanel.tsx      # CEO-エージェント間コミュニケーション
│   │   ├── SettingsPanel.tsx  # 会社・プロバイダー設定
│   │   ├── SkillsLibrary.tsx  # エージェントスキル管理
│   │   └── TerminalPanel.tsx  # リアルタイム実行出力ビューアー
│   ├── hooks/                 # usePolling, useWebSocket
│   └── types/                 # TypeScript型定義
├── public/sprites/            # 12種類のピクセルアートエージェントスプライト
├── scripts/
│   ├── openclaw-setup.sh      # ワンクリックセットアップ（macOS/Linux）
│   ├── openclaw-setup.ps1     # ワンクリックセットアップ（Windows PowerShell）
│   ├── preflight-public.sh    # リリース前セキュリティチェック
│   └── generate-architecture-report.mjs
├── install.sh                 # scripts/openclaw-setup.sh のラッパー
├── install.ps1                # scripts/openclaw-setup.ps1 のラッパー
├── docs/                      # 設計・アーキテクチャドキュメント
├── .env.example               # 環境変数テンプレート
└── package.json
```

---

## セキュリティ

Claw-Empireはセキュリティを重視した設計になっています：

- **ローカルファーストアーキテクチャ** — すべてのデータをSQLiteにローカル保存；外部クラウドサービス不要
- **OAuthトークンの暗号化** — ユーザーのOAuthトークンは**サーバー側のSQLiteにのみ保存**され、`OAUTH_ENCRYPTION_SECRET`を使用してAES-256-GCMで暗号化されます。ブラウザにリフレッシュトークンが渡ることはありません
- **ビルトインOAuth Client ID** — ソースコードに埋め込まれたGitHub・Google OAuth client ID/secretは**公開OAuthアプリ認証情報**であり、ユーザーシークレットではありません。[Googleのドキュメント](https://developers.google.com/identity/protocols/oauth2/native-app)によると、インストール型/デスクトップアプリのclient secretは「シークレットとして扱われない」とされています。これはオープンソースアプリ（VS Code、Thunderbird、GitHub CLI等）の標準的な慣行です。これらの認証情報はアプリ自体を識別するだけであり、個人トークンは常に別途暗号化されます
- **ソースコードに個人認証情報なし** — すべてのユーザー固有トークン（GitHub、Google OAuth）はローカルSQLiteに暗号化して保存され、ソースコードには含まれません
- **リポジトリにシークレットを含まない** — 包括的な `.gitignore` が `.env`、`*.pem`、`*.key`、`credentials.json` などをブロック
- **プリフライトセキュリティチェック** — 公開リリース前に `pnpm run preflight:public` を実行し、ワーキングツリーとgit履歴の両方で漏洩したシークレットをスキャン
- **デフォルトでローカルホスト** — 開発サーバーは `127.0.0.1` にバインドされ、ネットワークに公開されない

---

## コントリビューション

コントリビューションを歓迎します！以下の手順でお願いします：

1. リポジトリをフォーク
2. フィーチャーブランチを作成（`git checkout -b feature/amazing-feature`）
3. 変更をコミット（`git commit -m 'Add amazing feature'`）
4. ブランチにプッシュ（`git push origin feature/amazing-feature`）
5. Pull Request は原則 `dev` ブランチ宛てで作成（外部コントリビューター向け統合ブランチ）
6. `main` はメンテナー承認済みの緊急ホットフィックス時のみ使用し、その後 `main -> dev` をバックマージ

詳細ポリシー: [`CONTRIBUTING.md`](CONTRIBUTING.md)

---

## ライセンス

[Apache 2.0](LICENSE) — 個人・商用利用ともに無料。

---

<div align="center">

**ピクセルと情熱で作られています。**

*Claw-Empire — AIエージェントたちが働く場所。*

</div>
