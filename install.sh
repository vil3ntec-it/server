#!/usr/bin/env bash
# ---------------------------------------------------------------------------
#  VILL3N — نصب‌کنندهٔ یک‌دستورهٔ سرورِ خانگی (بندِ ۱۰.۳ی پرامپت)
#
#      curl -fsSL https://api.<دامنه>/install.sh | sudo bash
#
#  روی یک سرورِ تازهٔ دبیان/اوبونتو همه‌چیز را از صفر آماده می‌کند: پیش‌نیازها،
#  Node LTS، Caddy، cloudflared، Tailscale، Ollama و مدل، Docker، ساختارِ
#  پوشه‌ها، رازها، سرویسِ systemd، فایروال، Fail2ban، به‌روزرسانیِ امنیتیِ
#  خودکار، و دستورِ «vill3n».
#
#  قاعده‌ها:
#    • idempotent — اجرای دوباره هیچ‌چیزی را خراب نمی‌کند و چیزی را دوباره
#      نمی‌سازد؛ رازها هیچ‌وقت بازنویسی نمی‌شوند
#    • ادامه از نقطهٔ قطع — هر مرحله در <ریشه>/.install-state ثبت می‌شود
#    • هر دانلود ۵ بار با فاصلهٔ فزاینده، و برای هر ابزار یک منبعِ جایگزین
#    • فقط دو پرسش: ایمیلِ مدیر، و دامنه (+ توکنِ Cloudflare، اختیاری)
#    • لاگِ کامل در <ریشه>/logs/core/install/، گزارشِ پایانی روی صفحه
#
#  گزینه‌ها و متغیرها (برای اجرای بی‌پرسش و برای آزمون):
#    --non-interactive          هیچ پرسشی؛ مقدارها از VILL3N_* یا پیش‌فرض
#    --repair                   همهٔ مرحله‌ها دوباره (هر کدام اگر سالم باشد رد می‌شود)
#    --list-steps               فقط نامِ مرحله‌ها را چاپ کن
#    VILL3N_ADMIN_EMAIL · VILL3N_DOMAIN · VILL3N_CF_TOKEN   جوابِ دو پرسش
#    VILL3N_ROOT=/srv/vill3n    ریشه (برای آزمون جای دیگری)
#    VILL3N_SKIP_SYSTEM=1       مرحله‌های apt/systemd/ufw/caddy/docker/ollama رد
#                               می‌شوند (در گزارش «رد شد») — تا ماشینِ حالت،
#                               پوشه‌ها، رازها، کد و CLI بی‌root سنجیده شوند
#    VILL3N_PANEL_SRC=/path     به‌جای کلون، همین پوشه کپی شود (آزمون)
#    VILL3N_ACCOUNT_SRC=/path   همان برای سرورِ حساب (shop/server)
#    VILL3N_STOP_AFTER=<مرحله>  بعد از آن مرحله با کدِ ۷۵ بیرون بیا (آزمونِ ادامه)
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="${VILL3N_ROOT:-/srv/vill3n}"
SKIP_SYSTEM="${VILL3N_SKIP_SYSTEM:-0}"
NON_INTERACTIVE="${VILL3N_NON_INTERACTIVE:-0}"
REPAIR=0
LIST_STEPS=0
for arg in "$@"; do
  case "$arg" in
    --non-interactive) NON_INTERACTIVE=1 ;;
    --repair) REPAIR=1 ;;
    --list-steps) LIST_STEPS=1 ;;
    --root=*) ROOT="${arg#--root=}" ;;
    -h|--help)
      sed -n '2,32p' "$0" | sed 's/^#//'
      exit 0 ;;
    *) echo "گزینهٔ ناشناخته: $arg" >&2; exit 2 ;;
  esac
done

PANEL_REPO="${VILL3N_PANEL_REPO:-https://github.com/vil3ntec-it/server}"
PANEL_BRANCH="${VILL3N_PANEL_BRANCH:-main}"
ACCOUNT_REPO="${VILL3N_ACCOUNT_REPO:-https://github.com/vil3ntec-it/shop}"
ACCOUNT_BRANCH="${VILL3N_ACCOUNT_BRANCH:-main}"

STATE="$ROOT/.install-state"
FACTS="$ROOT/.install-facts"
REPORT="$ROOT/.install-report"
LOG_DIR="$ROOT/logs/core/install"
SECRETS="$ROOT/secrets"
CORE_ENV="$SECRETS/core.env"
ANSWERS="$SECRETS/answers.env"
CF_TOKEN_FILE="$SECRETS/cloudflared.token"
PANEL_DIR="$ROOT/core/panel"
SERVER_DIR="$PANEL_DIR/homelab-panel/server"
ACCOUNT_DIR="$ROOT/core/account-server"
ACCOUNT_SERVER_DIR="$ACCOUNT_DIR/server"
DATA_DIR="$ROOT/data/core"
PANEL_PORT="${VILL3N_PANEL_PORT:-4700}"
PUBLIC_PORT="${VILL3N_PUBLIC_PORT:-4701}"
UNIT="vill3n-panel"
RETRY_BASE="${VILL3N_RETRY_BASE:-5}"

#  ترتیبِ مرحله‌ها — همین فهرست در .install-state می‌نشیند
STEPS="detect_system ask_questions install_base install_node install_docker install_caddy install_cloudflared install_tailscale install_ollama create_layout gen_secrets fetch_panel fetch_account_server install_deps install_cli setup_systemd setup_caddy setup_firewall setup_fail2ban setup_unattended setup_cloudflared pull_model start_panel"

if [ "$LIST_STEPS" = 1 ]; then
  echo "$STEPS"
  exit 0
fi

# ---------------------------------------------------------------------------
#  ابزارهای کوچک
# ---------------------------------------------------------------------------
need() { command -v "$1" >/dev/null 2>&1; }
is_root() { [ "$(id -u)" = 0 ]; }
now() { date '+%Y-%m-%d %H:%M:%S'; }
log() { printf '%s  %s\n' "$(now)" "$*"; }
die() { log "❌ $*"; exit 1; }

# در لینوکس /usr/local/bin در PATHِ sudo هست ولی /snap/bin نه
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin:$PATH"
export DEBIAN_FRONTEND=noninteractive

#  گزارش: هر قلم یک سطر «نام<TAB>حال<TAB>یادداشت» — حال: installed · present · skipped · failed · done
record() { printf '%s\t%s\t%s\n' "$1" "$2" "${3:-}" >> "$REPORT.tmp"; }

#  ۵ تلاش با فاصلهٔ فزاینده (۵، ۱۰، ۱۵، ۲۰، ۲۵ ثانیه)
retry() {
  local i
  for i in 1 2 3 4 5; do
    if "$@"; then return 0; fi
    log "  ↻ تلاشِ $i از ۵ ناموفق بود: $1 …"
    [ "$i" -lt 5 ] && sleep $((i * RETRY_BASE))
  done
  return 1
}

#  یک مرحله: اگر از قبل ثبت شده رد می‌شود (مگر --repair)؛ وگرنه اجرا و ثبت
step() {
  local name="$1"
  if [ "$REPAIR" != 1 ] && grep -qx "$name" "$STATE" 2>/dev/null; then
    log "  ✔ $name — از قبل انجام شده"
    record "$name" done "از اجرای قبل"
    return 0
  fi
  log "▶ $name"
  load_answers
  "$name"
  grep -qx "$name" "$STATE" 2>/dev/null || echo "$name" >> "$STATE"
  if [ "${VILL3N_STOP_AFTER:-}" = "$name" ]; then
    log "⏹ توقفِ آزمایشی بعد از «$name» (VILL3N_STOP_AFTER)"
    exit 75
  fi
}

#  مرحله‌های سیستمی که با VILL3N_SKIP_SYSTEM=1 رد می‌شوند
skip_system() {
  if [ "$SKIP_SYSTEM" = 1 ]; then
    log "  ⏭ $1 — رد شد (VILL3N_SKIP_SYSTEM=1)"
    record "$1" skipped "VILL3N_SKIP_SYSTEM=1"
    return 0
  fi
  return 1
}

#  نوشتنِ فایل فقط اگر محتوا عوض شده — تا اجرای دوباره هیچ mtime را دست نزند
write_if_changed() {
  local target="$1" tmp="$1.tmp.$$"
  cat > "$tmp"
  if [ -f "$target" ] && cmp -s "$tmp" "$target"; then rm -f "$tmp"; return 1; fi
  mv -f "$tmp" "$target"
  return 0
}

download() { # url dest
  curl -fsSL --connect-timeout 20 --max-time 900 -o "$2" "$1"
}

apt_install() { retry apt-get install -y -q "$@"; }

# ---------------------------------------------------------------------------
#  مرحله‌ها
# ---------------------------------------------------------------------------
detect_system() {
  OS_ID="unknown"; OS_VER=""; OS_NAME="unknown"
  if [ -r /etc/os-release ]; then
    OS_ID="$(. /etc/os-release && echo "${ID:-unknown}")"
    OS_VER="$(. /etc/os-release && echo "${VERSION_ID:-}")"
    OS_NAME="$(. /etc/os-release && echo "${PRETTY_NAME:-$OS_ID}")"
  fi
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64|amd64) ARCH=x86_64; DEB_ARCH=amd64 ;;
    aarch64|arm64) ARCH=aarch64; DEB_ARCH=arm64 ;;
    *) DEB_ARCH="$ARCH" ;;
  esac
  RAM_GB=0
  if [ -r /proc/meminfo ]; then RAM_GB=$(( $(awk '/MemTotal/{print $2}' /proc/meminfo) / 1024 / 1024 )); fi
  local free_kb; free_kb="$(df -Pk "$(dirname "$ROOT")" 2>/dev/null | awk 'NR==2{print $4}')"; [ -n "$free_kb" ] || free_kb=0
  DISK_FREE_GB=$(( free_kb / 1024 / 1024 ))
  HAS_GPU=0; VRAM_GB=0
  if need nvidia-smi && nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits >/dev/null 2>&1; then
    HAS_GPU=1
    VRAM_GB=$(( $(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | head -1 | tr -d ' ') / 1024 ))
  fi
  #  مدلِ هوش مصنوعی از روی سخت‌افزار (بندِ «تشخیصِ خودکار»)
  if [ "$HAS_GPU" = 1 ]; then
    if [ "$VRAM_GB" -ge 12 ]; then MODEL="qwen2.5:14b"; else MODEL="qwen2.5:7b"; fi
  elif [ "$RAM_GB" -ge 16 ]; then MODEL="qwen2.5:7b"
  elif [ "$RAM_GB" -ge 8 ]; then MODEL="qwen2.5:3b"
  else MODEL="qwen2.5:1.5b"; fi
  #  محدودیتِ منابع: پنل حداکثر یک‌چهارمِ رَم (دستِ‌کم ۵۱۲ مگ)، Ollama یک مدل و یک درخواست
  NODE_HEAP_MB=$(( RAM_GB * 1024 / 4 )); [ "$NODE_HEAP_MB" -lt 512 ] && NODE_HEAP_MB=512; [ "$NODE_HEAP_MB" -gt 4096 ] && NODE_HEAP_MB=4096
  #  پورتِ SSH — پیش از باز کردنِ فایروال لازم است، وگرنه در روی خودمان بسته می‌شود.
  #
  #  ⚠️ دو تلهٔ واقعی این‌جا هست:
  #   ۱) `p="$(grep …)"` وقتی هیچ خطِ `Port` نباشد کدِ ۱ برمی‌گرداند و زیرِ
  #      `set -e` **کلِ نصب** را می‌کشد. روی رانرِ گیت‌هاب دقیقاً همین شد:
  #      `sshd_config` هست ولی خطش `#Port 22`ِ کامنت‌شده است. `|| true`
  #      لازم است، نه تزئین.
  #   ۲) بسیاری از سیستم‌ها پورت را در `sshd_config.d/*.conf` عوض می‌کنند،
  #      نه در فایلِ اصلی. اگر آن‌ها خوانده نشوند، فایروال پورتِ ۲۲ را باز
  #      می‌کند و کاربر از سرورِ خودش بیرون می‌ماند.
  SSH_PORT=22
  local sshd_files="" p=""
  [ -r /etc/ssh/sshd_config ] && sshd_files="/etc/ssh/sshd_config"
  if [ -d /etc/ssh/sshd_config.d ]; then
    for f in /etc/ssh/sshd_config.d/*.conf; do [ -r "$f" ] && sshd_files="$sshd_files $f"; done
  fi
  if [ -n "$sshd_files" ]; then
    #  آخرین مقدارِ واقعی برنده است؛ خطِ کامنت‌شده مقدار نیست
    p="$(grep -hiE '^[[:space:]]*Port[[:space:]]+[0-9]+' $sshd_files 2>/dev/null | tail -1 | awk '{print $2}' || true)"
    [ -n "$p" ] && SSH_PORT="$p"
  fi
  SUPPORTED=0
  case "$OS_ID" in debian|ubuntu|raspbian|linuxmint|pop) SUPPORTED=1 ;; esac
  if [ "$SUPPORTED" != 1 ] && [ "$SKIP_SYSTEM" != 1 ]; then
    die "این نصب‌کننده فقط دبیان/اوبونتو (apt) را می‌شناسد؛ سیستمِ شما «$OS_NAME» است. برای توزیع‌های دیگر، پیش‌نیازها را دستی نصب کنید و با VILL3N_SKIP_SYSTEM=1 فقط پنل را بالا بیاورید."
  fi
  write_if_changed "$FACTS" <<EOF || true
OS_ID="$OS_ID"
OS_VER="$OS_VER"
OS_NAME="${OS_NAME//\"/}"
ARCH="$ARCH"
DEB_ARCH=$DEB_ARCH
RAM_GB=$RAM_GB
DISK_FREE_GB=$DISK_FREE_GB
HAS_GPU=$HAS_GPU
VRAM_GB=$VRAM_GB
MODEL=$MODEL
NODE_HEAP_MB=$NODE_HEAP_MB
SSH_PORT=$SSH_PORT
EOF
  log "  سیستم: $OS_NAME · $ARCH · رَم ${RAM_GB}G · دیسکِ آزاد ${DISK_FREE_GB}G · GPU: $([ "$HAS_GPU" = 1 ] && echo "دارد (${VRAM_GB}G)" || echo ندارد) · مدل: $MODEL"
  record "detect" present "$OS_NAME · $ARCH · RAM ${RAM_GB}G · model $MODEL"
}

ask_questions() {
  #  جواب‌ها همان لحظه روی دیسک می‌نشینند تا قطعِ برق بینِ پرسش و ساختِ رازها
  #  دوباره نپرسد — و ‎--repair‎ هم همان‌ها را بخواند
  mkdir -p "$SECRETS"; chmod 700 "$SECRETS" 2>/dev/null || true
  local email domain token
  email="${VILL3N_ADMIN_EMAIL:-}"; domain="${VILL3N_DOMAIN:-}"; token="${VILL3N_CF_TOKEN:-}"
  if [ -f "$ANSWERS" ]; then
    # shellcheck disable=SC1090
    . "$ANSWERS"
    email="${email:-${ADMIN_EMAIL:-}}"; domain="${domain:-${DOMAIN:-}}"
  fi
  if [ -f "$CORE_ENV" ]; then
    local d; d="$(grep -E '^HLP_DOMAIN=' "$CORE_ENV" | tail -1 | cut -d= -f2- || true)"
    [ -n "$d" ] && domain="${domain:-$d}"
  fi
  #  «curl … | bash» یعنی stdin خودِ اسکریپت است؛ پرسش فقط از /dev/tty
  if [ "$NON_INTERACTIVE" != 1 ] && { exec 3<>/dev/tty; } 2>/dev/null; then
    if [ -z "$email" ]; then
      printf '\n  ✉️  ایمیلِ مدیر (برای هشدارها و کدهای ورود): ' >&3
      read -r email <&3
    fi
    if [ -z "$domain" ] && [ ! -f "$ANSWERS" ]; then
      printf '  🌐 دامنه (مثلاً example.com؛ خالی = فقط شبکهٔ خانگی): ' >&3
      read -r domain <&3
      if [ -n "$domain" ] && [ -z "$token" ]; then
        printf '  ☁️  توکنِ تونلِ Cloudflare (اختیاری، Enter = بدونِ تونل): ' >&3
        read -r token <&3
      fi
    fi
    exec 3>&-
  fi
  domain="$(echo "$domain" | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#/.*$##; s/^www\.//')"
  [ -z "$email" ] && email="admin@${domain:-localhost}"
  write_if_changed "$ANSWERS" <<EOF || true
ADMIN_EMAIL="${email//\"/}"
DOMAIN="${domain//\"/}"
EOF
  chmod 600 "$ANSWERS"
  if [ -n "$token" ]; then
    printf '%s\n' "$token" > "$CF_TOKEN_FILE"; chmod 600 "$CF_TOKEN_FILE"
  fi
  ADMIN_EMAIL="$email"; DOMAIN="$domain"
  log "  مدیر: $email · دامنه: ${domain:-«شبکهٔ خانگی»} · تونل: $([ -s "$CF_TOKEN_FILE" ] 2>/dev/null && echo دارد || echo ندارد)"
  record "questions" present "email=$email domain=${domain:-none}"
}

load_answers() {
  ADMIN_EMAIL="admin@localhost"; DOMAIN=""
  # shellcheck disable=SC1090
  [ -f "$ANSWERS" ] && . "$ANSWERS" && ADMIN_EMAIL="${ADMIN_EMAIL:-admin@localhost}" && DOMAIN="${DOMAIN:-}"
  # shellcheck disable=SC1090
  [ -f "$FACTS" ] && . "$FACTS"
  return 0
}

install_base() {
  skip_system install_base && return 0
  retry apt-get update -q
  apt_install ca-certificates curl git gnupg lsb-release ufw fail2ban lm-sensors smartmontools unattended-upgrades apt-transport-https openssl
  record "base" installed "curl git ufw fail2ban lm-sensors smartmontools unattended-upgrades"
}

node_ok() { need node && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 22 ]; }

install_node_tarball() {
  #  منبعِ سوم: تاربالِ رسمیِ nodejs.org — وقتی نه NodeSource هست نه بستهٔ توزیع تازه است
  local base="https://nodejs.org/dist/latest-v22.x" arch file tmp
  case "$ARCH" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; *) return 1 ;; esac
  tmp="$(mktemp -d)"
  download "$base/SHASUMS256.txt" "$tmp/sums" || { rm -rf "$tmp"; return 1; }
  file="$(grep -oE "node-v22\.[0-9]+\.[0-9]+-linux-$arch\.tar\.xz" "$tmp/sums" | head -1 || true)"
  [ -n "$file" ] || { rm -rf "$tmp"; return 1; }
  download "$base/$file" "$tmp/$file" || { rm -rf "$tmp"; return 1; }
  ( cd "$tmp" && grep " $file\$" sums | sha256sum -c --quiet ) || { rm -rf "$tmp"; return 1; }
  tar -xJf "$tmp/$file" -C /usr/local --strip-components=1
  rm -rf "$tmp"
}

install_node() {
  skip_system install_node && return 0
  if node_ok; then record node present "$(node -v)"; return 0; fi
  if retry sh -c "curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - && apt-get install -y -q nodejs" && node_ok; then
    record node installed "NodeSource $(node -v)"
  elif retry install_node_tarball && node_ok; then
    record node installed "nodejs.org $(node -v)"
  elif apt_install nodejs npm && node_ok; then
    record node installed "بستهٔ توزیع $(node -v)"
  else
    die "Node.js ۲۲ نصب نشد — بی آن پنل بالا نمی‌آید"
  fi
}

install_docker() {
  skip_system install_docker && return 0
  if need docker; then record docker present "$(docker --version 2>/dev/null | head -1)"
  elif retry sh -c "curl -fsSL https://get.docker.com | sh"; then record docker installed "get.docker.com"
  elif apt_install docker.io docker-compose-v2; then record docker installed "بستهٔ توزیع"
  else record docker failed "نه get.docker.com نه بستهٔ توزیع — پنل بی داکر هم کار می‌کند"; return 0; fi
  systemctl enable --now docker >/dev/null 2>&1 || true
}

install_caddy_binary() {
  #  منبعِ سوم: باینریِ رسمی از caddyserver.com + سرویسِ خودمان
  local arch; case "$ARCH" in x86_64) arch=amd64 ;; aarch64) arch=arm64 ;; *) return 1 ;; esac
  download "https://caddyserver.com/api/download?os=linux&arch=$arch" /usr/local/bin/caddy.tmp || return 1
  install -m 755 /usr/local/bin/caddy.tmp /usr/local/bin/caddy && rm -f /usr/local/bin/caddy.tmp
  id caddy >/dev/null 2>&1 || useradd --system --home /var/lib/caddy --shell /usr/sbin/nologin caddy
  mkdir -p /etc/caddy /var/lib/caddy; chown caddy:caddy /var/lib/caddy
  cat > /etc/systemd/system/caddy.service <<'EOF'
[Unit]
Description=Caddy
After=network.target

[Service]
User=caddy
Group=caddy
ExecStart=/usr/local/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --force
AmbientCapabilities=CAP_NET_BIND_SERVICE
Restart=on-failure
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
}

install_caddy() {
  skip_system install_caddy && return 0
  if need caddy; then record caddy present "$(caddy version 2>/dev/null | head -1)"; return 0; fi
  if apt_install caddy; then record caddy installed "بستهٔ توزیع"
  elif retry sh -c "curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg && curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list && apt-get update -q && apt-get install -y -q caddy"; then
    record caddy installed "مخزنِ رسمیِ Caddy"
  elif retry install_caddy_binary; then record caddy installed "باینریِ caddyserver.com"
  else record caddy failed "هیچ منبعی جواب نداد — HTTPS/دامنه بی Caddy کار نمی‌کند"; return 0; fi
}

install_cloudflared() {
  skip_system install_cloudflared && return 0
  if need cloudflared; then record cloudflared present "$(cloudflared --version 2>/dev/null | head -1)"; return 0; fi
  if retry sh -c "curl -fsSL https://pkg.cloudflare.com/install.sh | bash && apt-get install -y -q cloudflared"; then
    record cloudflared installed "مخزنِ Cloudflare"
  elif retry sh -c "curl -fsSL -o /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$DEB_ARCH.deb && dpkg -i /tmp/cloudflared.deb"; then
    record cloudflared installed "بستهٔ GitHub"
  else record cloudflared failed "تونل بعداً با «vill3n repair» یا از پنل"; return 0; fi
}

install_tailscale() {
  skip_system install_tailscale && return 0
  if need tailscale; then record tailscale present "$(tailscale version 2>/dev/null | head -1)"; return 0; fi
  if retry sh -c "curl -fsSL https://tailscale.com/install.sh | sh"; then record tailscale installed "اسکریپتِ رسمی"
  elif apt_install tailscale; then record tailscale installed "بستهٔ توزیع"
  else record tailscale failed "دسترسیِ مدیریتی از راهِ دور فعلاً فقط با SSH"; return 0; fi
  systemctl enable --now tailscaled >/dev/null 2>&1 || true
}

install_ollama_binary() {
  local arch; case "$ARCH" in x86_64) arch=amd64 ;; aarch64) arch=arm64 ;; *) return 1 ;; esac
  local tmp; tmp="$(mktemp -d)"
  if download "https://github.com/ollama/ollama/releases/latest/download/ollama-linux-$arch.tgz" "$tmp/ollama.tgz"; then
    tar -xzf "$tmp/ollama.tgz" -C /usr/local
  else
    download "https://github.com/ollama/ollama/releases/latest/download/ollama-linux-$arch" /usr/local/bin/ollama || { rm -rf "$tmp"; return 1; }
    chmod 755 /usr/local/bin/ollama
  fi
  rm -rf "$tmp"
  id ollama >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin -m -d /usr/share/ollama ollama
  cat > /etc/systemd/system/ollama.service <<EOF
[Unit]
Description=Ollama
After=network-online.target

[Service]
ExecStart=/usr/local/bin/ollama serve
User=ollama
Group=ollama
Restart=always
RestartSec=3
Environment="OLLAMA_HOST=127.0.0.1:11434"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
Environment="OLLAMA_NUM_PARALLEL=1"

[Install]
WantedBy=default.target
EOF
  systemctl daemon-reload
}

install_ollama() {
  skip_system install_ollama && return 0
  if need ollama; then record ollama present "$(ollama --version 2>/dev/null | head -1)"
  elif retry sh -c "curl -fsSL https://ollama.com/install.sh | sh"; then record ollama installed "اسکریپتِ رسمی"
  elif retry install_ollama_binary; then record ollama installed "باینریِ GitHub"
  else record ollama failed "دستیار بعداً از خودِ پنل نصب می‌شود"; return 0; fi
  #  محدودیتِ منابع: یک مدل، یک درخواست — روی سرورِ خانگی بیشترش یعنی داغی
  mkdir -p /etc/systemd/system/ollama.service.d
  write_if_changed /etc/systemd/system/ollama.service.d/vill3n.conf <<'EOF' && systemctl daemon-reload || true
[Service]
Environment="OLLAMA_MAX_LOADED_MODELS=1"
Environment="OLLAMA_NUM_PARALLEL=1"
Environment="OLLAMA_HOST=127.0.0.1:11434"
EOF
  systemctl enable --now ollama >/dev/null 2>&1 || true
}

create_layout() {
  mkdir -p "$ROOT"/{core,sites/clients,apps,desktop-apps,shared,data/core,backups/{daily,weekly,monthly,offsite-queue},logs/core/install,secrets,docs}
  chmod 700 "$SECRETS"
  record layout present "$ROOT"
}

rand_hex() { openssl rand -hex "$1" 2>/dev/null || head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }

gen_secrets() {
  load_answers
  if [ -f "$CORE_ENV" ]; then
    chmod 600 "$CORE_ENV"
    record secrets present "از قبل — دست نخورد"
    return 0
  fi
  local admin_pass; admin_pass="V$(rand_hex 12)"
  ( umask 077; cat > "$CORE_ENV" ) <<EOF
# رازهای پنلِ VILL3N — یک بار ساخته شده، هیچ‌وقت بازنویسی نمی‌شود (دسترسی ۶۰۰)
HLP_SECRET_KEY=$(rand_hex 32)
HLP_ADMIN_USER=admin
HLP_ADMIN_PASSWORD=$admin_pass
HLP_ADMIN_EMAIL=$ADMIN_EMAIL
HLP_DATA_DIR=$DATA_DIR
HLP_SITES_ROOT=$ROOT/sites
HLP_LIBRARY_ROOT=$ROOT/data/library
HLP_BACKUP_ROOT=$ROOT/backups
HLP_BACKUP_KEY_DIR=$SECRETS
HLP_PORT=$PANEL_PORT
HLP_SITESYNC_PORT=$PUBLIC_PORT
HLP_TRUST_PROXY=true
HLP_DOMAIN=$DOMAIN
HLP_ACCOUNT_DIR=$ACCOUNT_SERVER_DIR
HLP_OLLAMA_URL=http://127.0.0.1:11434
HLP_AGENT_MODEL=${MODEL:-qwen2.5:3b}
NODE_OPTIONS=--max-old-space-size=${NODE_HEAP_MB:-1024}
VILL3N_ROOT=$ROOT
EOF
  chmod 600 "$CORE_ENV"
  record secrets installed "$CORE_ENV (۶۰۰)"
}

copy_tree() { # src dst — بی .git، با حفظِ پیوندها
  mkdir -p "$2"
  tar -C "$1" --exclude=.git -cf - . | tar -C "$2" -xf -
}

clone_once() { # repo branch dest
  rm -rf "$3"
  git clone --depth 1 --branch "$2" "$1" "$3"
}

sparse_clone_once() { # repo branch dest subdir
  rm -rf "$3"
  git clone --depth 1 --filter=blob:none --sparse --branch "$2" "$1" "$3" && git -C "$3" sparse-checkout set "$4"
}

fetch_repo() { # repo branch dest label
  local repo="$1" branch="$2" dest="$3" label="$4"
  if need git && retry clone_once "$repo" "$branch" "$dest.tmp"; then
    rm -rf "$dest"; mv "$dest.tmp" "$dest"; return 0
  fi
  #  منبعِ جایگزین: تاربالِ خودِ GitHub (بی git)
  rm -rf "$dest.tmp"
  local tgz; tgz="$(mktemp)"
  if retry download "$repo/archive/refs/heads/$branch.tar.gz" "$tgz"; then
    mkdir -p "$dest.tmp" && tar -xzf "$tgz" -C "$dest.tmp" --strip-components=1 && rm -rf "$dest" && mv "$dest.tmp" "$dest" && rm -f "$tgz"
    return 0
  fi
  rm -rf "$dest.tmp" "$tgz"
  log "  ❌ $label از هیچ منبعی نیامد"
  return 1
}

fetch_panel() {
  if [ -f "$SERVER_DIR/src/index.js" ]; then record panel present "$PANEL_DIR"; return 0; fi
  if [ -n "${VILL3N_PANEL_SRC:-}" ]; then
    [ -f "$VILL3N_PANEL_SRC/homelab-panel/server/src/index.js" ] || die "VILL3N_PANEL_SRC پوشهٔ مخزنِ پنل نیست: $VILL3N_PANEL_SRC"
    copy_tree "$VILL3N_PANEL_SRC" "$PANEL_DIR"
    record panel installed "کپی از $VILL3N_PANEL_SRC"
    return 0
  fi
  fetch_repo "$PANEL_REPO" "$PANEL_BRANCH" "$PANEL_DIR" "کدِ پنل" || die "کدِ پنل دانلود نشد"
  record panel installed "$PANEL_REPO ($PANEL_BRANCH)"
}

fetch_account_server() {
  if [ -f "$ACCOUNT_SERVER_DIR/src/index.js" ]; then record account-server present "$ACCOUNT_SERVER_DIR"; return 0; fi
  if [ -n "${VILL3N_ACCOUNT_SRC:-}" ]; then
    if [ -f "$VILL3N_ACCOUNT_SRC/server/src/index.js" ]; then copy_tree "$VILL3N_ACCOUNT_SRC/server" "$ACCOUNT_SERVER_DIR"
    elif [ -f "$VILL3N_ACCOUNT_SRC/src/index.js" ]; then copy_tree "$VILL3N_ACCOUNT_SRC" "$ACCOUNT_SERVER_DIR"
    else die "VILL3N_ACCOUNT_SRC پوشهٔ سرورِ حساب نیست: $VILL3N_ACCOUNT_SRC"; fi
    record account-server installed "کپی از $VILL3N_ACCOUNT_SRC"
    return 0
  fi
  #  فقط زیرپوشهٔ server لازم است؛ کلونِ sparse حجمِ مخزنِ shop را نمی‌آورد
  if need git && retry sparse_clone_once "$ACCOUNT_REPO" "$ACCOUNT_BRANCH" "$ACCOUNT_DIR.tmp" server \
     && [ -f "$ACCOUNT_DIR.tmp/server/src/index.js" ]; then
    rm -rf "$ACCOUNT_DIR"; mv "$ACCOUNT_DIR.tmp" "$ACCOUNT_DIR"
  else
    rm -rf "$ACCOUNT_DIR.tmp"
    if fetch_repo "$ACCOUNT_REPO" "$ACCOUNT_BRANCH" "$ACCOUNT_DIR" "سرورِ حساب"; then :; else
      record account-server failed "بعداً با «vill3n repair» — تا آن وقت ورودِ برنامه‌ها کار نمی‌کند"
      return 0
    fi
  fi
  record account-server installed "$ACCOUNT_REPO/server"
}

npm_ci_in() { # dir label
  if [ -d "$1/node_modules" ]; then record "deps-$2" present "node_modules از قبل هست"; return 0; fi
  need npm || { record "deps-$2" failed "npm نیست"; return 0; }
  if ( cd "$1" && retry npm ci --omit=dev --no-audit --no-fund ); then record "deps-$2" installed "npm ci --omit=dev"
  else record "deps-$2" failed "npm ci ناموفق — «vill3n repair»"; fi
}

install_deps() {
  [ -f "$SERVER_DIR/package.json" ] && npm_ci_in "$SERVER_DIR" panel
  [ -f "$ACCOUNT_SERVER_DIR/package.json" ] && npm_ci_in "$ACCOUNT_SERVER_DIR" account
  return 0
}

install_cli() {
  local bin_dir
  if is_root && [ "$SKIP_SYSTEM" != 1 ]; then bin_dir="${VILL3N_BIN_DIR:-/usr/local/bin}"; else bin_dir="${VILL3N_BIN_DIR:-$ROOT/bin}"; fi
  mkdir -p "$bin_dir"
  write_if_changed "$bin_dir/vill3n" <<EOF || true
#!/usr/bin/env bash
# دستورِ vill3n — پوسته‌ای روی homelab-panel/server/bin/vill3n.mjs
export VILL3N_ROOT="\${VILL3N_ROOT:-$ROOT}"
exec node --disable-warning=ExperimentalWarning "$SERVER_DIR/bin/vill3n.mjs" "\$@"
EOF
  chmod 755 "$bin_dir/vill3n"
  record cli present "$bin_dir/vill3n"
}

setup_systemd() {
  skip_system setup_systemd && return 0
  local node_bin; node_bin="$(command -v node)"
  write_if_changed "/etc/systemd/system/$UNIT.service" <<EOF && systemctl daemon-reload || true
[Unit]
Description=VILL3N panel (homelab-panel)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$SERVER_DIR
EnvironmentFile=$CORE_ENV
ExecStart=$node_bin --disable-warning=ExperimentalWarning src/index.js
Restart=always
RestartSec=3
KillSignal=SIGTERM
TimeoutStopSec=30
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF
  systemctl enable "$UNIT" >/dev/null 2>&1 || true
  record systemd present "$UNIT.service"
}

setup_caddy() {
  skip_system setup_caddy && return 0
  need caddy || { record caddyfile skipped "Caddy نصب نیست"; return 0; }
  load_answers
  mkdir -p /etc/caddy
  local tmp; tmp="$(mktemp)"
  if [ -n "$DOMAIN" ]; then
    cat > "$tmp" <<EOF
# VILL3N — ساخته‌شده توسط install.sh؛ تغییر از پنل یا با ‎vill3n repair‎ برمی‌گردد
$DOMAIN, api.$DOMAIN, admin.$DOMAIN {
	encode gzip
	# ⛔ پنل IPِ کاربر را از این سرآیندها می‌خواند و درخواستِ Caddy از خودِ همین
	# کامپیوتر (loopback) می‌آید؛ پس سرآیندی که خودِ کاربر ساخته نباید برسد،
	# وگرنه سقفِ نرخ و «فقط از شبکهٔ خانگی» با یک سرآیندِ جعلی دور می‌خورد.
	reverse_proxy 127.0.0.1:$PUBLIC_PORT {
		header_up -Cf-Connecting-Ip
		header_up -X-Real-Ip
		header_up X-Forwarded-For {remote_host}
	}
}
www.$DOMAIN {
	redir https://$DOMAIN{uri} permanent
}
EOF
  else
    cat > "$tmp" <<EOF
# VILL3N — بی دامنه: فقط HTTP روی شبکهٔ خانگی به پورتِ عمومیِ پنل
http://:80 {
	reverse_proxy 127.0.0.1:$PUBLIC_PORT {
		header_up -Cf-Connecting-Ip
		header_up -X-Real-Ip
		header_up X-Forwarded-For {remote_host}
	}
}
EOF
  fi
  if ! caddy validate --config "$tmp" --adapter caddyfile >/dev/null 2>&1; then
    rm -f "$tmp"; record caddyfile failed "Caddyfile معتبر نبود"; return 0
  fi
  if write_if_changed /etc/caddy/Caddyfile < "$tmp"; then
    systemctl enable caddy >/dev/null 2>&1 || true
    systemctl restart caddy >/dev/null 2>&1 || systemctl reload caddy >/dev/null 2>&1 || true
    record caddyfile installed "${DOMAIN:-http://:80} ⇒ 127.0.0.1:$PUBLIC_PORT"
  else
    systemctl enable --now caddy >/dev/null 2>&1 || true
    record caddyfile present "بی تغییر"
  fi
  rm -f "$tmp"
}

setup_firewall() {
  skip_system setup_firewall && return 0
  need ufw || { record firewall failed "ufw نیست"; return 0; }
  load_answers
  ufw --force default deny incoming >/dev/null
  ufw --force default allow outgoing >/dev/null
  ufw allow "${SSH_PORT:-22}/tcp" >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  #  پنل (۴۷۰۰) فقط از شبکهٔ خانگی و Tailscale — هرگز از اینترنت
  for net in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16; do ufw allow from "$net" to any port "$PANEL_PORT" proto tcp >/dev/null; done
  ufw allow in on tailscale0 >/dev/null 2>&1 || true
  ufw --force enable >/dev/null
  record firewall present "deny incoming · allow ${SSH_PORT:-22},80,443 · $PANEL_PORT فقط LAN/Tailscale"
}

setup_fail2ban() {
  skip_system setup_fail2ban && return 0
  need fail2ban-client || { record fail2ban failed "نصب نیست"; return 0; }
  load_answers
  mkdir -p /etc/fail2ban/jail.d
  write_if_changed /etc/fail2ban/jail.d/vill3n.conf <<EOF || true
[sshd]
enabled = true
port = ${SSH_PORT:-22}
maxretry = 5
bantime = 1h
findtime = 10m
EOF
  systemctl enable --now fail2ban >/dev/null 2>&1 || true
  systemctl reload fail2ban >/dev/null 2>&1 || true
  record fail2ban present "jail sshd روی پورتِ ${SSH_PORT:-22}"
}

setup_unattended() {
  skip_system setup_unattended && return 0
  write_if_changed /etc/apt/apt.conf.d/20auto-upgrades <<'EOF' || true
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
  systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true
  record unattended-upgrades present "به‌روزرسانیِ امنیتیِ خودکار روشن"
}

setup_cloudflared() {
  skip_system setup_cloudflared && return 0
  if [ ! -s "$CF_TOKEN_FILE" ]; then record tunnel skipped "توکنی داده نشد — بعداً از پنل یا با VILL3N_CF_TOKEN"; return 0; fi
  need cloudflared || { record tunnel failed "cloudflared نصب نیست"; return 0; }
  if systemctl is-enabled cloudflared >/dev/null 2>&1; then record tunnel present "سرویسِ cloudflared از قبل هست"; return 0; fi
  if cloudflared service install "$(cat "$CF_TOKEN_FILE")" >/dev/null 2>&1; then
    systemctl enable --now cloudflared >/dev/null 2>&1 || true
    record tunnel installed "cloudflared service"
  else
    record tunnel failed "cloudflared service install ناموفق — توکن درست است؟"
  fi
}

pull_model() {
  skip_system pull_model && return 0
  load_answers
  need ollama || { record model skipped "Ollama نیست"; return 0; }
  if ollama list 2>/dev/null | awk '{print $1}' | grep -qx "$MODEL"; then record model present "$MODEL"; return 0; fi
  #  دانلودِ مدل چند گیگ است: پس‌زمینه، با پیشرفت در لاگِ خودش؛ نصب منتظر نمی‌ماند
  nohup sh -c "for i in 1 2 3 4 5; do ollama pull '$MODEL' && exit 0; sleep \$((i*30)); done; exit 1" \
    > "$LOG_DIR/ollama-pull-$MODEL.log" 2>&1 &
  record model installed "$MODEL در پس‌زمینه — پیشرفت: $LOG_DIR/ollama-pull-$MODEL.log"
}

start_panel() {
  skip_system start_panel && return 0
  systemctl restart "$UNIT"
  local i
  for i in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:$PANEL_PORT/health" >/dev/null 2>&1; then
      record panel-service present "بالا آمد (${i}s)"
      return 0
    fi
    sleep 1
  done
  record panel-service failed "در ۶۰ ثانیه جواب نداد — journalctl -u $UNIT"
}

# ---------------------------------------------------------------------------
#  گزارشِ پایانی
# ---------------------------------------------------------------------------
report() {
  load_answers
  local admin_user="admin"
  [ -f "$CORE_ENV" ] && admin_user="$(grep -E '^HLP_ADMIN_USER=' "$CORE_ENV" | cut -d= -f2- || echo admin)"
  local url="http://<IPِ همین سرور>:$PANEL_PORT"
  [ -n "$DOMAIN" ] && url="https://admin.$DOMAIN  (و در شبکهٔ خانگی http://<IP>:$PANEL_PORT)"
  echo
  echo "════════════════════════════════════════════════════════════════"
  echo "  ✅ نصبِ VILL3N تمام شد"
  echo "════════════════════════════════════════════════════════════════"
  echo "  پنل:            $url"
  echo "  نامِ کاربری:    $admin_user"
  echo "  رمزِ اولیه:     در $CORE_ENV (HLP_ADMIN_PASSWORD) — فقط root می‌خواند"
  echo "  APIِ عمومی:     ${DOMAIN:+https://api.$DOMAIN  ·  }http://<IP>:$PUBLIC_PORT"
  echo "  دستور:          vill3n status | update | backup | agent on|off | repair | logs"
  echo "  لاگِ نصب:       $LOG_FILE"
  echo "────────────────────────────────────────────────────────────────"
  if [ -f "$REPORT.tmp" ]; then
    local name st note icon
    while IFS=$'\t' read -r name st note; do
      case "$st" in
        installed) icon="🆕 نصب شد  " ;;
        present)   icon="✔  هست     " ;;
        done)      icon="✔  قبلاً    " ;;
        skipped)   icon="⏭  رد شد   " ;;
        failed)    icon="❌ نشد     " ;;
        *)         icon="·  $st" ;;
      esac
      printf '  %s %-20s %s\n' "$icon" "$name" "$note"
    done < "$REPORT.tmp"
    #  فایلِ گزارش فقط اگر عوض شده نوشته می‌شود (اجرای دوباره = بی تغییر)
    write_if_changed "$REPORT" < "$REPORT.tmp" || true
    rm -f "$REPORT.tmp"
  fi
  echo "════════════════════════════════════════════════════════════════"
}

# ---------------------------------------------------------------------------
#  اجرا
# ---------------------------------------------------------------------------
if ! is_root && [ "$SKIP_SYSTEM" != 1 ]; then
  echo "❌ این نصب‌کننده باید با root اجرا شود:  curl -fsSL … | sudo bash" >&2
  echo "   (برای آزمونِ بی‌root: VILL3N_SKIP_SYSTEM=1 VILL3N_ROOT=/tmp/x bash install.sh)" >&2
  exit 1
fi

mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/install-$(date '+%Y%m%d-%H%M%S').log"
exec > >(tee -a "$LOG_FILE") 2>&1
rm -f "$REPORT.tmp"

echo
echo "  🏠 VILL3N — نصبِ یک‌دستوره   (ریشه: $ROOT$([ "$REPAIR" = 1 ] && echo ' · حالتِ تعمیر')$([ "$SKIP_SYSTEM" = 1 ] && echo ' · بی مرحله‌های سیستمی'))"
echo

trap 'code=$?; if [ "$code" -ne 0 ] && [ "$code" -ne 75 ]; then log "❌ نصب با کدِ $code متوقف شد — اجرای دوباره از همین مرحله ادامه می‌دهد. لاگ: $LOG_FILE"; fi' EXIT

for s in $STEPS; do step "$s"; done
report
exit 0
