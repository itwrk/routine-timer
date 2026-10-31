# 暗記機能

「📚 暗記」からノートを作成する。本文は改行ごとのブロックで編集でき、↑↓で入れ替えられる。文字のマーカーとチェックはHTMLのspanに保存する。選択範囲の文字位置は着色時の計算だけに使い、データとして保持しない。スマートフォンでボタンを押すと選択が消える場合に備え、直近のRangeを保持する。

赤シートは上の取っ手で移動、下の取っ手で高さを変更する。キーボードの上下キーでも操作できる。赤いフィルターの下でも、確認済みの✓は手前に表示する。

## 保存と移行

- ノートと挿入画像：IndexedDB `rvt_memory_v1` の `notes`。
- 生成音声：同データベースの `clips`。24000 Hz / mono / PCM16。
- 速度、行間、OpenAIの声・モデル・自由文トーン、端末TTSの声、ループ：localStorage `rvt_memory_prefs_v1`。
- OpenAIキー：localStorage `rvt_memory_openai_key_v1`。ノート、書出、既存のルーチン同期には含めない。
- 件数の上限は設けない。利用できる保存容量はブラウザ・端末による。
- ノートは既存のルーチン同期・ルーチンのJSONバックアップとは独立している。「全件書出」で全ノートと画像を保存し、別端末で読み込む。音声は「音声を書出」で別途保存する。

記法は赤《ことば》、緑【ことば】、チェック済み《ことば✓》／【ことば✓】。区切り記号そのものはバックスラッシュでエスケープする。画像はMarkdown形式のdata URLで書き出す。`.txt` はタイトルのヘッダーと記法の本文で構成し、全件書出も同じ形式で復元する。旧JSONは本文の `html` / `text` / `content` / `body` / `notation`、ブロック配列、ノート配列と一般的なラッパーを受け付ける。外部画像URL・スクリプト・イベント属性は取り込まない。

## 音声

OpenAIキーは利用者が自分の端末で入力する。Realtime miniを標準とし、旧Speech APIも選択できる。APIキーをサーバーに埋め込む構成ではない。Realtimeは一時キーを取得してWebSocket接続し、生成後に接続を閉じる。UIにAI生成音声であることを表示する。

2026年10月31日に公式ドキュメントを確認し、読み上げ用モデルを9種類に拡張した。設定のモデル・声の選択肢とAPIの分岐は、`MEMORY_MODELS` / `MEMORY_VOICE_SETS` から生成する。

| モデル | 選べるOpenAIの声 |
| --- | --- |
| GPT-Realtime 2.1 mini / 2.1 / 2 / 1.5 / Realtime / Realtime mini | 10種類 |
| GPT-4o mini TTS | 13種類 |
| TTS-1 / TTS-1 HD | 9種類 |

声は全13種類のMarin、Cedar、Alloy、Ash、Ballad、Coral、Echo、Fable、Nova、Onyx、Sage、Shimmer、Verseをモデルに応じて表示する。RealtimeではFable・Nova・Onyxを表示せず、TTS-1系ではMarin・Cedar・Ballad・Verseを表示しない。モデル変更時、選択中の声が対応していれば維持し、未対応ならそのモデルの既定の声へ切り替えて表示で知らせる。API呼び出し前にも組み合わせを検証し、TTS-1系には未対応のinstructionsを送らない。

端末TTSの声はWeb Speech APIでその端末の一覧を取得し、日本語を先頭に表示する。`voiceschanged` で遅れて読み込まれた声も更新し、選択はvoiceURIで端末に保存する。保存した声が一時的に見つからない場合も設定を失わず、再生は日本語の声へ自動で戻す。OpenAIのモデル・声の変更では自動生成を行わず、「音声生成・保存」を押したときだけAPIを使う。

2026年11月1日に自由文の話し方・トーン指定を追加した。GPT-4o mini TTSとRealtime系では入力欄を表示し、instructionsへ読み方の指定として送る。例は「明るく親しみやすく。重要な単語は少し強調する」。本文自体には付加せず、元の語句をそのまま読む指示を維持する。TTS-1／TTS-1 HDでは入力欄ごと非表示・無効にし、APIにも指定を送らない。入力は端末に保存して、対応モデルへ戻したら復元する。端末TTSには自由文のトーンを適用しない。

モデル名の横には会話調／朗読、速度・品質の優先、自由文対応などの特徴を、声名の横には「Nova｜明るく快活」「Onyx｜低く重厚」など選び方の目安を表示する。声質の説明は本アプリでの目安であり、OpenAIが定める固定分類ではない。モデル・言語・読み方の指示によって実際の印象は変わる。選択欄を全幅にし、選択中のモデル・声の説明は欄外にも表示する。

音声は行ごとに生成し、長い行は上限内で分割する。本文・モデル・声・対応するトーンのSHA-256をキャッシュキーにして、生成済みの部分を再利用する。別のトーンで生成した音声を取り違えず、同じ指定へ戻したときは既存音声を再利用する。トーンが空または非対応なら従来のキーをそのまま使用し、旧バージョンの保存音声も再利用する。速度・行間・マーカー・チェックの変更では音声生成APIを再度呼び出さない。中止や通信失敗の前に保存できた部分も再利用する。

iPhoneでの画面オフ再生は、保存音声を通常のHTML audioで再生する。行間の無音と30回分の繰り返しはWAVに組み込み、バックグラウンドのJavaScriptタイマーで進めない。無限はaudio.loopを使う。再生速度を変更しても行間の実時間を保つため、WAVの無音区間を調整する。速度はaudio.playbackRateで設定するので、書き出したファイルでは再生アプリ側で速度を選ぶ。

Safariで画面を表示して再生を開始してからロックする。Media Sessionの再生・一時停止・停止・シークにも対応する。iOSやアプリ内ブラウザによる停止を完全には制御できず、実機の画面ロック試験は別途必要。端末TTSは未生成時の代替で、画面オフ中の継続は保証しない。

参考：[OpenAI Docs：モデル一覧](https://developers.openai.com/api/docs/models)、[Text to speech](https://developers.openai.com/api/docs/guides/text-to-speech)、[Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations)、[Media Session](https://developer.mozilla.org/en-US/docs/Web/API/MediaSession)。旧Speech APIのTTSモデルは2027年1月6日の終了予定が案内されているため、標準はRealtimeにしている。

## 検証

通常の検証は `node --test tests/*.test.cjs`。音声APIのテストは実キーを使わず、応答を模擬する。生成されたPCMのキャッシュ、トーンによる音声の区別と旧保存音声の互換、対応APIへのinstructions・非対応APIへの非送信、WAVヘッダー、行間、30回分の構成、Realtimeの認証・イベント順序・中止・失敗を検証する。

追加のブラウザ検証は `tests/memory-browser.cjs`。Playwrightをプロジェクト外の一時ディレクトリに導入し、`NODE_PATH=<一時ディレクトリ>/node_modules node tests/memory-browser.cjs` で実行できる。macOSでは通常のChromeの実行ファイルを使って、個人のプロファイルから分離したテスト用コンテキストを起動する。他環境のChrome実行ファイルは `RVT_CHROME_PATH` で指定できる。ローカルHTTPサーバーはテストが自動起動する。外部通信を遮断し、380pxで編集・選択消失・画像・保存復元・読込書出・キャッシュ・再生停止・TTSなどを検証する。
