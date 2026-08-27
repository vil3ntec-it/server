#!/usr/bin/env bash
# ---------------------------------------------------------------------------
#  نصب مرکز فرمان و پنل سرور خانگی — لینوکس و مک
#
#      chmod +x نصب.sh
#      ./نصب.sh
#
#  کاری که می‌کند: Node را می‌سنجد، وابستگی‌ها را نصب می‌کند، .env را می‌سازد،
#  سلامت نصب را بررسی می‌کند و پنل را بالا می‌آورد.
#  اگر از قبل نصب باشد، چیزی را خراب نمی‌کند.
# ---------------------------------------------------------------------------
set -u
cd "$(dirname "$0")" || exit 1

BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; RESET=$'\033[0m'
ok()   { printf '      %s[OK]%s %s\n' "$GREEN" "$RESET" "$1"; }
bad()  { printf '\n  %s[X]%s %s\n' "$RED" "$RESET" "$1"; }

echo
echo "=============================================================="
echo "   ${BOLD}نصب مرکز فرمان و پنل سرور خانگی${RESET}"
echo "=============================================================="
echo

# ── ۱) Node.js ─────────────────────────────────────────────────────────────
echo "[1/5] بررسی Node.js ..."
if ! command -v node >/dev/null 2>&1; then
  bad "Node.js نصب نیست."
  echo "      روی اوبونتو/دبیان:"
  echo "        ${DIM}curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -${RESET}"
  echo "        ${DIM}sudo apt-get install -y nodejs${RESET}"
  echo "      یا از nodejs.org نسخهٔ LTS را بگیرید."
  exit 1
fi

MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$MAJOR" -lt 22 ]; then
  bad "Node.js نسخهٔ $MAJOR دارید؛ نسخهٔ ۲۲ یا بالاتر لازم است."
  exit 1
fi
ok "Node.js نسخهٔ $MAJOR"

# ── ۲) وابستگی‌ها ──────────────────────────────────────────────────────────
echo
echo "[2/5] نصب وابستگی‌ها (فقط بار اول، به اینترنت نیاز دارد) ..."
cd server || exit 1
if [ -d node_modules/express ]; then
  ok "از قبل نصب است"
else
  if ! npm install --omit=dev --no-audit --no-fund; then
    bad "نصب وابستگی‌ها ناموفق بود. اینترنت را بررسی کنید."
    exit 1
  fi
  ok "نصب شد"
fi

# ── ۳) فایل تنظیمات ────────────────────────────────────────────────────────
echo
echo "[3/5] فایل تنظیمات ..."
if [ -f .env ]; then
  ok ".env از قبل هست — دست نخورد"
else
  cp .env.example .env
  ok ".env از روی نمونه ساخته شد"
fi

# ── ۴) بررسی سلامت ─────────────────────────────────────────────────────────
echo
echo "[4/5] بررسی سلامت نصب ..."
if ! node --disable-warning=ExperimentalWarning scripts/doctor.mjs; then
  bad "بررسی سلامت مشکل پیدا کرد. پیام بالا را بخوانید."
  exit 1
fi

# ── ۵) اجرا ────────────────────────────────────────────────────────────────
echo
echo "[5/5] راه‌اندازی پنل ..."
echo
echo "=============================================================="
echo "   آدرس پنل روی همین کامپیوتر:  http://localhost:${HLP_PORT:-4700}"
echo
echo "   بار اول یک نام کاربری و رمز مدیر می‌سازید."
echo "   برای همیشه‌روشن بودن: ${DIM}./server/service-linux.sh${RESET}"
echo "=============================================================="
echo

exec node --disable-warning=ExperimentalWarning src/index.js
