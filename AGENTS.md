# AGENTS.md — ルーチンボイスタイマー

## プロジェクト概要
Hal個人用のルーチン実行支援アプリ。「タイマー × 二重音声読み上げ × 派手な報酬演出（ADHD向けドーパミン設計）× 進捗ゲーミフィケーション」。
単一HTMLファイル（index.html）で完結し、GitHub Pagesで配信。スマホ(iPhone Safari)とMacの両方で使用。

- **本番URL**: https://itwrk.github.io/routine-timer/
- **リポジトリ**: itwrk/routine-timer（public）
- **ローカルパス**: /Users/haruka/Downloads/ルーチンタイマー/

## 絶対に守ること
1. **`.nojekyll` を削除しない**（削除するとPagesが404になる。過去に発生済み）
2. **合言葉をファイルに埋め込まない**。`PRESET_SYNC` の `key` は必ず `''` のまま
   （publicリポジトリのため。合言葉は各端末が初回に `#sync=URL|合言葉` で受け取り、localStorageに保持する設計）
3. `PRESET_SYNC` の `url`（GASウェブアプリURL）は埋め込んでOK（秘密情報ではない）
4. `prompt()` / `confirm()` / `alert()` は使用禁止。アプリ内ビューアでブロックされる。
   確認は既存の `twoTap()`（2度押し確認）、入力はインラインフォームで行う
5. 単一HTMLファイル構成を維持（外部JS/CSSファイルに分割しない）

## 作業フロー
1. 作業開始時にまず `git pull`（ブラウザ経由やCodex.ai経由の更新と食い違うことがあるため）
2. index.html を編集
3. 動作確認（可能なら。少なくとも `node -e "new Function(スクリプト部)"` 相当の構文チェック）
4. 変更を検証したら、今回の作業に関係するファイルだけを commit → push まで毎回実行する。Hal の明示指示により、通常の push の都度確認は不要（main への push が GitHub Pages 公開につながることも含む）。変更がなければ空コミットは作らない。
5. 反映は1〜2分後。https://itwrk.github.io/routine-timer/

## ファイル構成
- `index.html` — アプリ本体（すべてここ）
- `assets/bgm/` — 暗記用の同梱CC0音源（MP3）。出典・ライセンス・変換内容は `CREDITS.md` に記録する。JS/CSSは引き続きindex.html内に置く
- `.nojekyll` — Pages用（空ファイル。削除禁止）
- `deploy.command` — Downloadsの最新index*.htmlをコピーしてcommit/pushするスクリプト
- `.DS_Store` — Macのゴミ。無視してよい（.gitignore追加も可）

## アーキテクチャ（index.html内）
- **データ**: localStorage キー `rvt_v1`。構造は `D = {routines, hitokoto, logs, xp, badges, combo, settings, updatedAt}`
  - routine: `{id, name, emoji, lastRun, steps:[{id, name, emoji, sec, memo, texts[], sharedId?}]}`
  - 新プロパティ追加時は `Object.assign` でデフォルト補完（既存データとの後方互換を維持）
- **食事サポート**: `mealSessions` / `mealTemplates` / `foodRules` / `mealPrefs` を `normalizeData()` で正規化。待機は `endsAt` 基準の独立タイマーで復元し、食事はXP・コンボ・ルーチンログへ接続しない
- **端末間同期**: GASウェブアプリ経由でGoogle Driveの `rvt_sync.json` に全データを保存
  - `syncPush()` / `syncPull()`。自動同期ON時はsave()の4秒後にpush、起動時にpull（updatedAt比較で新しい方優先）
  - `settings.apiKey` と同期設定自体は同期対象外（端末ローカル保持）
  - GAS側スクリプトの更新は「デプロイを管理→新バージョン」。新規デプロイ作成はURL変更事故になるので不可
- **音声**: Web Speech API（ja-JP）。ステップ名読み上げ→モチベテキスト読み上げの二段構成
- **効果音**: Web Audio API（beep / hitNoise）。設定でON/OFF・経過音パターン（なし/1分/30秒/10秒）
- **報酬演出**: 紙吹雪canvas、スラム演出（slamIn）、コンボ、可変比率ジャックポット（8%で5倍、12%で2倍）、
  パーフェクトボーナス、バッジ、XP/レベル、ヒートマップ。演出は「速くてパンチがある」方向を維持
- **共有ステップ**: `sharedId` を持つステップは編集時に `syncShared(s)` で全ルーチンへ伝播。
  ステップ編集系の処理を追加・変更した場合は必ず `syncShared` 呼び出しを維持すること
- **AI生成**: 設定の共通OpenAIキー（`settings.apiKey`）で Responses API を使用。Halの指定により文章生成・接続テストは `gpt-6.1-sol` 固定とし、Lunaへの切替・フォールバックは行わない。古い保存・同期データの `settings.aiModel` もSolへ正規化する。トーン指示は `settings.aiTone`。暗記・アナウンスの音声生成は音声専用モデルで同じキーを使う
- **API利用額の概算**: `D.apiUsage` に日本時間の月・文章/音声別の累積金額（USDの10億分の1の整数）と件数を保持し、設定の月選択で表示する。キーは同一と仮定し、キーや本文・音声・キーの識別情報を記録しない。Responsesのusage（キャッシュ・推論出力含む）とRealtimeのresponse.doneのusageを優先し、旧TTSは文字数、usageなしは文字数・PCMの生成秒数から推定する。途中までの生成も把握できた使用分を記録し、保存音声の再利用・再生、端末TTS・BGMでは加算しない。ページごとに固有の書込IDを持つ月別累積値をmaxでマージし、同じ記録の同期・古いタブの保存で二重加算や消失を避ける。料金は生成時点で固定し、過去分を後の単価で再計算しない。追加前や他アプリの利用・請求残高は取得しない。集計失敗で有料生成を再試行させない
- **暗記**: 保存音声は行単位。`memoryClipId` は本文・モデル・声・対応トーンだけをキーにし、行番号・行順・マーカー・確認状態を含めない。長い行は既存の400文字区切り音声も流用して行音声へまとめる。自動暗記箇所マップはSolに語句を選ばせ、元の本文に実在する語句だけをローカルで赤マークする。本文・既存マーク・画像を保持し、作成中の編集・ノート切替による上書きを防ぐ
- **暗記のエコー**: `memoryPrefs.echo` / `echoAmount` でON/OFF・強さを保持。`memoryPlaybackWave()` が端末内で再生用PCMにエコーを加え、従来の `<audio>` で再生する。原音キャッシュ・`memoryClipId` はエコー設定に依存させず、再生成・API消費を増やさない。再生途中の変更は位置を保って再開し、停止・ノート切替後の遅れた再開を防ぐ。端末TTSはエコー非対応。音声書出は加工音、Drive保存は原音
- **暗記の無音時間**: 通常画面・暗記モードの独立した「無音 ○秒」ボタンから `memoryPrefs.gap` を変更できる。秒数プリセット（0・1・2・3・5・10秒）・±1秒・0〜60秒の直接入力を設定欄と同期する。0.5秒のプリセット・増減ボタンは設けない。保存音声は行ごとの時刻表を使って同じ語句の位置から再開し、原音は再生成しない。端末TTSも行単位で読み上げ、無音時間は次の読み上げ区切りから反映する
- **暗記の端末TTS**: 再生タップ内で同期的に `speechSynthesis.speak()` を呼び、キャッシュ確認のawaitを挟まない。保存音声の準備は編集後・画面表示時・TTS終了後に行う。発話参照を保持し、一時停止状態を解除する。長い行は短い発話へ分割し、同じ行内に行間の無音を追加しない。開始しない場合は1回だけ再試行し、失敗は暗記モードにも表示する。トークン・監視タイマーで停止後の遅れた再開を防ぎ、ルーチン読み上げによる暗記音声のキャンセルを避ける
- **暗記のBGM**: `memoryPrefs.bgmEnabled` / `bgmTrack` / `bgmVolume` に設定を保存する。同梱3曲を専用Web Audioコンテキストでループし、GainNodeで独立した音量調整・読み上げ中の音量低下を行う。タップ内でコンテキストをresumeしてから取得・デコードする。ページ起動時に自動再生・ダウンロードせず、停止後の遅い取得で再開しない。通常の停止は音声とBGMの両方を止め、設定変更時の `memoryStop(false)` はBGMを継続する。BGM設定は保存音声のキャッシュ判定・生成に影響させない。画面OFF中のBGM継続はiOSの制限がある
- **Notion記録**: `settings.webhook`（GAS中継）に完走ログをPOST（`sendNotion`）

## UI方針
- 明るいグレー背景と白いカード、濃い本文、インディゴの主操作を基本にする。システムフォントを使い、色は:rootのCSS変数で一元管理。報酬演出の勢いは維持する
- スマホ最優先。文字は小さめを維持し、コントラスト・余白・情報の並べ方で視認性を高める。ボタンは折返し禁止（過去に崩れ多発）
- PC（960px以上）は右のメイン領域 `#app` だけ従来の小さい文字・詰めた余白を使う（`--text-scale:.8`）。左メニューのサイズとは独立させ、スマホにはこの縮小を適用しない
- 実行画面上部はアプリ内ビューアのバーに隠れることがあるため、重要ボタンは画面下部にも配置
- ルーチン一覧は `lastRun` 降順（最後にやったものが先頭）

## 変更後のセルフチェック
- [ ] `.nojekyll` が残っている
- [ ] `PRESET_SYNC.key` が `''` のまま
- [ ] prompt/confirm/alert を追加していない
- [ ] ステップ編集処理に `syncShared` が付いている
- [ ] スマホ幅(~380px)でボタン文字が折り返さない

## Mac / Codex Cloud 共通の開発ルール
- 正本は GitHub の itwrk/routine-timer。公開元は main のルート。
- Cloud は Linux 環境。上記の Mac ローカルパスや deploy.command は使用しない。
- 単一 HTML のため npm install やビルド工程は不要。プレビューは python3 -m http.server 8000 などで行う。
- Mac と Cloud の未コミット変更は自動同期されない。作業完了時・引き継ぎ前に変更をコミットして push し、GitHub に保存する。通常の push は都度確認不要。
- Cloud の機能修正は作業ブランチで行い、Pull Request で差分を確認する。main へのマージは公開につながるため、Hal の承認を得る。
- Mac で再開時は未コミット変更を確認し、変更がない場合のみ git pull --ff-only。変更や分岐がある場合は停止して状況を報告し、強制リセットや上書きをしない。
- 同じ機能を Mac と Cloud で同時に編集しない。別作業は別ブランチにする。
- 合言葉・APIキー・端末の localStorage データをリポジトリやCloudのテストデータへ保存しない。
- 構文チェック例: node -e 'const h=require("fs").readFileSync("index.html","utf8"); for(const m of h.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) if(m[1].trim()) new Function(m[1]); console.log("syntax OK")'

## push の実行と検証
- 作業開始時は git status と現在の branch / upstream を確認し、未コミット変更がない場合のみ git pull --ff-only。
- 正常なチェック後、今回の作業に関係するファイルのみを明示してステージする。無関係な変更や秘密情報を含めない。
- 現在の作業ブランチへ通常の push を実行する。新規ブランチは origin に upstream を設定する。Cloud では main に勝手に切り替えず、作業ブランチを push する。
- push 後に remote の対象ブランチのコミットIDがローカルの HEAD と一致することを確認し、ブランチ名・コミットID・実行結果を報告する。
- push 拒否・認証エラー・競合時は未送信と明記して状況を報告する。force push、履歴の書き換え、ユーザーの変更の破棄は行わない。
- Cloud の Pull Request を main へマージする操作は、引き続き Hal の承認を得る。
