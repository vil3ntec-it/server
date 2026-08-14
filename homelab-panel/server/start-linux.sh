#!/usr/bin/env bash
# راه‌انداز پنل مدیریت سرور خانگی (لینوکس / مک)
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js نصب نیست. نسخهٔ ۲۲ یا بالاتر را از https://nodejs.org نصب کنید."
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "❌ Node.js نسخهٔ $NODE_MAJOR است؛ نسخهٔ ۲۲ یا بالاتر لازم است."
  exit 1
fi

# وابستگی‌ها فقط بار اول نصب می‌شوند (به اینترنت نیاز دارد)
if [ ! -d node_modules ]; then
  echo "📦 نصب وابستگی‌ها (فقط همین یک‌بار)..."
  npm install --omit=dev --no-audit --no-fund
fi

exec node --disable-warning=ExperimentalWarning src/index.js
