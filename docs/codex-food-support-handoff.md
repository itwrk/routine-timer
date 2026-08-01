# Codex向け 実装指示書 — 食行動・食生活支援機能

前提資料: `docs/food-support-design.md`（**先に全文を読むこと**）
対象: `/Users/haruka/Downloads/ルーチンタイマー/index.html`（基準コミット `b11a086`、2510行）
本書に書かれた行番号は **基準コミット時点** のもの。コミット1を入れた時点でずれるので、**行番号ではなく「アンカー文字列」で位置を特定すること**（各節に明記する）。

---

## 0. 作業開始前の必須手順

```bash
cd /Users/haruka/Downloads/ルーチンタイマー && git pull
```

- ブラウザ経由・claude.ai経由で index.html が更新されていることがある。**必ず pull してから始める。**
- `git status` がクリーンでない場合は、Halに確認するまで作業を始めない。

---

## 1. 実装のゴール

**「今の自分が、次に何をすればいいかを考えなくて済む」ための食事支援を、既存アプリを壊さずに index.html へ追加する。**

達成すべき具体的な状態:

1. ホームを開いた瞬間、スクロールせずに食事カードが見える。
2. 「前回と同じ」1タップで食事セッションが始まる。
3. 食べ終わって「もっと食べたい8」→ 5分待つ → 「4」→ 落ち着いた、が **合計6タップ**で完了する。
4. 待機中にアプリを閉じて戻っても、残り時間が正しく復元される。
5. 待機中に通常ルーチンを実行できる。
6. 記録が Google Drive 同期・JSONバックアップ・ChatGPT用CSV に自動で乗る。
7. **食事に XP・コンボ・ストリーク・紙吹雪・ジャックポットが一切関与しない。**
8. UIに「我慢」「成功」「失敗」「食べすぎ」等の語が一切出てこない。

**やらないこと**: カロリー・PFC・体重・栄養DB・写真・AI献立・統計・在庫管理・買い物リスト。

---

## 2. 絶対に壊してはいけない既存機能

以下は**1文字も変更しない**（コミット1の `normalizeData` 統合を除く）。

| 対象 | 現在の位置（基準コミット） | 理由 |
|---|---|---|
| `.nojekyll` | ファイル | 削除するとPagesが404 |
| `PRESET_SYNC` の `key:''` | `index.html:798` | 公開リポジトリ。合言葉を埋め込まない |
| `startRun` / `loadStep` / `tick` / `doneStep` / `skipStep` / `nextStep` / `finishAll` / `finishRun` / `endRun` / `recordCurrentStep` | 1781–2157 | ルーチン実行の中核 |
| グローバル `run` / `timer` | 1779 | **食事コードから読み書きしてよいのは `run` の参照だけ**（読み上げ抑止の判定）。代入は禁止 |
| `streak()` | 833 | 食事がストリークに影響してはいけない |
| `renderProg()` | 2160 | ヒートマップ・XPバー |
| `syncShared()` | 1577 | 共有ステップの伝播 |
| `sendNotion()` | 2082 | 食事から呼ばない |
| `calAddEvent()` / `askCalLog()` / `loadCalEvents()` | 2309 / 2319 / 2282 | 食事から呼ばない |
| `aiCall()` / `aiStepTexts()` / `aiHitokoto()` | 968 / 983 / 996 | 食事データを外部送信しない |
| `exportTexts()` / `importTexts()` / `exportLogs()` / `exportHabitLogs()` | 2374 / 2396 / 2418 / 2427 | 既存CSVの形式を変えない |
| `buildChatGPTTimelineCsv()` のヘッダ文字列 | 2469 | `日時,種類,内容,ルーチン,ステップ,詳細` のまま |
| `syncDataForCloud()` の除外リスト | 2224–2232 | apiKey/syncUrl/syncKey/autoSync の除外を維持 |
| `esc()` / `twoTap()` / `toast()` / `download()` / `csvEsc()` / `timelineCsvEsc()` | 1567 / 1569 / 1011 / 2369 / 2360 / 2364 | 使うだけ。変更しない |
| `renderRunCk()` の `run.ckDone` 周り | 1845 | 既知の軽微バグがあるが**今回は触らない** |

**禁止事項（コード規約）**
- `prompt()` / `confirm()` / `alert()` を追加しない。確認は `twoTap()`、入力はインラインフォーム。
- 外部JS/CSSファイルに分割しない。単一 index.html を維持。
- `npm` / ビルドツール / フレームワークを導入しない。
- ブランチ作成・commit・push は**Halの指示があるまで行わない**（本書の §20 はコミット単位の設計であって、実行許可ではない）。

---

## 3. 実装順序（コミット単位）

| # | コミット | 内容 | 単独で動作するか |
|---|---|---|---|
| **C1** | `refactor: データ正規化を normalizeData に統合` | 3箇所のコピーを1関数へ。**挙動は完全に不変** | ✅ |
| **C2** | `feat: 食事データモデルとマイグレーションを追加` | `D` に4キー追加、`normalizeMeal*`、`seed()` 更新。**UIなし** | ✅（画面に変化なし） |
| **C3** | `feat: 食事セッションの開始と食後記録を追加` | ホームカード、`scr-meal`、開始〜`afterMeal`〜`closed` | ✅（待機なしで完結できる） |
| **C4** | `feat: 食後の待機タイマーと再評価を追加` | 待機バー、`endsAt` 復元、`afterWait`、`extra`、原因タグ | ✅ |
| **C5** | `feat: 食事をタイムライン・CSV・設定に統合` | 24hタイムライン、ChatGPT用CSV、食事CSV、設定カード、テンプレ管理 | ✅ |
| **C6** | `fix: 食事データの同期をID単位マージにする` | `mergeMealCollections`、手動プルの2度押し確認、2MB警告 | ✅ |

**C1 は必ず最初に、単独で入れる。** これを飛ばすと、同期経路・復元経路に食事キーを足し忘れる事故が確実に起きる（設計書 §1.3-P2 / R5）。

各コミットの後に **§15 の該当シナリオと §18 の回帰テストを実行する。**

---

## 4. 変更対象ファイル

| ファイル | 変更 |
|---|---|
| `index.html` | **これのみ** |
| `CLAUDE.md` / `AGENTS.md` | C5完了後、アーキテクチャ節に食事機能を1〜3行追記（両方に同じ内容） |

**変更してはいけないファイル**: `.nojekyll` / `deploy.command` / `.gitattributes` / `docs/*`（本書と設計書は完成品）

## 5. 新規作成するファイル

**なし。** すべて `index.html` 内に追加する。

---

## 6. index.html への挿入位置（アンカー指定）

### 6.1 CSS

**アンカー**: `/* tab bar */`（基準 `index.html:211`）
→ **この行の直前**に `/* ===== meal support ===== */` ブロックを挿入。

必要なクラス:
```
.meal-card / .meal-card-idle / .meal-card-row
.meal-scale        0-10 ボタンのグリッド（grid-template-columns:repeat(6,1fr); gap:5px）
.meal-scale button 最小 44x44px。aria-pressed=true で cyan 反転
.meal-scale-anchor 「ぜんぜん」「とても強い」の両端ラベル（font-size:9px; color:var(--dim)）
.meal-choice       2x2 の大ボタングリッド（grid-template-columns:1fr 1fr; gap:7px）
.meal-choice button{white-space:nowrap; padding:12px 6px; font-size:13px}
.meal-tags         チップ群（flex-wrap）。.on で cyan 枠
.meal-fold         折りたたみ（.meal-fold-head はテキストリンク、.meal-fold-body は display:none/block）
.meal-tpl-row      テンプレ1行（絵文字 + 名前 + はじめるボタン）
.meal-hist-row     履歴1行
.meal-rule         自分ルール表示
#mealWaitBar       position:fixed; z-index:110;
                   bottom:calc(56px + max(10px, env(safe-area-inset-bottom)));
                   left:8px; right:8px; max-width:520px; margin:0 auto;
                   background:var(--card2); border:1px solid var(--gold); border-radius:14px;
                   padding:7px 9px; box-shadow:0 0 18px rgba(255,201,60,.3); display:none;
#mealWaitBar.show  display:block
#mealWaitBar.done  border-color:var(--mint) （時間到達時。点滅は @keyframes で1.2s、reduced-motion で自動停止）
.meal-wait-actions 4等分のボタン行（display:flex; gap:4px; ボタンは flex:1; font-size:10px; white-space:nowrap）
body.meal-waiting #app{padding-bottom:136px}
@media(max-width:390px){.meal-scale{grid-template-columns:repeat(6,1fr)} .meal-choice button{font-size:12px}}
```

**制約**: 幅375pxで全ボタンが折り返さないこと。待機バーの4ボタンは絵文字+2〜5文字（`💧水` `🍽片づけ` `✅落ち着いた` `🍚まだ食べたい`）。

### 6.2 HTML

| # | アンカー | 挿入内容 |
|---|---|---|
| H1 | `<div class="card" id="habitCard">`（`index.html:436`）**の直前**（＝ひとことメモカードの閉じ `</div>` の直後） | `<div class="card" id="mealCard"></div>`（中身は `renderMealCard()` が描画） |
| H2 | `<!-- MANAGE / NOTES -->`（`index.html:475`）**の直前**（＝ `scr-preview` の閉じ `</div>` の後） | `<div class="screen" id="scr-meal"> … </div>` |
| H3 | `<div class="card" id="allMemoCard">`（`index.html:501`）**の直前** | `<div class="card" id="mealTemplateManageCard"> … </div>` |
| H4 | `<button class="btn btn-p btn-sm" onclick="exportChatGPTTimeline()">🤖 ChatGPT用CSV</button>`（`index.html:576`）**の直後** | `<button class="btn btn-p btn-sm" onclick="exportMealCsv()">🍽 食事CSV</button>` |
| H5 | `<h2>🔊 音声設定</h2>` を含む `<div class="card">`（`index.html:581`）**の直前** | `<div class="card" id="mealPrefsCard"> … </div>` |
| H6 | `<div class="tabbar">`（`index.html:741`）**の直前** | `<div id="mealWaitBar" role="status" aria-live="off"></div>` |

**H2 の `scr-meal` 静的骨格**（中身は render 関数が埋める）:
```html
<div class="screen" id="scr-meal">
  <div class="card">
    <div class="preview-head">
      <div class="preview-emoji">🍽</div>
      <div class="preview-title"><h2>食事サポート</h2><p class="muted" id="mealHeadMeta"></p></div>
      <button class="edit-btn" type="button" onclick="showScreen('scr-home')"
              style="background:none;border:none;color:var(--cyan);font-size:14px;padding:7px">← 戻る</button>
    </div>
    <div id="mealRules"></div>
    <div id="mealActive"></div>
    <div id="mealStart"></div>
  </div>
  <div class="card">
    <h2>📗 最近の食事</h2>
    <div id="mealHistory"></div>
  </div>
</div>
```

**H6 の待機バーは `aria-live="off"`** にすること。毎秒更新される残り時間をスクリーンリーダーが読み上げ続けるのを防ぐ。到達時のみ `toast()` が別途伝える。

### 6.3 JavaScript

**アンカー**: `/* ============ ☁️ 端末間同期 (GAS) ============ */`（`index.html:2203`）
→ **この行の直前**に `/* ============ 🍽 MEAL SUPPORT ============ */ … /* ============ 🍽 MEAL SUPPORT END ============ */` の**1つの連続ブロック**として全食事コードを置く。飛び地を作らない。

例外（既存関数への差し込み、いずれも数行）:

| 関数 | 位置 | 差し込む内容 |
|---|---|---|
| `seed()` | 766–783 | 食事4キーの初期値 |
| 初期ロード | 784–794 | `normalizeData()` 呼び出しに置換（C1） |
| `showScreen()` | 1020–1027 | `if(id==='scr-meal')renderMeal();` |
| `renderHome()` | 1036–1068 | `renderMealCard();` を `renderPersonalNotes();` の**前**に |
| `renderActivityTimeline()` | 1164–1193 | 食事イベントの `items.push`（C5） |
| `renderManage()` | 1407 | `renderMealTemplateManager();` を追加 |
| `renderSet()` | 2331–2344 | 食事設定の値を反映 |
| `saveSettings()` | 2345–2359 | 食事設定の値を保存 |
| `syncPull()` | 2233–2258 | `normalizeData()` 化（C1）+ `mergeMealCollections()`（C6）+ 手動プル保護（C6） |
| `syncPush()` | 2209–2223 | 2MB警告（C6） |
| `chatgptTimelineRows()` | 2442–2467 | 食事行の追加（C5） |
| `restoreAll()` | 2478–2483 | `normalizeData()` 化（C1） |
| `resetAll()` | 2484–2486 | 変更不要（`seed()` が食事キーを持てば自動的に正しい） |
| 起動処理 | 2502–2507 | `restoreMealState();` を `renderHome();` の直後に |

---

## 7. 関数・モジュールの責務

食事ブロックは以下の5層に分けて、この順に書く。

```
[1] 定数・デフォルト     MEAL_TAGS / MEAL_EFFORTS / MEAL_CHANGES / MEAL_WAIT_ACTIONS
                         builtinMealTemplates() / defaultMealPrefs()
[2] 正規化・マイグレーション normalizeMealSession/Template/FoodRule / migrateData
[3] データ操作（純粋寄り） activeMealSession() / activeWait() / touchMeal()
                         startMealSession() / endMealEating() / setAfterMealUrge() /
                         startMealWait() / endMealWait() / setAfterWaitUrge() /
                         setMealChange() / setMealExtra() / toggleMealTag() /
                         closeMealSession() / deleteMealSession()
[4] タイマー             startMealWaitTimer() / stopMealWaitTimer() / mealWaitTick() /
                         mealWaitRemainMs() / onMealWaitFinished() / resumeMealWait() /
                         restoreMealState()
[5] 描画                 renderMealCard() / renderMeal() / renderMealActive() /
                         renderMealStart() / renderMealHistory() / renderMealRules() /
                         renderMealWaitBar() / renderMealTemplateManager() /
                         mealScaleHtml() / mealTagsHtml()
[6] 出力                 mealTimelineItems() / mealTimelineRows() / buildMealCsv() /
                         exportMealCsv()
[7] 同期                 mergeMealCollections()
```

**状態は1つのオブジェクトに集約する。裸のグローバル変数を増やさない。**
```js
let mealState = {
  waitTimer: null,   // setInterval ハンドル（run/timer とは完全に別物）
  activeId:  null,   // 進行中セッションの id（キャッシュ）
  view:      'idle', // 'idle'|'eating'|'afterMeal'|'waiting'|'afterWait'|'extra'
  tagOpen:   false,  // 原因タグの折りたたみ
  beforeOpen:false,  // 食前状態の折りたたみ
  freeOpen:  false,  // 自由入力欄の開閉
  tplEditId: null    // 記録タブでテンプレ編集中のid（habitEditId と同じ役割）
};
```

---

## 8. データマイグレーション手順

### C1: `normalizeData()` 統合（挙動不変）

**追加**（食事ブロックではなく、`normalizeMood` の直後、`const seed=` の**前**に置く）:

```js
const CURRENT_SCHEMA = 2;

function normalizeData(raw){
  const d = Object.assign({moods:defaultMoods(), moodLogs:[]}, raw || {});
  d.settings = Object.assign({rate:1,voiceVolume:1,sfxVolume:.45,moti:true,sound:true}, d.settings||{});
  d.routines      = Array.isArray(d.routines)      ? d.routines      : [];
  d.hitokoto      = Array.isArray(d.hitokoto)      ? d.hitokoto      : [];
  d.logs          = Array.isArray(d.logs)          ? d.logs          : [];
  d.personalNotes = Array.isArray(d.personalNotes) ? d.personalNotes : [];
  d.moods         = (Array.isArray(d.moods) ? d.moods : defaultMoods()).map(normalizeMood);
  d.moodLogs      = Array.isArray(d.moodLogs)      ? d.moodLogs      : [];
  d.habits        = (Array.isArray(d.habits) ? d.habits : []).map(normalizeHabit);
  d.habitLogs     = Array.isArray(d.habitLogs)     ? d.habitLogs     : [];
  d.todayTasks    = Array.isArray(d.todayTasks)    ? d.todayTasks    : [];
  d.todayTaskLogs = Array.isArray(d.todayTaskLogs) ? d.todayTaskLogs : [];
  delete d.badges;
  return migrateData(d);
}

// C1 時点では中身は schemaVersion の設定のみ。C2 で食事キーを足す。
function migrateData(d){ d.schemaVersion = CURRENT_SCHEMA; return d; }
```

**置換1: 初期ロード**（`index.html:784-794` を丸ごと）
```js
// before: let D; try{...}catch(e){D=seed();} + 9行の正規化 + badges削除
let D;
try{ D = normalizeData(JSON.parse(localStorage.getItem(KEY)) || seed()); }
catch(e){ D = normalizeData(seed()); }
if(!localStorage.getItem(KEY)) localStorage.setItem(KEY, JSON.stringify(D));
```
> ⚠️ 元コードは `badges` があったときだけ `localStorage.setItem` していた（`index.html:794`）。この副作用は不要なので落としてよい。ただし**初回起動時に `rvt_v1` が無い場合は保存する**こと（上の3行目）。

**置換2: `syncPull()`**（`index.html:2244-2255` を丸ごと）
```js
// before: D=remote; + Object.assign 群 + 8行の正規化 + delete D.badges + setItem
D = normalizeData(remote);
D.settings = Object.assign(D.settings, localSync);   // 同期設定とAPIキーは端末側を維持
localStorage.setItem(KEY, JSON.stringify(D));
```
`localSync` の取得（`index.html:2243`）は**そのまま残す**。

**置換3: `restoreAll()`**（`index.html:2481` の `rd.onload` 内）
```js
rd.onload = ()=>{
  try{
    D = normalizeData(JSON.parse(rd.result));
    save(); toast('✅ 復元しました'); renderHome();
  }catch(e){ toast('⚠️ 読み込みに失敗しました'); }
  input.value='';
};
```

**C1 の検証**: 実データのある端末で開き、コンソールエラーゼロ・ホームの表示が変わらないこと。`localStorage.rvt_v1` を JSON diff して、`schemaVersion:2` の追加以外に差分がないこと。

### C2: 食事キーの追加

`migrateData()` を差し替える:
```js
function migrateData(d){
  const from = Number(d.schemaVersion) || 1;
  if(from < 2){
    if(!Array.isArray(d.mealSessions))  d.mealSessions  = [];
    if(!Array.isArray(d.mealTemplates) || !d.mealTemplates.length) d.mealTemplates = builtinMealTemplates();
    if(!Array.isArray(d.foodRules))     d.foodRules     = [];
  }
  d.mealSessions  = (Array.isArray(d.mealSessions)  ? d.mealSessions  : []).map(normalizeMealSession);
  d.mealTemplates = (Array.isArray(d.mealTemplates) ? d.mealTemplates : []).map(normalizeMealTemplate);
  d.foodRules     = (Array.isArray(d.foodRules)     ? d.foodRules     : []).map(normalizeFoodRule);
  d.mealPrefs     = Object.assign(defaultMealPrefs(), d.mealPrefs || {});
  purgeMealTombstones(d);
  if(d.mealSessions.length > 1000){
    d.mealSessions.sort((a,b)=>(a.startedAt||0)-(b.startedAt||0));
    d.mealSessions = d.mealSessions.slice(-1000);
  }
  d.schemaVersion = CURRENT_SCHEMA;
  return d;
}
function purgeMealTombstones(d){
  const limit = Date.now() - 60*24*60*60*1000;
  for(const k of ['mealSessions','mealTemplates','foodRules'])
    d[k] = d[k].filter(x => !x.deletedAt || x.deletedAt > limit);
}
```

`seed()`（`index.html:766-783`）の返却オブジェクトに追加:
```js
  schemaVersion: 2,
  mealSessions: [],
  mealTemplates: builtinMealTemplates(),
  foodRules: [],
  mealPrefs: defaultMealPrefs(),
```

**`normalizeMealSession()` は欠損に強くする**（同期・復元で不完全なデータが来る前提）:
```js
function normalizeMealSession(s){
  const n = Object.assign({
    id: uid(), startedAt: 0, endedAt: null, updatedAt: 0, deletedAt: null,
    status: 'closed', label: '食事', templateId: null, items: [],
    effortLevel: '', before: null, afterMeal: null, waits: [],
    afterWait: null, extra: null, note: ''
  }, s || {});
  n.items = Array.isArray(n.items) ? n.items.map(normalizeMealItem) : [];
  n.waits = Array.isArray(n.waits) ? n.waits.map(normalizeMealWait) : [];
  if(!['eating','waiting','closed'].includes(n.status)) n.status = 'closed';
  if(!n.updatedAt) n.updatedAt = n.startedAt || Date.now();
  n.label = String(n.label || '食事').slice(0, 60);
  n.note  = String(n.note  || '').slice(0, 280);
  return n;
}
const mealScore = v => Number.isInteger(v) && v >= 0 && v <= 10 ? v : null;
```

`before` / `afterMeal` / `afterWait` / `extra` の数値は**必ず `mealScore()` を通す**。`0` を `null` に落とさないこと（`v || null` は禁止。`0` が消える）。

---

## 9. UI追加箇所（詳細）

### 9.1 `renderMealCard()` — ホームの「ひとことメモ直下」

**配置はHal確認済み（2026-08-01）**: ひとことメモカードの**直下**、`#habitCard`（今日のチェックリスト）の**直上**。
最上部はひとことメモのまま。チェックリストは項目数で高さが変動するため、その**上**に置くことでファーストビュー内の位置を固定する。

```
📝 ひとことメモ + 🌡️ 今の気分     ← 変更なし（最上部のまま）
🍽 食事カード                    ← ★ここに挿入
✅ 今日のチェックリスト
ルーチン一覧 / 今後の予定 / 24hタイムライン
```

`#mealCard` の中身を状態で切り替える。**`innerHTML` を組み立て、自由入力は必ず `esc()` を通す。**

| `mealState.view` | 表示 |
|---|---|
| `idle` | 1行: `🍽 食事` + `[前回と同じ]`（履歴あり）or `[はじめる]` + `[選ぶ]` |
| `eating` | `🍽 食事中 ・ N分経過` / `label` / 全幅 `[🍽 食べ終わった]` / 折りたたみ `▸ 食前の状態を記録（任意）` / `templateId===null` のときだけ `[＋テンプレに保存]` |
| `afterMeal` | `いま、もっと食べたい気持ちは？` + `mealScaleHtml()` |
| `waiting` | `⏳ あと M:SS` + `[食事サポートを開く]`（詳細は待機バーで操作） |
| `afterWait` | `いま、どのくらい食べたい？` + `mealScaleHtml()`（前回値を薄く表示） |

`[選ぶ]` は `showScreen('scr-meal')`。`[前回と同じ]` は画面遷移せずその場でカードを更新する。

### 9.2 `mealScaleHtml(current, onPickFnName)` — 0〜10 ボタン

```html
<div class="meal-scale-anchor"><span>ぜんぜん</span><span>とても強い</span></div>
<div class="meal-scale" role="group" aria-label="もっと食べたい気持ちの強さ">
  <button type="button" aria-pressed="false" data-v="0">0</button>
  … 0〜10 の11個 …
</div>
```
- 6列グリッドで2段（0-5 / 6-10）。各ボタン最小 44×44px。
- **スライダー（`input[type=range]`）は使わない。** 片手・精密操作不可の前提。
- 選択済みは `aria-pressed="true"` + cyan 反転。
- 色に「良い/悪い」の意味を持たせない（全部同じ色。選択中だけ cyan）。

### 9.3 `renderMealWaitBar(remainMs)` — 待機バー

```html
<!-- 待機中 -->
<div>⏳ あと 4:12</div>
<div class="meal-wait-actions">
  <button>💧水</button><button>🍽片づけ</button>
  <button>✅落ち着いた</button><button>🍚まだ食べたい</button>
</div>
<!-- 到達後（class に done を追加） -->
<div>⏳ 5分たちました</div><button class="btn btn-p btn-sm btn-full">答える</button>
```
- 表示/非表示は `#mealWaitBar.classList.toggle('show', …)` と `document.body.classList.toggle('meal-waiting', …)` を**必ずセットで**行う（`#app` の下余白）。
- `💧水` `🍽片づけ` を押しても**バーは消えない**。`waits[last].actions` に追記して `toast()` のみ。
- `✅落ち着いた` → `endMealWait('calm')`、`🍚まだ食べたい` → `endMealWait('still_hungry')`。どちらも `afterWait` 入力へ。

### 9.4 `renderMealStart()` — `scr-meal` の開始セクション

```
何を食べる？
🍗 名前                                  [ はじめる ]   ← useCount 降順、builtin は最後
…
┌──────────────────────────────────────┐
│ ✏️ 自由入力ではじめる                  │   ← 押すとインライン入力欄が開く
└──────────────────────────────────────┘
[ 定番の食事をつくる ]   ← builtin以外のテンプレが0件のときだけ表示
テンプレを編集 →         ← openManage('mealTemplates') で記録タブへ
```

**自由入力（`prompt()` は使わない）**: `[✏️ 自由入力ではじめる]` を押すと、その場に
`<input type="text" maxlength="60" placeholder="何を食べる？（例：コンビニ弁当）">` + `[はじめる]` が展開される。
`startFreeMealSession(name)` → `label = name`、`templateId = null`、`items = []`、`effortLevel = ''`。
入力欄は `onkeydown="submitShortcut(event, …)"` を付ける（既存の IME安全な Cmd/Ctrl+Enter パターン、`index.html:1199`）。

**`openManage()` の拡張**（`index.html:1028`）: `section === 'mealTemplates'` のとき `#mealTemplateManageCard` へ `scrollIntoView`。既存の `'memos'` / `'moods'` と同じ形。

`[ 定番の食事をつくる ]` は以下をローカル生成する（**コードに直書きするのはこの関数の中だけ**。設計書 §23-3）:
```js
function createPersonalMealTemplates(){
  const now = Date.now();
  const mk = (name, emoji, items, effort) => ({
    id: uid(), name, emoji, items, effortLevel: effort,
    builtin: false, useCount: 0, lastUsedAt: 0,
    createdAt: now, updatedAt: now, deletedAt: null
  });
  D.mealTemplates.push(
    mk('鶏胸肉＋主食＋ほうれん草','🍗',
       [{name:'鶏胸肉',amount:''},{name:'主食',amount:''},{name:'冷凍ほうれん草',amount:''}],'microwave'),
    mk('鶏胸肉＋めかぶ＋ゆで卵','🥚',
       [{name:'鶏胸肉',amount:''},{name:'めかぶ',amount:''},{name:'ゆで卵',amount:''}],'none')
  );
  save(); renderMeal(); toast('🍽 定番の食事を作りました');
}
```

### 9.5 `renderMealTemplateManager()` — 記録タブ

**既存の「🌱 チェックリスト項目を管理」（`renderHabitManager()`, `index.html:1453`）を丸ごと手本にする。** 行の構造・編集の開閉（`mealState.tplEditId` によるトグル）・`twoTap` 削除まで同じ形にすること。

```html
<div class="card" id="mealTemplateManageCard">
  <h2>🍽 食事テンプレを管理</h2>
  <p class="muted">「はじめる」を押したときの初期内容になります。品目や量は「✏️ 編集」から設定できます。</p>
  <div id="mealTemplateManageList" style="margin-top:6px"></div>
  <div class="habit-add">
    <input type="text" id="mealTplInput" maxlength="60" placeholder="食事テンプレを追加"
           onkeydown="submitShortcut(event,addMealTemplate)">
    <button class="btn btn-c btn-sm" type="button" onclick="addMealTemplate()">＋ 追加</button>
  </div>
</div>
```

- **追加**: 名前だけで作れる（`addMealTemplate()`）。作成後は `mealState.tplEditId` にセットしてエディタを開く（`addHabit()` が `habitEditId` にセットするのと同じ、`index.html:1376`）。
- **編集**: 絵文字（`maxlength=8`）／名前（`≤60`）／手間レベル（`<select>`）／品目リスト（追加・削除。`.step-lib-items` のパターン）。
- **削除**: `twoTap(btn,'削除？',…)` → **論理削除**。トースト `🗑 テンプレを削除しました（過去の記録は残ります）`。
- **`builtin:true` を編集して保存した場合**: 元の builtin はそのまま残し、`builtin:false` のコピーを新規作成する。トースト `💾 食事テンプレを保存しました`。
- **同梱テンプレも削除できる。** 削除後にリロードしても復活しない（同梱の生成は `migrateData()` の `from < 2` ブロック内でのみ実行され、初回移行の1回きりのため）。
- テンプレが**0件でも動作すること**。`renderMealStart()` は `✏️ 自由入力ではじめる` を必ず出す。

### 9.6 `#mealPrefsCard` — 設定タブ

```html
<div class="card" id="mealPrefsCard">
  <h2>🍽 食事サポート</h2>
  <div class="field"><label>待機の既定時間</label>
    <select id="setMealWait" onchange="saveSettings()">
      <option value="300">5分</option><option value="600">10分</option>
    </select></div>
  <div class="field"><label><input type="checkbox" id="setMealSpeak" onchange="saveSettings()" style="width:auto;margin-right:6px">待機の終わりを読み上げる</label></div>
  <div class="field"><label><input type="checkbox" id="setMealCsv" onchange="saveSettings()" style="width:auto;margin-right:6px">食事の記録をChatGPT用CSVに含める</label></div>
  <div class="field"><label><input type="checkbox" id="setMealCsvItems" onchange="saveSettings()" style="width:auto;margin-right:6px">品目名も含める</label></div>
  <div class="field"><label><input type="checkbox" id="setMealCsvNotes" onchange="saveSettings()" style="width:auto;margin-right:6px">自由記述メモも含める</label></div>
  <div class="field"><label><input type="checkbox" id="setMealTimeline" onchange="saveSettings()" style="width:auto;margin-right:6px">24時間タイムラインに食後・待機後も表示する</label></div>
  <p class="muted">☁️ 同期をONにすると、食事の記録（内容・数値・タグ・メモ）もGoogle Driveに保存されます。</p>
  <button class="btn btn-g btn-sm" onclick="twoTap(this,'⚠️ ほんとに削除？',deleteAllMealSessions)">食事の記録だけ削除</button>
</div>
```

**`mealPrefs` は `D.settings` ではなく `D.mealPrefs` に保存すること**（`settings` は同期対象外の項目が混在しており、`syncDataForCloud()` の削除リストと紛らわしいため）。ただし `renderSet()` / `saveSettings()` からの読み書きは既存パターンに合わせる。

### 9.7 同期カードへの追記

`index.html:608-609` の `<p class="muted">` の直後に1文を足す:
> 食事の記録（内容・数値・タグ・メモ）も同期対象に含まれます。

---

## 10. 既存関数から再利用する部分

| 既存関数 | 呼び出し場所 | 注意 |
|---|---|---|
| `uid()` | 全ID生成 | |
| `save()` | データ変更のたび | `updatedAt` 更新 + 4秒後の自動プッシュが付いてくる |
| `esc(s)` | **すべての** `innerHTML` 埋め込み | **属性値は必ずダブルクォート**。`esc()` は `'` を変換しないため `title='…'` は禁止 |
| `toast(msg)` | 各種フィードバック | |
| `twoTap(btn, label, fn)` | 削除・破壊的操作の確認 | `confirm()` の代替 |
| `speak(text, cb)` | 待機終了のみ | `run` が非nilかつ非pausedなら**呼ばない** |
| `poan(freq, dur, vol)` | 待機終了の音 | `poan(660, .3, .12)` 程度。**`sfxDone()` / `sfxJackpot()` は使わない** |
| `beep(freq, dur, type, vol)` | ボタンの微細音 | 既存のグローバル `pointerdown` ハンドラ（`index.html:2489`）が自動で鳴らすので、追加は基本不要 |
| `showScreen(id)` | `scr-meal` への遷移 | |
| `activityTimeLabel(stamp)` | 「今日 18:32」 | |
| `localDateKey(d)` | 日付キー | |
| `stepDurationLabel(sec)` | 秒→「5分」 | 待機時間の表示に流用可 |
| `csvEsc(v)` / `timelineCsvEsc(v)` / `download(name, content, type)` | CSV出力 | `timelineCsvEsc` は数式インジェクション対策込み。**食事CSVでも必ず使う** |
| `renderHome()` | 状態変更後の再描画 | 重いので、カードだけ更新できるときは `renderMealCard()` を使う |
| `enableDrag(container, sel, commit)` | （MVPでは不使用） | テンプレ並べ替えは第2段階 |
| `@media (prefers-reduced-motion:reduce)`（`index.html:32`） | 自動適用 | 追加対応不要 |

**再利用してはいけないもの**: `run` / `timer` / `tick()` / `loadStep()` / `advanceRunClock()` / `confetti()` / `burst()` / `slamIn()` / `xpPop()` / `jackpot()` / `sfxDone()` / `sfxSlam()` / `sfxJackpot()` / `sendNotion()` / `calAddEvent()` / `aiCall()`

---

## 11. 新規関数の一覧

### [1] 定数・デフォルト

| 名前 | シグネチャ | 責務 |
|---|---|---|
| `MEAL_TAGS` | `const [{id,label}]` | 原因タグ13種（設計書 §14.1 のTagId表） |
| `MEAL_EFFORTS` | `const [{id,label}]` | `none:何もしたくない` / `microwave:レンジだけ` / `pan:フライパン` / `cook:少し料理` |
| `MEAL_CHANGES` | `const [{id,label,emoji}]` | `eased:落ち着いた😌` / `slightly:少し落ち着いた🙂` / `same:変わらない😐` / `stronger:強くなった😖` |
| `MEAL_WAIT_ACTIONS` | `const [{id,label}]` | `water:💧水` / `dishes:🍽片づけ` / `tea:🍵お茶` / `walk:🚶歩く` / `other:その他` |
| `builtinMealTemplates()` | `→ MealTemplate[]` | 汎用4件（設計書 §16）。**個人テンプレは含めない** |
| `defaultMealPrefs()` | `→ MealPrefs` | 設計書 §14.4 の既定値 |

### [2] 正規化

| 名前 | シグネチャ | 責務 |
|---|---|---|
| `normalizeMealSession(s)` | `→ MealSession` | 欠損補完・型検証・文字数制限 |
| `normalizeMealTemplate(t)` | `→ MealTemplate` | 同上 |
| `normalizeFoodRule(r)` | `→ FoodRule` | 同上 |
| `normalizeMealItem(i)` | `→ Item` | `{name:≤40, amount:≤20}` |
| `normalizeMealWait(w)` | `→ Wait` | `endsAt` が無ければ `startedAt + plannedSec*1000` で補完 |
| `mealScore(v)` | `→ 0..10 \| null` | `Number.isInteger && 0<=v<=10`。**`0` を落とさない** |
| `purgeMealTombstones(d)` | `→ void` | 60日超の墓標を物理削除 |

### [3] データ操作

| 名前 | シグネチャ | 責務 |
|---|---|---|
| `activeMealSession()` | `→ MealSession \| null` | `status !== 'closed'` かつ `!deletedAt` の**最新1件**。2件以上あれば最新以外を `closed` にして自己修復 |
| `activeWait()` | `→ Wait \| null` | アクティブセッションの `waits[waits.length-1]` で `completedAt === null` のもの |
| `touchMeal(s)` | `→ void` | `s.updatedAt = Date.now()` の後 `save()` |
| `startMealSession(templateId)` | `→ MealSession` | 既存アクティブがあれば呼び出し元で分岐済みの前提。`status:'eating'`、`startedAt:now`、テンプレから `label`/`items`/`effortLevel` を**複製**。テンプレの `useCount++`/`lastUsedAt` 更新 |
| `startMealSessionSameAsLast()` | `→ MealSession` | 直近の `closed`（かつ `!deletedAt`）セッションの `templateId`/`label`/`items`/`effortLevel` を複製 |
| `startFreeMealSession(name)` | `→ MealSession` | 自由入力で開始。`label = name.trim().slice(0,60)`、`templateId = null`、`items = []`、`effortLevel = ''`。空文字なら `toast('何を食べるか入力してね')` で中断 |
| `addMealTemplate()` | `→ void` | `#mealTplInput` から名前を読み、テンプレ新規作成 → `mealState.tplEditId` にセット → `renderMealTemplateManager()`。`addHabit()`（`index.html:1372`）と同じ形 |
| `saveSessionAsTemplate(sessionId)` | `→ void` | 履歴行／食事中カードの `[＋テンプレに保存]`。そのセッションの `label`/`items`/`effortLevel` からテンプレを作る。**同名（`name` が一致し `!deletedAt`）のテンプレが既にあれば何もせず** `toast('🍽 「{名前}」は登録済みです')` |
| `setMealBefore(field, v)` | `→ void` | `before` を必要なら生成し `hunger`/`sleepiness`/`stress` を `mealScore()` で設定 |
| `endMealEating()` | `→ void` | `endedAt = now`。`status` は `'eating'` のまま。`view='afterMeal'` |
| `setAfterMealUrge(v)` | `→ void` | `afterMeal = {urge: mealScore(v), tags:[], at: now}` |
| `startMealWait(sec)` | `→ void` | `waits.push({id:uid(), plannedSec:sec, startedAt:now, endsAt:now+sec*1000, completedAt:null, endedBy:null, actions:[]})`、`status='waiting'`、`startMealWaitTimer()` |
| `addWaitAction(actionId)` | `→ void` | `waits[last].actions` に重複なく追記 |
| `endMealWait(endedBy)` | `→ void` | `completedAt=now`、`endedBy`、`status='eating'`（再評価待ち）、`stopMealWaitTimer()`、`view='afterWait'` |
| `setAfterWaitUrge(v)` | `→ void` | `afterWait` を生成/更新 |
| `setMealChange(changeId)` | `→ void` | `afterWait.change` |
| `toggleMealTag(target, tagId)` | `→ void` | `target` は `'afterMeal'` \| `'afterWait'`。配列をトグル |
| `setMealExtra(ate, when)` | `→ void` | `extra = {ate, when, items:[], at:now}` |
| `addExtraItem(name)` | `→ void` | `extra.items` に追記（重複なし） |
| `closeMealSession()` | `→ void` | `status='closed'`、`stopMealWaitTimer()`、`view='idle'`、`toast('📗 今回の食事を記録しました')` |
| `deleteMealSession(id)` | `→ void` | **論理削除**: `deletedAt`/`updatedAt` を設定し `items=[]` `note=''` `before/afterMeal/afterWait/extra` の `tags` を空に |
| `deleteAllMealSessions()` | `→ void` | 全件を論理削除。テンプレ・ルールは残す |
| `addFoodRule(text)` / `deleteFoodRule(id)` / `toggleFoodRulePin(id)` | | 自分ルールのCRUD（論理削除） |
| `createPersonalMealTemplates()` | | §9.4 |
| `saveMealTemplate(id, patch)` / `deleteMealTemplate(id)` | | テンプレのCRUD。`builtin` の編集はコピーを作る |

### [4] タイマー

| 名前 | シグネチャ | 責務 |
|---|---|---|
| `mealWaitRemainMs()` | `→ number` | `Math.max(0, activeWait().endsAt - Date.now())`。**経過を積み上げない** |
| `startMealWaitTimer()` | `→ void` | `stopMealWaitTimer()` → 即 `mealWaitTick()` → `setInterval(mealWaitTick, 1000)` を `mealState.waitTimer` に |
| `stopMealWaitTimer()` | `→ void` | `clearInterval` + `null` 代入 |
| `mealWaitTick()` | `→ void` | 残り時間を計算 → `renderMealWaitBar()` → `0` なら `onMealWaitFinished()` |
| `onMealWaitFinished()` | `→ void` | `stopMealWaitTimer()`、バーを `done` 表示に、`toast('⏳ 5分たちました')`、`D.mealPrefs.soundOnWaitEnd && poan(660,.3,.12)`、`D.mealPrefs.speakOnWaitEnd && !(run && !run.paused) && speak('…')` |
| `resumeMealWait()` | `→ void` | `visibilitychange`/`focus`/`pageshow` から呼ぶ。アクティブな待機があれば `mealWaitTick()` を即実行し、タイマーが止まっていれば張り直す |
| `restoreMealState()` | `→ void` | 起動時に1回。設計書 §18.3 の復元テーブルを実装。**`endsAt` を過ぎていた場合は音も読み上げも出さない** |

**イベント登録**（食事ブロックの末尾に置く）:
```js
document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) resumeMealWait(); });
window.addEventListener('focus',   resumeMealWait);
window.addEventListener('pageshow', resumeMealWait);
```

### [5] 描画

| 名前 | 責務 |
|---|---|
| `renderMealCard()` | ホーム `#mealCard`。`renderHome()` から呼ぶ |
| `renderMeal()` | `scr-meal` 全体。`showScreen('scr-meal')` から呼ぶ |
| `renderMealRules()` / `renderMealActive()` / `renderMealStart()` / `renderMealHistory()` | `scr-meal` の各セクション |
| `renderMealWaitBar(remainMs)` | 待機バー。`show`/`done` クラスと `body.meal-waiting` を制御 |
| `renderMealTemplateManager()` | 記録タブ。`renderManage()` から呼ぶ |
| `mealScaleHtml(current, handlerName)` | 0-10ボタンのHTML文字列 |
| `mealTagsHtml(target, selected)` | タグチップのHTML文字列 |
| `mealSessionSummary(s)` | `食後8 → 5分 → 4 追加なし` の1行文字列 |

### [6] 出力

| 名前 | 責務 |
|---|---|
| `mealTimelineItems(cutoff, now)` | `renderActivityTimeline()` 用の `{kind,icon,label,text,stamp}` 配列 |
| `mealTimelineRows()` | `chatgptTimelineRows()` 用の行配列 |
| `buildMealCsv()` | 食事専用CSVの文字列 |
| `exportMealCsv()` | `download('meal_sessions.csv', buildMealCsv())` |

### [7] 同期

| 名前 | 責務 |
|---|---|
| `mergeMealCollections(local, remote)` | 設計書 §21.2 のコードそのまま。`remote` を破壊的に更新 |

---

## 12. 同期データへの追加（C6）

### 12.1 `syncDataForCloud()` — 変更不要

`JSON.parse(JSON.stringify(D))` なので、`D.mealSessions` 等は自動で含まれる。**GAS側の変更は一切不要。**

### 12.2 `syncPull()` にマージを挿入

`index.html:2241-2244` を以下にする。**`syncPull()` 本体に確認処理は入れない**（自動プル経路が依存しているため）。手動プルの保護は §12.3 のラッパーで行う。

```js
const remote = j.data;
if(auto && (remote.updatedAt||0) <= (D.updatedAt||0)) return;
const localSync = {syncUrl:D.settings.syncUrl, syncKey:D.settings.syncKey,
                   autoSync:D.settings.autoSync, apiKey:D.settings.apiKey};
mergeMealCollections(D, remote);        // ★ D = normalizeData(remote) の直前に置く
D = normalizeData(remote);
D.settings = Object.assign(D.settings, localSync);
localStorage.setItem(KEY, JSON.stringify(D));
stopMealWaitTimer(); restoreMealState();   // ★プルで待機状態が変わりうるので再構築
renderHome(); toast('⬇️ クラウドから取得しました');
```

### 12.3 手動プルの2度押し確認

`confirmedOlderPull` のようなグローバルフラグは使わない。**ボタン側で `twoTap` する**:

`index.html:606` を
```html
<button class="btn btn-c btn-sm" onclick="syncPullSafe(this)">⬇️ 今すぐ取得</button>
```
に変え、食事ブロック外（同期セクション）に追加:
```js
async function syncPullSafe(btn){
  const url=(D.settings.syncUrl||'').trim();
  if(!url){toast('⚠️ 設定で同期URLを入力してね');return;}
  try{
    const res=await fetch(url+'?key='+encodeURIComponent((D.settings.syncKey||'').trim()));
    const j=await res.json();
    if(!j.ok||!j.data){syncPull();return;}          // エラー時は従来経路にまかせる
    if((j.data.updatedAt||0) < (D.updatedAt||0)){
      twoTap(btn,'⚠️ 古いです。もう一度で上書き', ()=>syncPull());
      return;
    }
  }catch(e){}
  syncPull();
}
```
`syncPull()` 本体は従来どおり無条件上書きのまま残す（自動プル経路が依存しているため）。

### 12.4 ペイロードサイズ警告

`syncPush()` の `fetch` 直前に3行:
```js
const payload = JSON.stringify({key, data:syncDataForCloud(),
  timelineFileName:'routine_timeline.csv', timelineCsv:buildChatGPTTimelineCsv()});
if(payload.length > 2*1024*1024 && !silent) toast('⚠️ データが大きくなっています（'+Math.round(payload.length/1048576)+'MB）');
const res = await fetch(url,{method:'POST',headers:{'Content-Type':'text/plain'},body:payload});
```

---

## 13. CSVへの追加（C5）

### 13.1 ChatGPT用CSV（列は増やさない）

`chatgptTimelineRows()`（`index.html:2442`）の `return rows.sort(...)` の**直前**に1行:
```js
if(D.mealPrefs && D.mealPrefs.includeInChatGptCsv) rows.push(...mealTimelineRows());
```

`mealTimelineRows()` が返す行の形（既存と同じ `{stamp,dateTime,type,content,routine,step,detail}`）:

| type | content | detail の組み立て |
|---|---|---|
| `食事` | `s.label` | `食前空腹{n}` `眠気{n}` `ストレス{n}`（入力済みのみ）／ `品目:名前 量,…`（`csvIncludeItems`）／ `手間:{label}` を `／` で連結 |
| `食後の状態` | `もっと食べたい {urge}` | `食事から{n}分` ／ `タグ:{ラベル,…}` or `タグ:なし` |
| `待機` | `{n}分待った` | `行動:{ラベル,…}` ／ `終了:時間到達 or 自分で終了` |
| `待機後の状態` | `もっと食べたい {urge}` | `変化:{ラベル}` ／ `タグ:…` |
| `追加で食べた` | `{品目,…}` or `（内容は未記録）` | `タイミング:待機前 or 待機後` |

- `ルーチン` / `ステップ` 列は常に `''`。
- `dateTime` は既存の `timelineDateTime(stamp)` を使う。
- `deletedAt` 付きセッションは除外。
- `csvIncludeNotes` が真かつ `note` が空でなければ、`食事` 行の `detail` 末尾に `／メモ:{note}` を足す。

### 13.2 食事専用CSV

```js
function buildMealCsv(){
  const head = ['開始日時','終了日時','食事時間分','内容','手間','食前空腹','食前眠気','食前ストレス',
    '食後の欲求','食後タグ','待機回数','待機予定分','待機実績分','待機中の行動',
    '待機後の欲求','欲求の変化','待機後タグ','追加で食べた','追加の内容','メモ'];
  const lines = [head.join(',')];
  const list = D.mealSessions.filter(s=>!s.deletedAt).sort((a,b)=>(a.startedAt||0)-(b.startedAt||0));
  for(const s of list) lines.push([ /* 20列 */ ].map(timelineCsvEsc).join(','));
  return lines.join('\n');
}
```
- **内部IDは含めない。**
- 数値未入力は空欄。`0` は `0`（空欄と区別する）。
- タグ・行動・品目は `／` 区切りの日本語ラベル。
- `追加で食べた` は `あり` / `なし` / 空欄（未回答）。
- `timelineCsvEsc()` を通す（数式インジェクション対策）。

---

## 14. バックアップへの追加

| 関数 | 変更 |
|---|---|
| `backupAll()`（`index.html:2477`） | **変更不要** |
| `restoreAll()`（`index.html:2478`） | C1 で `normalizeData()` 化済み。**追加変更不要** |
| `resetAll()`（`index.html:2484`） | **変更不要**（C2 で `seed()` に食事キーを足せば自動的に正しい） |

**ただし `resetAll()` の後に `stopMealWaitTimer()` を呼ぶこと**（待機中に初期化されたらタイマーが宙に浮く）:
```js
function resetAll(){ stopMealWaitTimer(); D=seed(); save(); renderHome(); toast('🧹 初期化しました'); }
```

---

## 15. エラー処理

| 状況 | 挙動 |
|---|---|
| `activeMealSession()` が2件以上見つかった | 最新1件だけ残し、他は `status='closed'` にして `touchMeal()`。トーストは出さない（自己修復） |
| `activeWait()` が `null` なのに `status==='waiting'` | `status='eating'` に戻し `view='afterMeal'` へ。`stopMealWaitTimer()` |
| `endsAt` が `startedAt` より前 / `NaN` | `normalizeMealWait()` で `startedAt + plannedSec*1000` に再計算 |
| `startedAt` が未来 | そのまま扱う（端末時計のずれ。補正しない） |
| `mealSessions` が1000件超 | `migrateData()` が古い順に切り捨て |
| `localStorage` の書き込み失敗（容量超過） | 既存 `save()` に例外処理がない。**食事機能では新たに握りつぶさない**（既存の挙動を変えない）。ただし `mealSessions` の上限で予防する |
| `speak()` が失敗 | 既存の `speak()` が `try/catch` 済み |
| `poan()` が失敗（AudioContext未解禁） | 既存が `try/catch` 済み。iOSではユーザー操作前に鳴らないのが正常 |
| 待機終了時に `run` が実行中 | 読み上げを抑止。音とバーの `done` 表示のみ |
| テンプレが削除済み（`templateId` が解決できない） | セッションの `label`/`items` はスナップショットなので**表示に影響しない**。`[前回と同じ]` はスナップショットから複製する |
| `mealPrefs` が `undefined`（旧データ） | `migrateData()` が `Object.assign(defaultMealPrefs(), …)` で補完 |
| `#mealWaitBar` が DOM に無い（HTML挿入漏れ） | `renderMealWaitBar()` の先頭で `if(!el)return;`（既存 render 関数と同じ防御） |

**全体方針**: 例外で機能を止めない。データが壊れていたら正規化で直し、直せなければそのセッションを `closed` にして先へ進む。**ユーザーに「エラーです」を見せない。**

---

## 16. 手動テストシナリオ

各コミット後に実施。**Mac（Safari または Chrome）と iPhone Safari の両方**で。

### C1 後
1. 既存データのある端末で開く → コンソールエラーゼロ、ホームの表示が従来どおり
2. ルーチンを1本完走 → リザルトまで従来どおり
3. JSONバックアップ → 復元 → データが戻る
4. `localStorage.rvt_v1` に `schemaVersion:2` が入っている

### C2 後
5. 開く → 画面に変化なし、コンソールエラーゼロ
6. `JSON.parse(localStorage.rvt_v1)` に `mealSessions:[]` `mealTemplates:[4件]` `foodRules:[]` `mealPrefs:{…}` がある
7. 全データ初期化 → 再度6を確認

### C3 後
8. ホームの**ひとことメモ直下**に食事カードが見える。チェックリストは食事カードの下。チェック項目を10件にしても食事カードの位置が変わらず、スクロールなしで見える
9. `[はじめる]` → `scr-meal` → テンプレを選ぶ → 食事中表示になる
9b. `[✏️ 自由入力ではじめる]` → 「コンビニ弁当」→ 開始 → `label==='コンビニ弁当'`、`templateId===null`。**`prompt()` が出ない**
9c. 自由入力で始めた食事中カードに `[＋テンプレに保存]` が出る。押すとテンプレが1件増える
9d. 履歴行の `[＋テンプレに保存]` でテンプレが増える。もう一度押すと「登録済みです」で増えない
9e. 記録タブ → 名前を入れて `[＋ 追加]` → エディタが開く → 品目2件と絵文字を設定 → 保存 → `scr-meal` の一覧に出る
9f. 同梱テンプレを編集して保存 → `builtin:false` のコピーができ、元の builtin も残っている
9g. テンプレを全件削除 → リロード → **復活しない**。`✏️ 自由入力ではじめる` で食事を開始できる
9h. 使用済みテンプレを削除 → 過去の履歴の表示名・品目が変わらない
10. `[🍽 食べ終わった]` → 0〜10 が出る → `8` をタップ → 待機提案
11. `[いまは終える]` → `closed`。「最近の食事」に1件出る
12. `[前回と同じ]` の1タップで開始できる（画面遷移しない）
13. 食後の欲行に `0` を選ぶ → `afterMeal.urge === 0`（`null` でない）
14. 二重開始: 進行中に `[前回と同じ]` → `[先の食事を終える][続ける]` が出る
15. 品目名に `<img src=x onerror=alert(1)>` → 文字列として表示される

### C4 後
16. 食後8 → `[5分待つ]` → 待機バーが出る
17. ホーム/進捗/記録/設定 に切り替えても待機バーが見える
18. ルーチンを開始 → `#run` の上に待機バーが見え、`#run` のボタンを隠さない
19. `[💧水]` → トーストが出てバーは消えない。`waits[0].actions` に `'water'`
20. **リロード** → 待機バーが復元、残り時間が正しい（±2秒）
21. `[✅落ち着いた]` → `afterWait` 入力へ。`waits[0].endedBy === 'calm'`
22. 待機を最後まで待つ → 音 + 読み上げ + `[答える]`
23. ルーチン実行中に待機終了 → **読み上げなし**、音とバーの点滅のみ
24. 「変わらない」を選ぶ → `[追加で食べる][次回は増やす][もう5分待つ][終える]`
25. `[もう5分待つ]` → `waits.length === 2`
26. `[追加で食べる]` → 品目チップ → `[記録して終える]` → `extra.ate === true`
27. 原因タグを開かずに完了できる
28. 開発者ツールで `startedAt` を7時間前に書き換え → リロード → 確定の提案が出る
29. `endsAt` を過去に書き換え → リロード → 「待機時間は終わっています」。**音は鳴らない**

### C5 後
30. 24hタイムラインに食事が最大4行で出る
31. `mealPrefs.showTimelineDetail` OFF → 「食事」行だけになる
32. ChatGPT用CSV → ヘッダが `日時,種類,内容,ルーチン,ステップ,詳細` のまま
33. `includeInChatGptCsv` OFF → CSVから食事行が消える
34. `csvIncludeItems` OFF → `詳細` から `品目:` が消える
35. `[🍽 食事CSV]` → `meal_sessions.csv` が落ちる。内部IDを含まない
36. メモに `=1+1` → CSVで `'=1+1`
37. 記録タブでテンプレを編集・削除できる。builtin編集でコピーが作られる
38. 履歴から1件削除 → 一覧・タイムライン・CSVから消える。`D.mealSessions` には `deletedAt` 付きで残る

### C6 後
39. §17 の同期シナリオを実施

### 全コミット後の文言レビュー
40. 全画面を目視。以下を grep して**ヒットゼロ**:
```bash
grep -n -E "我慢|成功|失敗|食べすぎ|意志|違反|ルールを破|ダメ|悪い食事|達成率" index.html
```
41. 食事ブロック内に禁止シンボルが無いことを確認:
```bash
awk '/MEAL SUPPORT ====/,/MEAL SUPPORT END/' index.html | grep -n -E "D\.xp|D\.combo|D\.logs|confetti|burst\(|sfxJackpot|sfxDone|slamIn|xpPop|jackpot\(|sendNotion|calAddEvent|aiCall"
```

### 構文チェック（毎コミット前）
```bash
node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const m=h.match(/<script>([\s\S]*)<\/script>/);new Function(m[1]);console.log('syntax OK')"
```

---

## 17. Macでの確認手順

```bash
cd /Users/haruka/Downloads/ルーチンタイマー && python3 -m http.server 8765
```
→ `http://localhost:8765/` を Safari と Chrome で開く。

**確認項目**
1. Safari の Web Inspector（開発 → ローカルホスト）でコンソールエラーゼロ
2. ウィンドウ幅を **375px** に絞り、全ボタンが折り返さないこと（Chrome の Device Toolbar でも可）
3. 「アクセシビリティ → 視差効果を減らす」を ON → 食事UIのアニメーションが止まる
4. `localStorage` の中身を Web Inspector の Storage タブで確認
5. **実データでのテストは、必ず先に `[全データJSONバックアップ]` を取ってから行う**

**注意**: `file://` で開くと `fetch` が CORS で失敗し、同期・カレンダーがテストできない。必ず HTTP サーバー経由で開く。

---

## 18. iPhoneでの確認手順

### 18.1 デプロイなしで試す（推奨。まずこれ）

Mac と iPhone を同じ Wi-Fi に置き、Mac で:
```bash
ipconfig getifaddr en0
```
→ 表示された IP を使って iPhone Safari で `http://<IP>:8765/` を開く。

**制約**: `localStorage` は本番URL（`itwrk.github.io`）とは別オリジンなので、**実データは入っていない**。純粋な動作確認用。

### 18.2 本番で試す

`git push` が必要。**push は Hal の明示的な許可を得てから行う**（CLAUDE.md 作業フロー 4）。反映は1〜2分後。

### 18.3 iPhone 固有の確認項目

| # | 確認 |
|---|---|
| 1 | 幅375px（iPhone SE/13 mini 相当）で待機バーの4ボタンが1行に収まる |
| 2 | 待機バーが**タブバーに重ならない**（`bottom` の safe-area 計算） |
| 3 | 待機バー表示中、ホームの一番下（活動タイムライン）までスクロールしてもバーに隠れない（`body.meal-waiting` の `padding-bottom`） |
| 4 | ルーチン実行中に待機バーが `#run` の下部ボタンを隠さない |
| 5 | **音声**: 一度ボタンを押した後、待機終了の読み上げが鳴る（iOSはユーザー操作前に音が出ない） |
| 6 | **画面ロック**: 待機開始 → 画面ロック → 待機時間より長く放置 → 解除 → 「待機時間は終わっています」+ `[答える]`。**音は鳴らない** |
| 7 | **バックグラウンド**: 待機中に別アプリへ → 3分後に戻る → 残り時間が正しく減っている |
| 8 | **タブ破棄**: 待機中に Safari のタブを大量に開いてメモリ圧迫 → 戻る（`pageshow` での復元） |
| 9 | **アプリ内ビューア**（LINE/Twitter等から開いた場合）: 画面上部がバーに隠れても、食事の操作が画面中〜下部でできる |
| 10 | ソフトキーボード表示中に待機バーが浮き上がって邪魔にならない |
| 11 | 0-10 ボタンが片手の親指でタップできる大きさ（44px以上） |

---

## 19. 既存データを使った回帰テスト

**前提: 開始前に必ず実データのバックアップを取る。**
本番（`https://itwrk.github.io/routine-timer/`）の設定 → `[全データJSONバックアップ]` → `rvt_backup.json` を安全な場所へ。

その JSON を、ローカルの `http://localhost:8765/` で `[JSON復元]` して以下を通す。

| ID | 項目 | 期待 |
|---|---|---|
| G1 | ルーチン実行（カウントダウン） | 開始→読み上げ→半分経過→ラスト10秒→時間到達→自動で次へ→完走→リザルト |
| G2 | ルーチン実行（カウントアップ） | モード切替→手動で次へ→実行中のステップ追加（`addRunStep`）→完走 |
| G3 | XP・コンボ・ジャックポット | 従来どおり発生。`xpPop` が出る |
| G4 | **ストリーク** | 食事を3件記録しても `hStreak` の数値が変化しない |
| G5 | **ヒートマップ** | 食事を記録しても進捗タブのセルが濃くならない |
| G6 | 共有ステップ | 🔗共有ステップを編集 → 他ルーチンにも反映 |
| G7 | チェックリスト | 毎日／今日だけ／曜日指定／日付指定／時間帯指定が従来どおり |
| G8 | 気分・メモ・音声入力 | 従来どおり。24hタイムラインに出る |
| G9 | Googleカレンダー | 「今後の予定」が出る。ルーチン完了で記録される。**食事ではイベントが作られない** |
| G10 | Notion Webhook | ルーチン完走時のみPOST。**食事ではPOSTされない**（Web Inspector の Network で確認） |
| G11 | AI生成 | ステップテキスト・ひとことの生成が従来どおり。**リクエストボディに食事データが含まれない** |
| G12 | CSV各種 | テキスト／ログ／チェックリストのCSVが従来と同じ列・内容 |
| G13 | JSONバックアップ・復元 | ラウンドトリップでデータが変わらない（食事キーの追加を除く） |
| G14 | 全データ初期化 | `seed()` 後も食事機能が動く。待機タイマーが残らない |
| G15 | ルーチン中断（`endRun`） | ログに残らない。待機中なら待機は継続する |
| G16 | 実データでの起動 | コンソールエラーゼロ。ルーチン数・メモ数・ログ数が復元前と一致 |

**特に注意**: G4 / G5 / G10 / G11 は「食事が既存のゲーミフィケーション・外部送信に漏れ出していないか」の検証であり、**これが失敗したらリリースしない**。

---

## 20. 完成条件

`docs/food-support-design.md` §29「受け入れ条件」の **A1〜A17 / B1〜B5 / C1〜C6 / D1〜D5 / E1〜E10 をすべて満たす。**

加えて、本書の観点で:

- [ ] `git diff` の変更が `index.html`（+ `CLAUDE.md` / `AGENTS.md` の追記）のみ
- [ ] `.nojekyll` が存在する
- [ ] `PRESET_SYNC.key` が `''`
- [ ] `prompt` / `confirm` / `alert` を追加していない
- [ ] 食事コードが `/* ==== 🍽 MEAL SUPPORT ==== */` 〜 `END` の**1ブロックに収まっている**（§6.3 の既存関数への差し込みを除く）
- [ ] 裸のグローバル変数が `mealState` 1つだけ増えている
- [ ] §16-41 の grep がヒットゼロ
- [ ] §16 の構文チェックが通る
- [ ] §19 の G1〜G16 がすべて通る
- [ ] index.html の行数が **4500行未満**（超えたら設計書 §8-3 の撤退線に到達。Halに報告して外部ファイル化を相談する）

---

## 21. 補足: 実装時に迷いやすい点

| 迷い | 決定 |
|---|---|
| `0` と未入力の区別 | `mealScore()` を必ず通す。`v \|\| null` は**禁止**（`0` が消える） |
| 待機の残り時間 | **必ず `endsAt - Date.now()`**。`remain--` のような累積は禁止 |
| 削除 | **必ず論理削除**（`deletedAt`）。`filter` で配列から消さない（同期で復活する） |
| `label` をテンプレ参照にするか | **しない。** セッション作成時にテンプレ名を複製する（テンプレを消しても履歴が壊れない） |
| 「食べ終わった」後の `status` | `'eating'` のまま。`'waiting'` になるのは待機を開始したときだけ。`'closed'` は明示的に終えたときだけ |
| 待機終了後の `status` | `'eating'` に戻す（＝再評価待ち）。ここで `'closed'` にしない |
| 待機バーを `#run` の中に置くか | **置かない。** `<body>` 直下に置き `position:fixed` + `z-index:110` |
| `renderHome()` を毎回呼ぶか | 食事カードだけなら `renderMealCard()`。`renderHome()` はカレンダー取得まで走るので重い |
| 「追加で食べる」の見た目 | 他の選択肢と**同じ色・同じ大きさ**。赤や警告色にしない |
| セッションを保存するタイミング | 各操作の直後に `touchMeal()`（＝`updatedAt` + `save()`）。「最後にまとめて保存」にしない（途中で閉じても残るように） |
| `D.settings` に食事設定を入れるか | 入れない。`D.mealPrefs` に分ける |
| 待機中に `run` を参照してよいか | **読むだけなら可**（`run && !run.paused` の判定）。代入は禁止 |

---

## 22. Hal確認済みの決定事項（2026-08-01）

**以下は確定。実装時に再度問い合わせないこと。**

| # | 項目 | 決定 |
|---|---|---|
| 1 | **食事カードの位置** | **ひとことメモカードの直下・`#habitCard` の直上。** 最上部はひとことメモのまま（Halの指定）。チェックリストは高さが変動するため、その上に置いて位置を固定する（§6.2 H1 / §9.1） |
| 2 | **待機の既定時間** | **5分**（`defaultWaitSec: 300`）。10分も選べる |
| 3 | **`[定番の食事をつくる]` の中身** | 「鶏胸肉＋主食＋ほうれん草」「鶏胸肉＋めかぶ＋ゆで卵」の2件（§9.4）。**ただしこれは初期値にすぎず、自分で自由に追加・編集・削除できることがMVPの要件**（§9.4 / §9.5 / §11 の `addMealTemplate` `saveSessionAsTemplate` `startFreeMealSession`） |

**Halの追加要望「自分で追加できるといいね」への対応**（設計書 §11 フローA' / §24-20）:
テンプレを増やす入口を**3つ**用意する。「先にテンプレを整備してから使う」を前提にしない。

1. **履歴から** — `scr-meal` の「最近の食事」各行に `[＋テンプレに保存]`（入力ゼロ・1タップ）
2. **自由入力から** — `✏️ 自由入力ではじめる` でテンプレなしに開始 → 食事中カードの `[＋テンプレに保存]`
3. **記録タブで** — 名前を入れて `[＋ 追加]` → `[✏️ 編集]` で品目・絵文字・手間レベル

**未確定のまま進めてよい点**（実装後にHalが実機で判断する）:
- 食事カードのアイドル時のボタン文言（`前回と同じ` / `選ぶ`）
- 同梱の汎用テンプレ4件が多すぎないか（多ければ削除できる）
