#!/usr/bin/env bash
# ---------------------------------------------------------------------------
#  اجرای Agent روی یک سرور (لینوکس / مک)
#
#  سه مقدار لازم است — همان‌هایی که پنل هنگام ساختنِ کلید نشان می‌دهد:
#      CC_PANEL_URL  آدرس Control Center
#      CC_SERVER_ID  شناسهٔ سرور  (srv_xxxxxxxx)
#      CC_AGENT_KEY  کلیدی که فقط یک‌بار نشان داده شد
#
#  می‌توانید کنارِ همین فایل یک agent.env بسازید و آن‌ها را داخلش بگذارید.
# ---------------------------------------------------------------------------
set -u
cd "$(dirname "$0")" || exit 1

if [ -f agent.env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./agent.env
  set +a
fi

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js پیدا نشد. نسخهٔ ۲۰ یا بالاتر لازم است."
  exit 1
fi

: "${CC_PANEL_URL:?CC_PANEL_URL لازم است}"
: "${CC_SERVER_ID:?CC_SERVER_ID لازم است}"
: "${CC_AGENT_KEY:?CC_AGENT_KEY لازم است}"

exec node agent.mjs
