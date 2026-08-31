#!/usr/bin/env bash
# ---------------------------------------------------------------------------
#  به‌روزرسانی از GitHub — لینوکس و مک
#      ./update.sh            نصب آخرین نسخه
#      ./update.sh --check    فقط بررسی
#      ./update.sh --rollback برگشت به نسخهٔ قبل
# ---------------------------------------------------------------------------
set -u
cd "$(dirname "$0")/server" || exit 1

echo
echo "=============================================================="
echo "  به‌روزرسانی برنامه از GitHub"
echo "=============================================================="
echo

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js پیدا نشد. نسخهٔ ۲۲ یا بالاتر لازم است."
  exit 1
fi

MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$MAJOR" -lt 22 ]; then
  echo "❌ Node.js نسخهٔ $MAJOR دارید؛ نسخهٔ ۲۲ یا بالاتر لازم است."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "→ نصب وابستگی‌ها..."
  npm install --omit=dev --no-audit --no-fund || exit 1
fi

node scripts/update.mjs "$@"
CODE=$?

echo
case "$CODE" in
  0)  echo "✅ تمام شد. حالا ./server/start-linux.sh را اجرا کنید." ;;
  10) echo "ℹ️  فقط بررسی شد." ;;
  *)  echo "❌ به‌روزرسانی ناموفق بود. نسخهٔ قبلی دست‌نخورده است." ;;
esac
exit "$CODE"
