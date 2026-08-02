# Codex向け 実装指示書 v3 — 想起（記録がその場で返ってくる）

前提資料: `docs/food-support-v3-design.md`（**先に全文を読むこと**）、`docs/food-support-design.md`（v1）、`docs/food-support-v2-design.md`（v2）
対象: `index.html`（基準 `6c906c1`、3664行）
位置指定は**アンカー文字列**で行う。行番号は目安。

---

## 0. 作業開始前

```bash
cd /Users/haruka/Downloads/ルーチンタイマー && git pull
```
`git status` がクリーンでなければHalに確認するまで作業しない。**push はHalの指示があるまで行わない。**

## 1. ゴール

**記録した瞬間に、自分の記録が返ってくる状態にする。** 予測はしない。事実を並べるだけ。

達成状態:
1. ⚡→強さを選んだ時点で、似たときの記録が最大2件その場に出る
2. ホームの食事カード直下に「🔎 ふりかえり」が常設され、今日の流れと似たときの記録が見える
3. 「17分で落ち着いた」のように所要時間が出る
4. 記録0件でもカードが壊れず、案内文が出る

## 2. 絶対に壊してはいけないもの

v1 §2 / v2 §1 の全項目に加えて:

| 対象 | 理由 |
|---|---|
| ⚡フローのタップ数（2〜4タップで完了） | v2の中核価値。想起を足して重くしてはいけない |
| `URGE_SETTLERS` の既存6件のID・ラベル・順序 | 過去データの意味が変わる。**追加のみ許可** |
| `buildUrgeCsv()` の既存13列＋v2追加2列の順序 | 追加は末尾のみ |
| `buildMealCsv()` の全列 | 触らない |
| `mergeMealCollections()` / `MERGE_COLLECTIONS` | v3では変更不要 |
| `autoPullOnFocus()` とタブ復帰pull | 同期強化分。触らない |
| 定数が `normalizeData` より前にある構造 | **下へ動かすとTDZで全データが消える。** 過去に発生済み |

**コード規約**: `prompt()/confirm()/alert()` 禁止、単一HTML維持、`esc()` 必須、属性はダブルクォート、色は既存CSS変数（`--line`/`--line2`/`--dim` 等）を使い直書きしない。

## 3. 実装順序（コミット単位）

| # | コミット | 内容 | 単独動作 |
|---|---|---|---|
| E1 | `feat: 衝動の確定時刻と「別のこと」を記録できるようにする` | `resolvedAt`、`distract` 設定値、CSV1列。**UIの返りはまだ無い** | ✅ |
| E2 | `feat: 似たときの記録を⚡フローに表示する` | `similarUrges()` / `urgeRecallHtml()` / フロー内表示 | ✅ |
| E3 | `feat: ホームにふりかえりカードを追加` | `#recallCard`、今日の流れ、常設表示 | ✅ |

各コミット後に §8 のテストと v2 handoff §8 の回帰を実行。

## 4. E1 — データ

### 4.1 `CURRENT_SCHEMA`

アンカー: `const CURRENT_SCHEMA=3;` → `4` に変更。**この行の位置は動かさない**（定数群と共に `normalizeData` の前にある必要がある）。

### 4.2 `URGE_SETTLERS` に追加

アンカー: `const URGE_SETTLERS=[`

```js
const URGE_SETTLERS=[
  {id:'water',label:'💧 水'},{id:'tea',label:'🍵 お茶'},{id:'coffee',label:'☕ コーヒー'},
  {id:'wait',label:'⏳ 時間'},{id:'move',label:'🚶 動いた'},
  {id:'distract',label:'🎮 別のこと'},          // ★追加（other の前）
  {id:'other',label:'その他'}
];
```

`normalizeUrgeLog` 内のハードコード配列も合わせる:
```js
const settlerIds=['water','tea','coffee','wait','move','distract','other'];
```
> ⚠️ ここは `URGE_SETTLERS` を参照せずIDを直書きしている。**両方直すこと。**片方だけだと `distract` が正規化で捨てられる。

`urgeSettlerLabel()` のマップにも追加:
```js
{water:'水',tea:'お茶',coffee:'コーヒー',wait:'時間',move:'動いた',distract:'別のこと',other:'その他'}
```

### 4.3 `resolvedAt`

`normalizeUrgeLog` の `Object.assign` 既定に `resolvedAt:null` を追加し、直後に:
```js
n.resolvedAt=n.resolvedAt==null?null:mealNumber(n.resolvedAt,null);
```

**確定時に立てる。** 対象は3箇所:

| 関数 | 追記 |
|---|---|
| `addUrgeSettler(id)` | `u.outcome='settled';` の直後に `if(!u.resolvedAt)u.resolvedAt=Date.now();` |
| `addUrgeItem(name)`（`draft.targetId` あり側） | `u.outcome='ate';` の直後に同上 |
| `commitUrge(outcome, extraFields)` | 生成オブジェクトに `resolvedAt:(outcome==='ate'||outcome==='settled')?now:null` |

`expireOldOpenUrges()` は `outcome` を `null` に戻すだけなので `resolvedAt` は触らない（元々 null）。

### 4.4 所要時間ヘルパ

食事ブロック内、`urgeResultLabel` の**前**に置く:
```js
function urgeResolveMinutes(u){
  if(!u||!u.resolvedAt||!u.at)return null;
  const m=Math.round((u.resolvedAt-u.at)/60000);
  return m<0?null:m;
}
```

### 4.5 CSV

`buildUrgeCsv()` のヘッダ末尾に `'収まるまでの分'` を追加し、各行末尾に:
```js
(urgeResolveMinutes(u)===null?'':urgeResolveMinutes(u))
```

`urgeTimelineDetail()` の `結果:` 部分に所要時間を添える（**列は増やさない**）:
```js
const mins=urgeResolveMinutes(u);
const parts=[`結果:${urgeResultLabel(u)}${mins!==null?`（${mins}分）`:''}`];
```

## 5. E2 — 似たときの記録

### 5.1 時間帯

食事ブロック内に追加:
```js
const URGE_BANDS=[
  {label:'深夜',from:23,to:5},{label:'朝',from:5,to:10},{label:'昼',from:10,to:15},
  {label:'夕方',from:15,to:19},{label:'夜',from:19,to:23}
];
function urgeBandLabel(stamp){
  const h=new Date(Number(stamp)||Date.now()).getHours();
  for(const b of URGE_BANDS){
    if(b.from<b.to){if(h>=b.from&&h<b.to)return b.label;}
    else if(h>=b.from||h<b.to)return b.label;   // 深夜の日またぎ
  }
  return '';
}
// 時刻だけの差（日をまたぐ 23:30 と 00:30 を 60分差とみなす）
function clockDiffMinutes(a,b){
  const m=s=>{const d=new Date(Number(s)||0);return d.getHours()*60+d.getMinutes();};
  const diff=Math.abs(m(a)-m(b));
  return Math.min(diff,1440-diff);
}
const URGE_SIMILAR_WINDOW_MIN=120;
```

### 5.2 候補選択

```js
// excludeId: 表示のきっかけになった衝動自身を除く（null可）
// 戻り値: {mode:'time'|'strength'|'none', band:'夕方', list:[UrgeLog]}
function similarUrges(strength,at,limit,excludeId){
  const base=Number(at)||Date.now();
  const pool=D.urgeLogs.filter(u=>u&&!u.deletedAt&&u.id!==excludeId&&Number(u.at));
  const rank=(a,b)=>{
    const sa=a.strength===null?99:Math.abs(a.strength-(strength===null?5:strength));
    const sb=b.strength===null?99:Math.abs(b.strength-(strength===null?5:strength));
    return sa-sb||(b.at||0)-(a.at||0);
  };
  const near=pool.filter(u=>clockDiffMinutes(u.at,base)<=URGE_SIMILAR_WINDOW_MIN).sort(rank);
  if(near.length)return {mode:'time',band:urgeBandLabel(base),list:near.slice(0,limit)};
  const byStrength=pool.slice().sort(rank);
  if(byStrength.length)return {mode:'strength',band:urgeBandLabel(base),list:byStrength.slice(0,limit)};
  return {mode:'none',band:urgeBandLabel(base),list:[]};
}
```

### 5.3 1行の書式

```js
function urgeRecallLine(u){
  const d=new Date(u.at||0);
  const when=`${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  const did=(u.settledBy&&u.settledBy.length)
    ? u.settledBy.map(urgeSettlerLabel).join('・')
    : (u.outcome==='ate'&&u.items&&u.items.length ? mealItemsLabel(u.items) : '');
  const mins=urgeResolveMinutes(u);
  let result;
  if(u.outcome==='settled')result=mins!==null?`${mins}分で落ち着いた`:'落ち着いた';
  else if(u.outcome==='ate')result='食べた';
  else if(u.outcome==='open')result=`まだ続いてる${u.rechecks&&u.rechecks.length?`×${u.rechecks.length}`:''}`;
  else result='記録のみ';
  return `${when} ⚡${u.strength===null?'':u.strength}${did?` → ${esc(did)}`:''} → ${result}`;
}
```
> `did` は自由入力の品目名を含みうる。**必ず `esc()` を通す**（上の実装済み）。`when` と `result` はコード生成の固定文字列なのでエスケープ不要。

### 5.4 想起ブロックのHTML

```js
// compact=true: ⚡フロー内（最大2件・見出し短め）
function urgeRecallHtml(strength,at,limit,excludeId,compact){
  const r=similarUrges(strength,at,limit,excludeId);
  if(r.mode==='none')
    return `<div class="urge-recall"><p class="muted">この時間帯の記録はまだありません。これが最初の1件になります。</p></div>`;
  const head=r.mode==='strength'?'近い強さの記録'
    :(compact?`${r.band}ごろ、このくらいのとき`:`${r.band}ごろの記録`);
  return `<div class="urge-recall"><p class="urge-recall-head">${esc(head)}</p>`
    +r.list.map(u=>`<div class="urge-recall-row">${urgeRecallLine(u)}</div>`).join('')+`</div>`;
}
```

### 5.5 ⚡フローへの差し込み

アンカー: `function urgeFlowHtml(){` 内の `if(d.mode==='outcome')return ...` の行。

`<p style="font-weight:800">このあとはどうする？</p>` の**直後**、`mealContextHtml(...)` の**前**に挿入:
```js
${urgeRecallHtml(d.strength,Date.now(),2,d.targetId,true)}
```

**制約**: フロー内は `limit=2` 固定。3択ボタンが375pxで画面外へ出ないこと（§8-4で実測）。

### 5.6 CSS

アンカー: `.urge-row{` の直後に追加。**新しい色は作らず既存変数を使う**。

```css
.urge-recall{margin:6px 0 8px;padding:6px 8px;background:var(--card2);border-left:3px solid var(--cyan);border-radius:8px}
.urge-recall-head{font-size:10px;font-weight:800;color:var(--dim);margin-bottom:3px}
.urge-recall-row{font-size:11px;line-height:1.55;overflow-wrap:anywhere}
.urge-recall-row+.urge-recall-row{border-top:1px dashed var(--line);padding-top:3px;margin-top:3px}
```

## 6. E3 — ふりかえりカード

### 6.1 HTML

アンカー: `<div class="card meal-card" id="mealCard"></div>`（`index.html:475`）の**直後**:
```html
<div class="card" id="recallCard"></div>
```

### 6.2 今日の流れ

```js
function todayThreadItems(){
  const key=localDateKey(new Date()),items=[];
  const sameDay=s=>s&&localDateKey(new Date(Number(s)||0))===key;
  for(const w of D.wakeLogs)if(!w.deletedAt&&sameDay(w.at))items.push({at:w.at,text:'☀️ 起床'});
  for(const s of D.mealSessions)if(!s.deletedAt&&sameDay(s.startedAt))
    items.push({at:s.startedAt,text:`🍽 ${esc(s.label||'食事')}`});
  for(const u of D.urgeLogs)if(!u.deletedAt&&sameDay(u.at)){
    const did=(u.settledBy&&u.settledBy.length)?u.settledBy.map(urgeSettlerLabel).join('・')
      :(u.outcome==='ate'&&u.items&&u.items.length?mealItemsLabel(u.items):'');
    const tail=u.outcome==='open'?' まだ続いてる':(did?` → ${esc(did)}`:'');
    items.push({at:u.at,text:`⚡${u.strength===null?'':u.strength}${tail}`});
  }
  return items.sort((a,b)=>(b.at||0)-(a.at||0)).slice(0,5);
}
```

### 6.3 描画

```js
function renderRecallCard(){
  const el=document.getElementById('recallCard');if(!el)return;
  const today=todayThreadItems();
  const recall=urgeRecallHtml(null,Date.now(),3,null,false);
  const empty=!today.length&&!D.urgeLogs.some(u=>!u.deletedAt);
  el.innerHTML=`<div class="meal-card-row"><div class="meal-grow"><strong>🔎 ふりかえり</strong></div>`
    +`<button class="text-link" type="button" onclick="showScreen('scr-meal')">すべて見る →</button></div>`
    +(empty?'<p class="muted" style="margin-top:6px">まだ記録がありません。⚡を押すと、ここに残ります。</p>'
      :(today.length?`<p class="urge-recall-head" style="margin-top:6px">今日</p>`
        +today.map(i=>`<div class="urge-recall-row">${hhmm(i.at)} ${i.text}</div>`).join(''):'')
       +recall);
}
function hhmm(s){const d=new Date(Number(s)||0);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;}
```
> `todayThreadItems()` が返す `text` は**生成時点で `esc()` 済み**。`renderRecallCard` で二重エスケープしないこと。

### 6.4 呼び出しの配線

| 場所 | 追加 |
|---|---|
| `renderHome()`（アンカー `renderMealCard();`） | **直後**に `renderRecallCard();` |
| `renderUrgeUi()` | 末尾に `renderRecallCard();`（衝動を記録した直後に反映させる） |
| `recordWake()` / `closeMealSession()` / `deleteUrgeLog()` / `deleteAllUrgeLogs()` | `renderMealCard()` を呼んでいる箇所に `renderRecallCard();` を併記 |

> `renderRecallCard()` の先頭は `if(!el)return;` で守ること（既存render関数と同じ防御）。

## 7. 触らないもの

`syncPull` / `syncPush` / `mergeMealCollections` / `MERGE_COLLECTIONS` / `autoPullOnFocus` / `buildMealCsv` / `chatgptTimelineRows` の**列構成** / `renderActivityTimeline`（24hタイムラインは従来どおり）。

## 8. 手動テストシナリオ

### E1後
1. ⚡→6→👀様子を見る→（再確認行）😌収まった→💧水 → `resolvedAt` が入る
2. 衝動CSV末尾に「収まるまでの分」列があり、1の記録に分数が入る
3. 「何が効いた？」に `🎮 別のこと` が出る。選ぶと `settledBy:['distract']` で保存される
4. **リロードして `distract` が消えないこと**（`normalizeUrgeLog` の直書き配列を直し忘れていないかの確認）
5. 既存データ（v2で記録済みの衝動）を開いてもエラーが出ない。所要時間は空欄

### E2後
6. 衝動を2件以上作ったあと ⚡→強さを選ぶ → 3択の上に最大2件の記録が出る
7. 記録0件の状態で ⚡→強さ → 「この時間帯の記録はまだありません。これが最初の1件になります。」
8. 深夜0時台の記録が23時台の照合に入る（`clockDiffMinutes` の日またぎ）
9. **375px幅で3択ボタンが画面内に収まる**（想起2件が出ている状態で）
10. 自由入力の品目名に `<b>` を入れて記録 → 想起行にタグとして解釈されず、そのまま文字列で出る

### E3後
11. ホームの食事カード直下に「🔎 ふりかえり」があり、今日の記録が新しい順に最大5件出る
12. ⚡で記録した直後、画面遷移なしにふりかえりカードが更新される
13. 記録0件で「まだ記録がありません。⚡を押すと、ここに残ります。」が出る（カードは消えない）
14. 「すべて見る →」で `scr-meal` へ遷移する
15. 日付が変わると「今日」が空になる（端末の日付を進めて確認、または `localDateKey` の境界を目視）

### 回帰（毎コミット後）
- **記録→リロード→データが残っている**（TDZ再発の検出。最重要）
- ⚡→強さ→👀様子を見る が**4タップ以内**で完了する
- ルーチン実行・待機タイマー・同期・バックアップが従来どおり
- 食事CSVの列が不変、ChatGPT用CSVのヘッダが不変
- 追加差分に禁止語（我慢/成功/失敗/食べすぎ/意志/ダメ）と `prompt|confirm|alert` が無い
- **想起の文言に助言・評価の語が無い**（「した方がいい」「うまくいった」「おすすめ」「傾向」）
- 食事ブロックから `confetti/xp/combo/sendNotion/calAddEvent/aiCall` の呼び出しが無い

### 構文チェック
```bash
node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const s=[...h.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n;\n');new Function(s);console.log('ok')"
```

## 9. 完成条件

1. §8 の全シナリオがMacで通る（iPhoneはHalが確認）
2. design §10 の受け入れ条件8項目を満たす
3. 構文チェックが通る
4. `.nojekyll` / `PRESET_SYNC.key:''` / 単一ファイル構成が維持されている
5. 定数群と `mealScore` が `normalizeData` より前にある
6. push していない
