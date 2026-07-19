#!/bin/zsh
cd "$(dirname "$0")" || exit 1
LATEST=$(ls -t ~/Downloads/index*.html 2>/dev/null | head -1)
if [ -z "$LATEST" ]; then
  echo "❌ ~/Downloads に index.html が見つかりません"
  read -k1 -s "?キーを押して閉じる..."
  exit 1
fi
echo "📄 使用: $LATEST"
cp "$LATEST" ./index.html
git add -A
git commit -m "update $(date +%Y-%m-%d_%H:%M)"
if git push; then
  echo "✅ デプロイ完了！1〜2分で反映されます"
  rm -f ~/Downloads/index*.html
  sleep 2
  open "https://itwrk.github.io/routine-timer/"
else
  echo "⚠️ push失敗。GitHub DesktopでPullしてから再実行"
fi
read -k1 -s "?キーを押して閉じる..."