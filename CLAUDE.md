# CLAUDE.md — ルーチンボイスタイマー

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
1. 作業開始時にまず `git pull`（ブラウザ経由やclaude.ai経由の更新と食い違うことがあるため）
2. index.html を編集
3. 動作確認（可能なら。少なくとも `node -e "new Function(スクリプト部)"` 相当の構文チェック）
4. 変更を検証したら、今回の作業に関係するファイルだけを commit → push まで毎回実行する。Hal の明示指示により、通常の push の都度確認は不要（main への push が GitHub Pages 公開につながることも含む）。変更がなければ空コミットは作らない。
5. 反映は1〜2分後。https://itwrk.github.io/routine-timer/

## ファイル構成
- `index.html` — アプリ本体（すべてここ）
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
- **AI生成**: 設定のAPIキーで api.anthropic.com を直叩き
  （`anthropic-dangerous-direct-browser-access` ヘッダ使用）。トーン指示は `settings.aiTone`
- **Notion記録**: `settings.webhook`（GAS中継）に完走ログをPOST（`sendNotion`）

## UI方針
- ライト背景のネオンアーケード調（ほぼ白背景 + DotGothic16 + M PLUS Rounded 1c、ピンク/シアン/ゴールドの差し色。色は:rootのCSS変数で一元管理）
- スマホ最優先。文字・余白はコンパクトに、ボタンは折返し禁止（過去に崩れ多発）
- 実行画面上部はアプリ内ビューアのバーに隠れることがあるため、重要ボタンは画面下部にも配置
- ルーチン一覧は `lastRun` 降順（最後にやったものが先頭）

## 変更後のセルフチェック
- [ ] `.nojekyll` が残っている
- [ ] `PRESET_SYNC.key` が `''` のまま
- [ ] prompt/confirm/alert を追加していない
- [ ] ステップ編集処理に `syncShared` が付いている
- [ ] スマホ幅(~380px)でボタン文字が折り返さない

## Codexとの共通ルール
- Mac / Codex Cloud の引き継ぎと安全な Git 操作は AGENTS.md を参照する。

## push の実行と検証
- 作業開始時は git status と現在の branch / upstream を確認し、未コミット変更がない場合のみ git pull --ff-only。
- 正常なチェック後、今回の作業に関係するファイルのみを明示してステージする。無関係な変更や秘密情報を含めない。
- 現在の作業ブランチへ通常の push を実行する。新規ブランチは origin に upstream を設定する。Cloud では main に勝手に切り替えず、作業ブランチを push する。
- push 後に remote の対象ブランチのコミットIDがローカルの HEAD と一致することを確認し、ブランチ名・コミットID・実行結果を報告する。
- push 拒否・認証エラー・競合時は未送信と明記して状況を報告する。force push、履歴の書き換え、ユーザーの変更の破棄は行わない。
- Cloud の Pull Request を main へマージする操作は、引き続き Hal の承認を得る。
