#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  نصبِ دستیارِ پشتیبانی — لینوکس و مک
#
#      bash install.sh
#
#  هیچ چیزی را بی‌اجازه نصب نمی‌کند و هیچ فایلی را بازنویسی نمی‌کند.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")"

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║   نصبِ دستیارِ پشتیبانیِ پمپ یعقوبی                     ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""

# ── ۱) Node ────────────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js پیدا نشد."
  echo "   نصبش کن: https://nodejs.org  (نسخهٔ ۲۰ به بالا)"
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "❌ Node.js نسخهٔ $NODE_MAJOR است؛ حداقل ۲۰ لازم است."
  exit 1
fi
echo "✅ Node.js $(node -v)"
echo "   (هیچ npm install ای لازم نیست — این سرویس وابستگی ندارد)"

# ── ۲) .env ────────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  cp .env.example .env
  echo "✅ فایلِ .env ساخته شد"
else
  echo "ℹ️  فایلِ .env از قبل هست — دست نخورد"
fi

# ── ۳) سخت‌افزار ───────────────────────────────────────────────────────────
echo ""
node bin/detect-hardware.mjs

echo ""
read -r -p "تنظیماتِ پیشنهادی روی config.local.json نوشته شود؟ [y/N] " ANS
if [[ "${ANS:-}" =~ ^[yYبب]$ ]]; then
  node bin/detect-hardware.mjs --apply
fi

# ── ۴) Ollama ──────────────────────────────────────────────────────────────
echo ""
if command -v ollama >/dev/null 2>&1; then
  echo "✅ Ollama نصب است"
  MODEL="$(node -p "try{require('./config.local.json').llm.model}catch(e){'qwen2.5:3b-instruct-q4_K_M'}" 2>/dev/null || echo 'qwen2.5:3b-instruct-q4_K_M')"
  if ollama list 2>/dev/null | grep -q "${MODEL%%:*}"; then
    echo "✅ مدلِ $MODEL از قبل هست"
  else
    echo "ℹ️  مدل هنوز گرفته نشده. برای گرفتنش:"
    echo "      ollama pull $MODEL"
    echo "      ollama pull nomic-embed-text"
  fi
else
  echo "ℹ️  Ollama نصب نیست."
  echo "   سرویس بدونِ آن هم کار می‌کند (جواب‌ها مستقیم از مستندات)."
  echo "   برای مغزِ واقعی: https://ollama.com/download"
fi

# ── ۵) ایندکس ──────────────────────────────────────────────────────────────
echo ""
echo "📚 ساختِ ایندکسِ دانش…"
node bin/build-index.mjs || echo "⚠️  ایندکس ساخته نشد — سرویس خودش موقع اجرا می‌سازدش"

# ── ۶) تست ─────────────────────────────────────────────────────────────────
echo ""
echo "🧪 اجرای تست‌ها…"
if node test/run-all.mjs >/dev/null 2>&1; then
  echo "✅ همهٔ تست‌ها قبول"
else
  echo "⚠️  بعضی تست‌ها شکست خوردند — برای دیدنِ جزئیات: npm test"
fi

echo ""
echo "───────────────────────────────────────────────────────"
echo "  تمام. برای اجرا:"
echo ""
echo "      node src/index.js"
echo ""
echo "  و در برنامه: رباتِ دستیار ← تبِ «پشتیبانی هوشمند»"
echo "  راهنمای کامل: README-fa.md"
echo "───────────────────────────────────────────────────────"
echo ""
