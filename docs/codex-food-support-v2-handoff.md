# Codex向け 実装指示書 v2 — 衝動の記録と連鎖への対応

前提資料: `docs/food-support-v2-design.md`（**先に全文を読むこと**）と `docs/food-support-design.md`（v1。原則・禁止事項・コード規約はすべて有効）
対象: `index.html`（v1実装+ライトテーマ後、約3274行）
位置指定はすべて**アンカー文字列**で行う。行番号は目安にすぎない。

---

## 0. 作業開始前

```bash
cd /Users/haruka/Downloads/ルーチンタイマー && git pull
```
`git status` がクリーンでなければHalに確認するまで作業しない。push はHalの指示があるまで行わない。

## 1. 絶対に壊してはいけないもの（v1 §2の全項目 + 以下）

- v1で実装済みの食事機能一式（セッション・待機・テンプレ・CSV・マージ）。**v2は追加であって改修ではない**
- `meal_sessions.csv` の既存20列の順序（追加は末尾のみ）
- `mergeMealCollections()` 本体のロジック（`MERGE_COLLECTIONS` 配列に3要素足すだけ）
- ライトテーマのCSS変数（`--line` / `--line2` 等）。色の直書きを増やさない
- `prompt()/confirm()/alert()` 禁止、単一ファイル維持、`esc()` 必須、属性はダブルクォート — v1と同じ

## 2. 実装順序（コミット単位）

| # | コミット | 内容 | 単独動作 |
|---|---|---|---|
| D1 | `feat: 衝動・単品・起床のデータモデルを追加` | schema 3、3コレクション、正規化、マージ、seed。**UIなし** | ✅ |
| D2 | `feat: 衝動のクイック記録と再確認を追加` | ⚡フロー、open再確認、settledBy | ✅ |
| D3 | `feat: 開始タイミングと単品ライブラリを追加` | 2択、foodItems自動学習、食事中の品目追加、🌊連鎖 | ✅ |
| D4 | `feat: 場所・ながら・起床の文脈を追加` | チップ2組、☀️起床、lastPlace/lastWatching | ✅ |
| D5 | `feat: 衝動をタイムライン・CSV・設定に統合` | エピソード表示、タイムライン、CSV3種、管理カード、設定 | ✅ |

各コミット後に §8 の該当テストと v1 handoff §19 の回帰テストを実行。

## 3. D1 — データモデル

### 3.1 定数（食事ブロック先頭の定数群 `const MEAL_TAGS` 付近に追加）

```js
const CURRENT_SCHEMA = 3;   // ← 既存の =2 を書き換え
const URGE_SETTLERS=[
  {id:'water',label:'💧 水'},{id:'tea',label:'🍵 お茶'},{id:'coffee',label:'☕ コーヒー'},
  {id:'wait',label:'⏳ 時間'},{id:'move',label:'🚶 動いた'},{id:'other',label:'その他'}];
const MEAL_CASCADE_WINDOW_MS = 90*60*1000;
const URGE_OPEN_EXPIRE_MS    = 6*60*60*1000;
```

### 3.2 正規化（`normalizeFoodRule` の直後に追加）

```js
function normalizeUrgeLog(u){
  const n=Object.assign({id:uid(),at:0,updatedAt:0,deletedAt:null,strength:null,
    phase:'standalone',mealSessionId:null,outcome:null,settledBy:[],items:[],
    tags:[],place:null,watching:null,note:''},u||{});
  n.strength=mealScore(n.strength);
  if(!['standalone','cascade'].includes(n.phase))n.phase='standalone';
  if(!['ate','settled','open',null].includes(n.outcome))n.outcome=null;
  n.settledBy=Array.isArray(n.settledBy)?n.settledBy.filter(x=>URGE_SETTLERS.some(s=>s.id===x)):[];
  n.items=Array.isArray(n.items)?n.items.map(normalizeMealItem):[];
  n.tags=normalizeMealTags(n.tags);
  if(!['home','out',null].includes(n.place))n.place=null;
  if(typeof n.watching!=='boolean')n.watching=null;
  n.note=String(n.note||'').slice(0,140);
  if(!n.updatedAt)n.updatedAt=n.at||Date.now();
  return n;
}
function normalizeFoodItem(f){
  const n=Object.assign({id:uid(),name:'',emoji:'🥨',useCount:0,lastUsedAt:0,
    createdAt:0,updatedAt:0,deletedAt:null},f||{});
  n.name=String(n.name||'').trim().slice(0,40);
  n.emoji=String(n.emoji||'🥨').slice(0,8);
  return n;
}
function normalizeWakeLog(w){
  const n=Object.assign({id:uid(),date:'',at:0,updatedAt:0,deletedAt:null},w||{});
  if(!n.updatedAt)n.updatedAt=n.at||Date.now();
  return n;
}
```

### 3.3 `migrateData()` — `if(from<2){…}` ブロックの直後に追加

```js
  if(from<3){
    if(!Array.isArray(d.urgeLogs))d.urgeLogs=[];
    if(!Array.isArray(d.foodItems))d.foodItems=[];
    if(!Array.isArray(d.wakeLogs))d.wakeLogs=[];
  }
  d.urgeLogs=(Array.isArray(d.urgeLogs)?d.urgeLogs:[]).map(normalizeUrgeLog);
  d.foodItems=(Array.isArray(d.foodItems)?d.foodItems:[]).map(normalizeFoodItem).filter(f=>f.name||f.deletedAt);
  d.wakeLogs=(Array.isArray(d.wakeLogs)?d.wakeLogs:[]).map(normalizeWakeLog);
  if(d.urgeLogs.length>2000){d.urgeLogs.sort((a,b)=>(a.at||0)-(b.at||0));d.urgeLogs=d.urgeLogs.slice(-2000);}
  if(d.wakeLogs.length>400){d.wakeLogs.sort((a,b)=>(a.at||0)-(b.at||0));d.wakeLogs=d.wakeLogs.slice(-400);}
```
`purgeMealTombstones()` の対象配列に `'urgeLogs','foodItems','wakeLogs'` を追加。
`normalizeMealSession()` の `Object.assign` 既定に `startTiming:null,place:null,watching:null` を追加し、検証 `if(!['before','during',null].includes(n.startTiming))n.startTiming=null;` 等を足す。
`defaultMealPrefs()` に `lastPlace:'home',lastWatching:null,csvIncludeUrges:true,askStartTiming:true` を追加。
`seed()` に `urgeLogs:[],foodItems:[],wakeLogs:[],` を追加。

### 3.4 同期（アンカー: `const MERGE_COLLECTIONS=`）

```js
const MERGE_COLLECTIONS=['mealSessions','mealTemplates','foodRules','urgeLogs','foodItems','wakeLogs'];
```
これだけ。`mergeMealCollections()` 本体は触らない。

### 3.5 データ操作ヘルパ（D1で入れておく）

```js
function openUrge(){return D.urgeLogs.find(u=>u.outcome==='open'&&!u.deletedAt)||null;}
function expireOldOpenUrges(){const lim=Date.now()-URGE_OPEN_EXPIRE_MS;let ch=false;
  for(const u of D.urgeLogs)if(u.outcome==='open'&&u.at<lim){u.outcome=null;u.updatedAt=Date.now();ch=true;}
  if(ch)save();}
function registerFoodItem(name){
  name=String(name||'').trim().slice(0,40);if(!name)return null;
  let f=D.foodItems.find(x=>!x.deletedAt&&x.name===name);
  if(!f){f=normalizeFoodItem({name,createdAt:Date.now()});D.foodItems.push(f);}
  f.useCount++;f.lastUsedAt=Date.now();f.updatedAt=Date.now();
  if(D.foodItems.filter(x=>!x.deletedAt).length>200){
    const worst=D.foodItems.filter(x=>!x.deletedAt).sort((a,b)=>a.useCount-b.useCount||a.lastUsedAt-b.lastUsedAt)[0];
    if(worst&&worst!==f){worst.deletedAt=Date.now();worst.updatedAt=Date.now();}}
  return f;
}
function todayWake(){const key=localDateKey(new Date());return D.wakeLogs.find(w=>!w.deletedAt&&w.date===key)||null;}
function recordWake(){
  let w=todayWake();const now=Date.now();
  if(w){w.at=now;w.updatedAt=now;}
  else D.wakeLogs.push(normalizeWakeLog({date:localDateKey(new Date()),at:now,updatedAt:now}));
  save();renderMealCard();
  toast('☀️ '+new Date(now).toTimeString().slice(0,5)+' 起床を記録しました');
}
```

**D1完了時の検証**: 画面変化ゼロ・コンソールエラーゼロ・`localStorage.rvt_v1` に `schemaVersion:3` と空3配列。

## 4. D2 — ⚡衝動フロー

### 4.1 mealState 拡張（アンカー: `let mealState={`）

既存オブジェクトに追加: `urgeOpen:false, urgeDraft:null`（`urgeDraft={strength,phase,mealSessionId}` 入力途中の保持）。

### 4.2 新規関数（食事ブロック内・データ操作層に）

| 関数 | 責務 |
|---|---|
| `startUrgeFlow(phase, mealSessionId)` | `mealState.urgeOpen=true; urgeDraft={strength:null,phase,mealSessionId}` → `renderMealCard()` |
| `setUrgeStrength(v)` | `urgeDraft.strength=mealScore(v)` → 3択表示へ |
| `commitUrge(outcome, extraFields)` | UrgeLog を生成して `D.urgeLogs.unshift`、`urgeDraft=null`、save、toast。place/watching は `mealPrefs.lastPlace/lastWatching` を既定値に |
| `resolveOpenUrge(kind)` | 再確認の3択。`'settled'`→settledByチップ表示へ、`'ate'`→単品チップへ、`'still'`→何もしない |
| `addUrgeSettler(id)` / `addUrgeItem(name)` | 直近の対象 UrgeLog に追記（`registerFoodItem` 経由）して `touchUrge` |

`touchUrge(u)` = `u.updatedAt=Date.now(); save();`

### 4.3 renderMealCard への追加

- idle 行に `[⚡]` ボタン（`onclick="startUrgeFlow('standalone',null)"`)
- `mealState.urgeOpen` が真なら 0-10（`mealScaleHtml` 再利用）→ 3択 `🍽 食事にする` / `🥨 つまんだ` / `👀 様子を見る` を描画
- `🍽 食事にする` は `commitUrge('ate',…)` 後、既存の開始UI（テンプレ選択 or 前回と同じ）へ。セッション作成後に `urge.mealSessionId=s.id; touchUrge(urge)` でリンク
- `openUrge()` があり `urgeOpen` でないとき、idle の下に再確認1行（design §4.2）。表示前に `expireOldOpenUrges()` を呼ぶ
- 起動処理（アンカー: `restoreMealState();`）の直後に `expireOldOpenUrges();` を追加

### 4.4 CSSは既存クラスを使い回す

`.meal-scale` `.meal-choice` `.meal-tags` をそのまま使う。新クラスは `.urge-row`（再確認1行）程度に留める。

## 5. D3 — 開始タイミング・単品・連鎖

### 5.1 開始タイミング

開始経路は3つある: `startMealSession()` / `startMealSessionSameAsLast()` / `startFreeMealSession()`。
**3関数の中身は触らず**、呼び出しの手前に確認ステップを挟む: `mealState.pendingStart` の既存機構（二重開始確認に使用中）を拡張し、`askStartTiming` が真なら `mealState.view='timing'` を経由して
`[🍽 これから食べる]`→`finishStart('before')` / `[🍚 もう食べてる]`→`finishStart('during')`。
`finishStart(t)` は保留していた開始を実行し、作成されたセッションに `s.startTiming=t; touchMeal(s)`。
`askStartTiming` が偽なら従来どおり即開始（`startTiming:null`）。

### 5.2 食事中の品目追加

eating ビューに `＋食べているもの` チップ行:
- `foodItemChipsHtml(handler)`: `!deletedAt` の foodItems を `useCount` 降順で最大6個 + `＋` ボタン（インライン入力欄を開く。`prompt()` 禁止）
- タップ → `addSessionItem(name)`: `session.items` に同名がなければ push、`registerFoodItem(name)`、`touchMeal`
- セッション確定時（`closeMealSession`）に `session.items` の各 name を `registerFoodItem` に通す（テンプレ由来の品目もライブラリが学習する）。**useCountの二重加算に注意**: `addSessionItem` 経由で登録済みの名前は close 時にスキップする（`mealState.learnedItems` の Set で管理）

### 5.3 🌊連鎖

- 表示条件: `activeMealSession()` が afterMeal/afterWait 中、**または** 直近の closed セッション（`!deletedAt`）の `updatedAt` が `MEAL_CASCADE_WINDOW_MS` 以内
- ボタン `[🌊 また食べたくなった]` → `startUrgeFlow('cascade', sessionId)`
- 🥨つまんだ を選んでもセッションは closed のまま（再オープンしない）

## 6. D4 — 文脈

- eating ビューと衝動確定画面にチップ2組（design §4.6）。選択は `s.place/s.watching`（または UrgeLog 側）へ保存し、同時に `mealPrefs.lastPlace/lastWatching` を更新
- ☀️起床: `renderMealCard()` の先頭で `todayWake()` が null かつ現在時刻が 04:00〜13:59 なら1行ボタンを出す → `recordWake()`
- 既定チップの見た目: 選択中は `.on`（既存 `.meal-tags .on` と同じ cyan 枠）

## 7. D5 — 統合

### 7.1 エピソード表示

`mealSessionSummary(s)` の末尾に、`D.urgeLogs` から `mealSessionId===s.id && phase==='cascade' && !deletedAt` を数えて `波{n}回({品目,…})` を追記（0回なら何も足さない）。
`renderMealHistory()` は、standalone の UrgeLog もセッションと混ぜて `at` 降順で表示: `⚡8 → 😌収まった(💧水)` 形式。直近10件の枠は共通。

### 7.2 24hタイムライン（アンカー: `items.push(...mealTimelineItems(cutoff,now));`）

`mealTimelineItems()` 内に追加: wakeLogs（`☀️ 起床`）と urgeLogs（`⚡ 食べたい{n} → {結果}`）。`showTimelineDetail` が偽なら衝動行は出さない（起床は常に出す）。

### 7.3 CSV

- `mealTimelineRows()` に `起床` 行と `衝動` 行を追加（design §6.1。`csvIncludeUrges` ガード）
- `buildMealCsv()` のヘッダ末尾に `,開始タイミング,場所,ながら` を追加し、各行の末尾に対応値（`食前`/`食事中`/空欄、`家`/`外`/空欄、`あり`/`なし`/空欄）
- 新規 `buildUrgeCsv()` / `exportUrgeCsv()`（design §6.3 の13列）。`起床からの分` は当日 wakeLog があれば `Math.round((u.at-w.at)/60000)`、なければ空欄。`食事からの分` は cascade かつセッションの endedAt があれば同様
- 設定タブのCSVカード（アンカー: `onclick="exportMealCsv()"` のボタン）の直後に `<button class="btn btn-p btn-sm" onclick="exportUrgeCsv()">⚡ 衝動CSV</button>`

### 7.4 設定・管理

- `#mealPrefsCard` に追加: `衝動の記録もChatGPT用CSVに含める`（csvIncludeUrges）/ `食事開始時に「これから/もう食べてる」を聞く`（askStartTiming）/ `衝動の記録だけ削除`（twoTap→urgeLogs全件論理削除）
- 記録タブ: `renderMealTemplateManager()` の直後に `renderFoodItemManager()`（テンプレ管理と同じ構造。名前・絵文字編集、twoTap論理削除）。`renderManage()` に呼び出しを追加
- `renderSet()` / `saveSettings()` に新チェックボックスの読み書きを追加

## 8. 手動テストシナリオ

### D2後
1. ⚡→7→👀様子見 → カードがidle+再確認行になる
2. 再確認→😌収まった→💧水 → urgeLogsに settled/water で保存
3. ⚡→3→🥨つまんだ→自由入力「せんべい」→ ate/items保存、foodItemsに「せんべい」が自動登録
4. リロードしても open 衝動の再確認行が復元される

### D3後
5. ⚡→9→🍽食事にする→前回と同じ→もう食べてる → セッションに startTiming:'during'、UrgeLogとリンク
6. 食事中に＋枝豆 → items に追記
7. 食べ終わった→8→5分待機→4→終える→🌊→6→🥨ポテチ→🌊→5→🥨枝豆 → 履歴に「波2回(ポテチ・枝豆)」
8. askStartTiming をOFF → 開始2択が出ず即開始

### D4後
9. ☀️タップ → toast、当日再表示されない。もう一度当日中にカードを見ても出ない
10. 場所チップ既定が前回値になっている

### D5後
11. ChatGPT用CSVに 起床/衝動 行。csvIncludeUrges OFFで消える
12. meal_sessions.csv の従来20列が不変で、末尾3列が増えている
13. urge_logs.csv の「起床からの分」が正しい
14. 2端末同期: 端末Aで衝動記録→端末Bでpull→両方に存在（IDマージ）

### 回帰（毎コミット後）
- v1 handoff §19 の全項目
- 既存 mealSessions が壊れていない（v2で記録したセッションの表示・CSV出力が従来どおり）
- 禁止語 grep: 追加差分に 我慢/成功/失敗/食べすぎ/意志/ダメ が無い
- 食事ブロックから confetti/xp/combo/sendNotion/calAddEvent/aiCall の呼び出しが無い

## 9. 完成条件

1. §8 の全シナリオがMacで通る（iPhoneはHalが確認）
2. design §7 受け入れ条件の2大シナリオ（ベッドの衝動・今日の実例）が指定タップ数で完了
3. `node --check`（scriptブロック連結）が通る
4. `.nojekyll` / `PRESET_SYNC.key:''` / 単一ファイル構成が維持されている
5. push していない
