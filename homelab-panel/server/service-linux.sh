#!/usr/bin/env bash
# ---------------------------------------------------------------------------
#  پنل را طوری راه می‌اندازد که همیشه بالا باشد:
#  با بستنِ ترمینال خاموش نمی‌شود و با روشن شدنِ کامپیوتر خودش بالا می‌آید.
#
#      ./service-linux.sh install     نصب + اجرای همین حالا
#      ./service-linux.sh start       فقط اجرا
#      ./service-linux.sh stop        توقف
#      ./service-linux.sh status      وضعیت
#      ./service-linux.sh logs        دیدن لاگ زنده
#      ./service-linux.sh setup-code  کدِ یک‌بارِ ساختِ نخستین مدیر (فقط تا مدیری نیست)
#      ./service-linux.sh uninstall   حذف از راه‌اندازی خودکار
#
#  اگر systemd باشد از آن استفاده می‌کند (بهترین حالت)؛ اگر نبود — مثلاً روی مک
#  یا داخل کانتینر — با nohup پروسه را از ترمینال جدا می‌کند.
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")"

HERE="$(pwd)"
NAME="homelab-panel"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT="$UNIT_DIR/$NAME.service"
DATA_DIR="${HLP_DATA_DIR:-$HERE/data}"
PIDFILE="$DATA_DIR/panel.pid"
LOGFILE="$DATA_DIR/panel.log"

have_systemd() {
  command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]
}

need_node() {
  if ! command -v node >/dev/null 2>&1; then
    echo "❌ Node.js نصب نیست. نسخهٔ ۲۲ یا بالاتر را از https://nodejs.org نصب کنید."
    exit 1
  fi
  if [ ! -d node_modules ]; then
    echo "📦 نصب وابستگی‌ها (فقط همین یک‌بار)..."
    npm install --omit=dev --no-audit --no-fund
  fi
}

running_pid() {
  [ -f "$PIDFILE" ] || return 1
  local pid
  pid="$(cat "$PIDFILE" 2>/dev/null || true)"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  echo "$pid"
}

# ------------------------------- systemd -----------------------------------
write_unit() {
  mkdir -p "$UNIT_DIR"
  cat > "$UNIT" <<UNIT_EOF
[Unit]
Description=پنل مدیریت سرور خانگی (پمپ یعقوبی)
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$HERE
ExecStart=$(command -v node) --disable-warning=ExperimentalWarning $HERE/src/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
UNIT_EOF
  systemctl --user daemon-reload
}

# ------------------------------- دستورها ------------------------------------
do_install() {
  need_node
  if have_systemd; then
    write_unit
    systemctl --user enable --now "$NAME.service"
    # تا بعد از خروج از حساب (و بدون لاگین) هم بالا بماند
    loginctl enable-linger "$USER" >/dev/null 2>&1 || \
      echo "ℹ️  برای بالا ماندن بدون ورود کاربر: sudo loginctl enable-linger $USER"
    echo "✅ نصب شد. با هر بار روشن شدن کامپیوتر خودش بالا می‌آید."
    echo "   وضعیت:  ./service-linux.sh status"
  else
    echo "ℹ️  systemd پیدا نشد — با nohup اجرا می‌شود (با بستن ترمینال نمی‌خوابد)."
    do_start
    echo "   برای اجرای خودکار بعد از ریستارت، این خط را به فایل راه‌اندازی سیستم اضافه کنید:"
    echo "     $HERE/service-linux.sh start"
  fi
}

# اگر نسخهٔ دیگری از قبل روی همین پورت بالا باشد، نسخهٔ تازه بالا نمی‌آید و
# کاربر در مرورگر همان قدیمی را می‌بیند. اینجا صریح خبر می‌دهیم.
warn_if_other_panel() {
  local port="${HLP_PORT:-4700}"
  local health
  health="$(curl -fsS --max-time 3 "http://127.0.0.1:$port/health" 2>/dev/null || true)"
  [ -n "$health" ] || return 0

  local root
  root="$(printf '%s' "$health" | sed -n 's/.*"root":"\([^"]*\)".*/\1/p')"
  [ "$root" = "$HERE" ] && return 0

  echo
  echo "  ⚠️  یک پنلِ دیگر از قبل روی پورت $port در حال اجراست:"
  echo "        $root"
  echo "      تا آن را نبندید، نسخهٔ اینجا بالا نمی‌آید و در مرورگر همان"
  echo "      نسخهٔ قدیمی را می‌بینید."
  echo
  echo "      برای بستنش:  $root/service-linux.sh stop"
  echo "      یا این نسخه را روی پورت دیگری اجرا کنید:  HLP_PORT=4800 $0 start"
  echo
  return 1
}

do_start() {
  need_node
  warn_if_other_panel || return 1
  if have_systemd && [ -f "$UNIT" ]; then
    systemctl --user start "$NAME.service"
    echo "✅ اجرا شد."
    show_address
    return
  fi
  if pid="$(running_pid)"; then
    echo "ℹ️  از قبل بالاست (PID $pid)."
    return
  fi
  # پوشهٔ داده فقط مالِ همین کاربر (۱.۵۰.۸۵) — خودِ پنل هم در هر بالا آمدن ‎700‎ را تنگ می‌کند
  (umask 077; mkdir -p "$DATA_DIR")
  # setsid پروسه را از ترمینال جدا می‌کند تا با بسته شدن پنجره نمیرد
  if command -v setsid >/dev/null 2>&1; then
    setsid nohup node --disable-warning=ExperimentalWarning src/index.js >> "$LOGFILE" 2>&1 < /dev/null &
  else
    nohup node --disable-warning=ExperimentalWarning src/index.js >> "$LOGFILE" 2>&1 < /dev/null &
  fi
  # بار اول ساختِ دیتابیس و پوشه‌ها چند ثانیه طول می‌کشد؛ صبر می‌کنیم
  local pid=""
  for _ in $(seq 1 30); do
    sleep 1
    if pid="$(running_pid)"; then break; fi
  done

  if [ -n "$pid" ]; then
    echo "✅ اجرا شد (PID $pid). می‌توانید این پنجره را ببندید."
    show_address
  else
    echo "⚠️  بالا نیامد؛ لاگ را ببینید: $LOGFILE"
    [ -f "$LOGFILE" ] && tail -n 15 "$LOGFILE"
  fi
}

# پنل یک فایل نیست که باز شود؛ در مرورگر دیده می‌شود
show_address() {
  local port="${HLP_PORT:-4700}"
  echo
  echo "  ============================================================"
  echo "    پنل را در مرورگر باز کنید:"
  echo "        http://localhost:$port"
  echo
  echo "    بارِ اول روی همین کامپیوتر مدیر را بسازید. از گوشی یا کامپیوترِ"
  echo "    دیگرِ شبکه «کدِ یک‌بارِ راه‌اندازی» لازم است:"
  echo "        $0 setup-code"
  echo "  ============================================================"
  echo
}

# ⛔ (۱.۵۰.۸۵) کدِ یک‌بارِ ساختِ نخستین مدیر را سرور فقط در لاگِ خودش چاپ می‌کند (نه روی دیسکِ
# جدا، نه در پنل). این‌جا فقط آخرین خطِ همان لاگ نشان داده می‌شود، و فقط تا مدیری ساخته نشده —
# پس از آن کد باطل است. روی همین کامپیوتر (http://localhost) کد لازم نیست.
do_setup_code() {
  local port="${HLP_PORT:-4700}"
  local status
  status="$(curl -fsS --max-time 3 "http://127.0.0.1:$port/api/auth/status" 2>/dev/null || true)"
  if [ -z "$status" ]; then
    echo "⚠️  پنل روی پورت $port جواب نمی‌دهد — اول: $0 start"
    return 1
  fi
  case "$status" in
    *'"initialized":true'*)
      echo "✅ مدیرِ پنل از قبل ساخته شده — کدِ راه‌اندازی در کار نیست."
      return 0 ;;
  esac
  local line=""
  if have_systemd && [ -f "$UNIT" ]; then
    line="$(journalctl --user -u "$NAME.service" --no-pager -o cat 2>/dev/null | grep -a 'setup code):' | tail -n 1 || true)"
  elif [ -f "$LOGFILE" ]; then
    line="$(grep -a 'setup code):' "$LOGFILE" | tail -n 1 || true)"
  fi
  if [ -z "$line" ]; then
    echo "⚠️  خطِ کد در لاگ پیدا نشد. سرور را دوباره بالا بیاورید ($0 restart) تا کدِ تازه بسازد،"
    echo "    یا پنل را روی همین کامپیوتر باز کنید: http://localhost:$port"
    return 1
  fi
  echo "${line##*: }"
  echo "  (کدِ یک‌بار — فقط برای ساختِ نخستین مدیر از دستگاهِ دیگرِ شبکه؛ با ساختِ مدیر باطل می‌شود)"
}

do_stop() {
  if have_systemd && [ -f "$UNIT" ]; then
    systemctl --user stop "$NAME.service" || true
    echo "✅ متوقف شد."
    return
  fi
  if pid="$(running_pid)"; then
    kill "$pid" 2>/dev/null || true
    sleep 2
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
    rm -f "$PIDFILE"
    echo "✅ متوقف شد."
  else
    echo "ℹ️  بالا نبود."
  fi
}

do_status() {
  if have_systemd && [ -f "$UNIT" ]; then
    systemctl --user status "$NAME.service" --no-pager || true
    return
  fi
  if pid="$(running_pid)"; then
    echo "✅ بالاست (PID $pid)"
  else
    echo "⛔ خاموش است"
  fi
}

do_logs() {
  if have_systemd && [ -f "$UNIT" ]; then
    journalctl --user -u "$NAME.service" -f -n 100
  else
    tail -f "$LOGFILE"
  fi
}

do_uninstall() {
  if have_systemd && [ -f "$UNIT" ]; then
    systemctl --user disable --now "$NAME.service" 2>/dev/null || true
    rm -f "$UNIT"
    systemctl --user daemon-reload
    echo "✅ از راه‌اندازی خودکار حذف شد."
  else
    do_stop
  fi
}

case "${1:-install}" in
  install)   do_install ;;
  start)     do_start ;;
  stop)      do_stop ;;
  restart)   do_stop; do_start ;;
  status)    do_status ;;
  logs)      do_logs ;;
  setup-code) do_setup_code ;;
  uninstall) do_uninstall ;;
  *)
    echo "استفاده: $0 [install|start|stop|restart|status|logs|setup-code|uninstall]"
    exit 1
    ;;
esac
