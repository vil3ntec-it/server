#!/usr/bin/env bash
# VILL3N — نصب روی وی‌پی‌اس یا سرور لینوکسی (اوبونتو/دبیان و هر توزیع با systemd)
#   sudo bash scripts/install-linux.sh
# کارها: پیدا کردن یا گرفتن Node، ساخت کاربر جدا برای سایت، نصب سرویس همیشه‌روشن.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "این دستور را با sudo اجرا کنید:  sudo bash scripts/install-linux.sh"; exit 1; fi
if ! command -v systemctl >/dev/null 2>&1; then echo "این سرور systemd ندارد. سایت را با «node server.js» اجرا کنید."; exit 1; fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE="vill3n-top"
RUN_USER="vill3n"
NODE_VERSION="v22.12.0"
PORT="$(grep -oE '"port"[[:space:]]*:[[:space:]]*[0-9]+' "$ROOT/config.json" 2>/dev/null | grep -oE '[0-9]+' || echo 4780)"

node_ok() { "$1" -e 'process.exit(Number(process.versions.node.split(".")[0])>=18?0:1)' >/dev/null 2>&1; }

NODE=""
if [ -x "$ROOT/runtime/node/bin/node" ] && node_ok "$ROOT/runtime/node/bin/node"; then NODE="$ROOT/runtime/node/bin/node"
elif command -v node >/dev/null 2>&1 && node_ok "$(command -v node)"; then NODE="$(command -v node)"
else
  case "$(uname -m)" in x86_64) ARCH=x64 ;; aarch64|arm64) ARCH=arm64 ;; armv7l) ARCH=armv7l ;; *) echo "معماری $(uname -m) پشتیبانی نمی‌شود؛ Node 18+ را خودتان نصب کنید."; exit 1 ;; esac
  NAME="node-$NODE_VERSION-linux-$ARCH"
  echo "Node پیدا نشد؛ نسخهٔ $NODE_VERSION گرفته می‌شود…"
  mkdir -p "$ROOT/runtime"
  TMP="$(mktemp)"
  if command -v curl >/dev/null 2>&1; then curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/$NAME.tar.gz" -o "$TMP"; else wget -q "https://nodejs.org/dist/$NODE_VERSION/$NAME.tar.gz" -O "$TMP"; fi
  rm -rf "$ROOT/runtime/node" "$ROOT/runtime/$NAME"
  tar -xzf "$TMP" -C "$ROOT/runtime"
  mv "$ROOT/runtime/$NAME" "$ROOT/runtime/node"
  rm -f "$TMP"
  NODE="$ROOT/runtime/node/bin/node"
fi
echo "Node: $NODE ($("$NODE" -v))"

id "$RUN_USER" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$RUN_USER"
mkdir -p "$ROOT/data" "$ROOT/public/assets/fonts"
chown -R "$RUN_USER":"$RUN_USER" "$ROOT/data" "$ROOT/public/assets/fonts"
chmod 750 "$ROOT/data"

cat > "/etc/systemd/system/$SERVICE.service" <<UNIT
[Unit]
Description=VILL3N site (downloads + owner panel)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
Group=$RUN_USER
WorkingDirectory=$ROOT
ExecStart=$NODE $ROOT/server.js
Restart=always
RestartSec=4
Environment=NODE_ENV=production
# محدودسازی: سایت فقط به پوشهٔ دادهٔ خودش می‌تواند بنویسد
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=$ROOT/data $ROOT/public/assets/fonts
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null
systemctl restart "$SERVICE"
sleep 2

echo
if systemctl is-active --quiet "$SERVICE"; then
  echo "✓ سایت روشن است و با هر بار روشن‌شدن سرور خودش بالا می‌آید."
  echo "  نشانی داخلی:   http://127.0.0.1:$PORT/"
  if [ -f "$ROOT/data/SETUP-CODE.txt" ]; then echo "  کد راه‌اندازی: $(grep -oE '[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}' "$ROOT/data/SETUP-CODE.txt" | head -1)"; fi
  echo "  گام بعد: دامنه را با Caddy یا Nginx به همین نشانی وصل کنید (راهنما: docs/راهنما.md)."
  echo "  وضعیت:  systemctl status $SERVICE     گزارش:  journalctl -u $SERVICE -n 50"
else
  echo "✗ سرویس بالا نیامد. گزارش:"
  journalctl -u "$SERVICE" -n 30 --no-pager || true
  exit 1
fi
