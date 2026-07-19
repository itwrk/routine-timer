#!/bin/zsh
cd "$(dirname "$0")" || exit 1
if [ ! -f "./index.html" ]; then
  echo "❌ このフォルダに index.html がありません"
  read -k1 -s "?キーを押して閉じる..."
  exit 1
fi
echo "📄 対象: $(pwd)/index.html（更新: $(date -r index.html '+%m/%d %H:%M)）"
git add -A
if git diff --cached --quiet; then
  echo "ℹ️ 変更なし。最新版を上書き保存してから再実行してください"
  read -k1 -s "?キーを押して閉じる..."
  exit 0
fi
git commit -m "update $(date +%Y-%m-%d_%H:%M)"
if git push; then
  echo "✅ デプロイ完了！1〜2分で反映されます"
  sleep 2
  open "https://itwrk.github.io/routine-timer/"
else
  echo "⚠️ push失敗。GitHub DesktopでPullしてから再実行"
fi
read -k1 -s "?キーを押して閉じる..."