#!/usr/bin/env bash
# ---------------------------------------------------------------------------
#  راه‌اندازیِ استقرار — هر چه ماشین می‌تواند خودش انجام دهد، می‌دهد؛ بقیه را
#  اسم‌به‌اسم می‌گوید.
#
#      cd deploy
#      ./setup.sh            فقط بررسی و آماده‌سازی
#      ./setup.sh --up       اگر همه‌چیز سبز بود، بالا هم بیاورد
#
#  چرا این فایل هست: تا امروز راه‌اندازی یعنی خواندنِ README، کپیِ .env، به‌یاد
#  آوردنِ openssl، و بعد فهمیدنِ اینکه رکوردِ DNS جا افتاده — از روی خطای
#  گنگِ Let's Encrypt. این‌جا همان‌ها پیش از بالا آمدن گفته می‌شود.
#
#  خروجیِ ۱ یعنی چیزی هست که بدونِ شما حل نمی‌شود.
# ---------------------------------------------------------------------------
set -uo pipefail

cd "$(dirname "$0")" || exit 1

BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GRN=$'\033[32m'
YEL=$'\033[33m'; CYN=$'\033[36m'; OFF=$'\033[0m'
if [ ! -t 1 ]; then BOLD=""; DIM=""; RED=""; GRN=""; YEL=""; CYN=""; OFF=""; fi

blockers=()   # بدونِ شما حل نمی‌شود
notes=()      # کار می‌کند، ولی بهتر است بدانید
did=()        # خودش انجام شد

ok()   { printf '  %s✅%s %s\n' "$GRN" "$OFF" "$1"; }
warn() { printf '  %s⚠️ %s %s\n' "$YEL" "$OFF" "$1"; }
bad()  { printf '  %s❌%s %s\n' "$RED" "$OFF" "$1"; }
head2() { printf '\n%s%s%s\n' "$BOLD" "$1" "$OFF"; }

# ---------------------------------------------------------------------------
#  ابزارهای کوچک
# ---------------------------------------------------------------------------

# مقدارِ یک کلید از .env — بدونِ source کردن، چون .env فایلِ داده است نه اسکریپت
envget() {
  [ -f .env ] || return 0
  sed -n "s/^[[:space:]]*$1=//p" .env | head -1 | sed 's/[[:space:]]*$//' | tr -d '\042\047'
}

resolve_a() {
  if command -v dig >/dev/null 2>&1; then
    dig +short +time=3 +tries=1 A "$1" 2>/dev/null | grep -Eo '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' | head -1
  elif command -v host >/dev/null 2>&1; then
    host -t A "$1" 2>/dev/null | awk '/has address/{print $4; exit}'
  elif command -v getent >/dev/null 2>&1; then
    getent ahostsv4 "$1" 2>/dev/null | awk '{print $1; exit}'
  fi
}

port_busy() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltnH 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1\$"
  elif command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1\$"
  else
    return 1
  fi
}

random_hex32() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  elif command -v node >/dev/null 2>&1; then
    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  elif [ -r /dev/urandom ]; then
    od -An -tx1 -N32 /dev/urandom | tr -d ' \n'; echo
  fi
}

printf '%s%s%s\n' "$BOLD" "راه‌اندازیِ استقرار — سرورِ پمپ یعقوبی" "$OFF"
printf '%s%s%s\n' "$DIM" "$(pwd)" "$OFF"

# ---------------------------------------------------------------------------
head2 "۱) ماشین"
# ---------------------------------------------------------------------------

if command -v docker >/dev/null 2>&1; then
  ok "داکر نصب است — $(docker --version 2>/dev/null | head -1)"
  if docker compose version >/dev/null 2>&1; then
    ok "docker compose در دسترس است"
  elif command -v docker-compose >/dev/null 2>&1; then
    warn "فقط docker-compose قدیمی هست. کار می‌کند، ولی «docker compose» تازه بهتر است."
  else
    bad "افزونهٔ compose نصب نیست"
    blockers+=("افزونهٔ docker compose را نصب کنید (بستهٔ docker-compose-plugin)")
  fi
  if ! docker info >/dev/null 2>&1; then
    bad "به دیمنِ داکر دسترسی نیست"
    blockers+=("داکر روشن نیست یا کاربرتان در گروهِ docker نیست: sudo usermod -aG docker \$USER و بعد خروج و ورودِ دوباره")
  fi
else
  bad "داکر نصب نیست"
  blockers+=("داکر را نصب کنید: curl -fsSL https://get.docker.com | sh")
fi

if command -v free >/dev/null 2>&1; then
  mem_mb=$(free -m 2>/dev/null | awk '/^Mem:/{print $2}')
  if [ -n "${mem_mb:-}" ]; then
    if [ "$mem_mb" -ge 1800 ]; then
      ok "حافظه: ${mem_mb} مگابایت"
    else
      warn "حافظه فقط ${mem_mb} مگابایت است — دو گیگ توصیه شده"
      notes+=("حافظهٔ ماشین کمتر از ۲ گیگ است؛ زیرِ فشار ممکن است کانتینر کشته شود")
    fi
  fi
fi

free_kb=$(df -Pk . 2>/dev/null | awk 'NR==2{print $4}')
if [ -n "${free_kb:-}" ] && [ "$free_kb" -lt 3145728 ]; then
  warn "کمتر از ۳ گیگ فضای خالی روی این پارتیشن"
  notes+=("فضای دیسک کم است — ایمیجِ پنل و Caddy حدود ۱.۵ گیگ می‌گیرند")
fi

# ---------------------------------------------------------------------------
head2 "۲) فایلِ .env"
# ---------------------------------------------------------------------------

if [ ! -f .env ]; then
  cp .env.example .env || { bad "ساختنِ .env ناموفق بود"; exit 1; }
  chmod 600 .env 2>/dev/null
  ok "فایلِ .env از روی .env.example ساخته شد"
  did+=(".env ساخته شد")
else
  ok "فایلِ .env هست"
fi

perm=$(stat -c '%a' .env 2>/dev/null || stat -f '%Lp' .env 2>/dev/null)
if [ -n "${perm:-}" ] && [ "$perm" != "600" ]; then
  chmod 600 .env 2>/dev/null && { ok "دسترسیِ .env به ۶۰۰ محدود شد"; did+=("دسترسیِ .env محدود شد"); }
fi

# --- SECRET_KEY: تنها رازی که واقعاً باید وجود داشته باشد ------------------
secret=$(envget SECRET_KEY)
if [ -z "$secret" ]; then
  gen=$(random_hex32)
  if [ -n "$gen" ]; then
    tmp=$(mktemp) && awk -v k="$gen" '
      /^[[:space:]]*SECRET_KEY=/ && !done { print "SECRET_KEY=" k; done=1; next } { print }
      END { if (!done) print "SECRET_KEY=" k }
    ' .env > "$tmp" && mv "$tmp" .env && chmod 600 .env
    ok "SECRET_KEY ساخته و در .env نوشته شد (۳۲ بایتِ تصادفی)"
    did+=("SECRET_KEY ساخته شد")
  else
    bad "هیچ‌کدام از openssl / node / dev/urandom در دسترس نبود"
    blockers+=("SECRET_KEY را دستی بگذارید: openssl rand -hex 32")
  fi
elif [ "${#secret}" -lt 32 ]; then
  warn "SECRET_KEY هست ولی کوتاه است (${#secret} نویسه)"
  notes+=("SECRET_KEY کوتاه است — با openssl rand -hex 32 عوضش کنید (توکن‌های فعلی باطل می‌شوند)")
else
  ok "SECRET_KEY هست"
fi

# --- ACME_EMAIL --------------------------------------------------------------
acme=$(envget ACME_EMAIL)
case "$acme" in
  ""|"you@example.com")
    warn "ACME_EMAIL پر نشده"
    notes+=("ACME_EMAIL: ایمیلِ خودتان را بگذارید تا Let's Encrypt هشدارِ انقضا بفرستد")
    ;;
  *) ok "ACME_EMAIL: $acme" ;;
esac

# ---------------------------------------------------------------------------
head2 "۳) دامنه و DNS"
# ---------------------------------------------------------------------------

domain=$(envget DOMAIN)
case "$domain" in
  ""|"YOURDOMAIN.com")
    bad "DOMAIN هنوز پر نشده"
    blockers+=("یک دامنه بگیرید و در .env بگذارید: DOMAIN=example.com — بدونِ آن compose عمداً بالا نمی‌آید")
    domain=""
    ;;
  *) ok "DOMAIN: $domain" ;;
esac

if [ -n "$domain" ]; then
  myip=$(curl -fsS --max-time 6 https://api.ipify.org 2>/dev/null)
  if [ -n "$myip" ]; then
    ok "IP عمومیِ این ماشین: $myip"
  else
    warn "IP عمومی پیدا نشد (اینترنت یا فایروالِ خروجی)"
    notes+=("نتوانستم IP عمومی را بگیرم، پس رکوردهای DNS را نسنجیدم")
  fi

  missing_dns=()
  for name in "$domain" "api.$domain" "admin.$domain" "files.$domain" "www.$domain"; do
    got=$(resolve_a "$name")
    if [ -z "$got" ]; then
      bad "$name → رکوردی پیدا نشد"
      missing_dns+=("$name")
    elif [ -n "$myip" ] && [ "$got" != "$myip" ]; then
      warn "$name → $got (با $myip نمی‌خواند)"
      missing_dns+=("$name")
    else
      ok "$name → $got"
    fi
  done

  if [ "${#missing_dns[@]}" -gt 0 ]; then
    blockers+=("رکوردِ A برای این نام‌ها به ${myip:-<IP سرور>} اشاره نمی‌کند: ${missing_dns[*]} — تا درست نشود Let's Encrypt گواهی نمی‌دهد")
  fi
fi

# ---------------------------------------------------------------------------
head2 "۴) پورت‌ها"
# ---------------------------------------------------------------------------

stack_up=0
docker compose ps --status running -q 2>/dev/null | grep -q . && stack_up=1

for p in 80 443; do
  if port_busy "$p"; then
    if [ "$stack_up" = "1" ]; then
      ok "پورت $p در اختیارِ همین استقرار است"
    else
      bad "پورت $p را چیزِ دیگری گرفته"
      blockers+=("پورت $p را آزاد کنید (معمولاً nginx یا apache): sudo ss -ltnp | grep :$p")
    fi
  else
    ok "پورت $p آزاد است"
  fi
done

if [ -n "$domain" ]; then
  notes+=("پورت‌های ۸۰ و ۴۴۳ باید از اینترنت به این ماشین برسند — روی مودم/فایروالِ ابری خودتان باز کنید. ۸۰ فقط برای صدورِ گواهی است ولی حذف‌شدنی نیست.")
fi

# ---------------------------------------------------------------------------
head2 "۵) ورود با کدِ شش‌رقمی (اپِ اندروید)"
# ---------------------------------------------------------------------------

sms_key=$(envget OTP_SMS_KEY)
mail_pass=$(envget OTP_EMAIL_PASS)
if [ -n "$sms_key" ] || [ -n "$mail_pass" ]; then
  [ -n "$sms_key" ]   && ok "پیامک پیکربندی شده"
  [ -n "$mail_pass" ] && ok "ایمیل پیکربندی شده"
else
  warn "نه پیامک نه ایمیل — کدِ ورود فقط در «پنل ← لاگ‌ها» نوشته می‌شود"
  notes+=("برای کاربرِ واقعی، OTP_SMS_KEY (پنلِ پیامک) یا OTP_EMAIL_PASS (App Password جی‌میل) را در .env بگذارید")
fi

if [ "$(envget OTP_ECHO)" = "1" ]; then
  bad "OTP_ECHO=1 روشن است — کدِ ورود در پاسخِ HTTP برمی‌گردد"
  blockers+=("OTP_ECHO را ۰ کنید یا خطش را پاک کنید؛ با آن هر کسی می‌تواند به‌جای هر کاربری وارد شود")
fi

# ---------------------------------------------------------------------------
head2 "۶) سخت‌کردنِ پنل"
# ---------------------------------------------------------------------------

if grep -q '^[[:space:]]*#[[:space:]]*@external not remote_ip' Caddyfile 2>/dev/null; then
  warn "admin.${domain:-<دامنه>} از کلِ اینترنت باز خواهد بود"
  notes+=("در Caddyfile دو خطِ کامنت‌شدهٔ @external هست که پنل را فقط از شبکهٔ داخلی باز می‌کند. آن‌جا فایل‌منیجر و ترمینال است — اگر از بیرون لازمش ندارید، از کامنت درشان بیاورید.")
else
  ok "دسترسیِ admin محدود شده است"
fi

# ---------------------------------------------------------------------------
#  جمع‌بندی
# ---------------------------------------------------------------------------

printf '\n%s%s%s\n' "$BOLD" "─── جمع‌بندی ───────────────────────────────────────────" "$OFF"

if [ "${#did[@]}" -gt 0 ]; then
  printf '\n%sخودش انجام شد:%s\n' "$GRN" "$OFF"
  for d in "${did[@]}"; do printf '  • %s\n' "$d"; done
fi

if [ "${#notes[@]}" -gt 0 ]; then
  printf '\n%sبهتر است بدانید:%s\n' "$YEL" "$OFF"
  for n in "${notes[@]}"; do printf '  • %s\n' "$n"; done
fi

if [ "${#blockers[@]}" -gt 0 ]; then
  printf '\n%sبدونِ شما حل نمی‌شود:%s\n' "$RED" "$OFF"
  i=1
  for b in "${blockers[@]}"; do printf '  %d. %s\n' "$i" "$b"; i=$((i+1)); done
  printf '\n%sوقتی این‌ها را درست کردید، دوباره همین اسکریپت را بزنید.%s\n' "$DIM" "$OFF"
  exit 1
fi

printf '\n%sهمه‌چیز آماده است.%s\n' "$GRN" "$OFF"

if [ "${1:-}" = "--up" ]; then
  printf '%sdocker compose up -d --build%s\n\n' "$CYN" "$OFF"
  docker compose up -d --build || exit 1
  printf '\n%sبالا آمد. آدرسی که اپِ اندروید باید بشناسد:%s\n' "$BOLD" "$OFF"
  printf '  https://api.%s\n' "${domain:-<دامنه>}"
else
  printf '%sبرای بالا آوردن:%s docker compose up -d --build\n' "$DIM" "$OFF"
  printf '%s(یا همین اسکریپت با --up)%s\n' "$DIM" "$OFF"
fi
