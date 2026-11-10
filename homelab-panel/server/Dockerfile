# ---------------------------------------------------------------------------
#  ایمیجِ پنل — همراهِ سرورِ حساب (فروشگاه و اشتراک‌ها)
#
#  چرا node:22-alpine: SQLite داخلیِ خودِ Node استفاده می‌شود (node:sqlite)،
#  پس نه کامپایلری لازم است نه ابزارِ ساخت. ایمیج کوچک می‌ماند و روی یک
#  کامپیوترِ خانگی هم سریع بالا می‌آید.
#
#  ⛔ سرورِ حساب (ریپوی shop، پوشهٔ server) **داخلِ همین ایمیج** است، در
#  ‎/account-server‎ — همان جایی که برنامهٔ ویندوز می‌گذاردش (کنارِ پوشهٔ پنل).
#  پس پنل در داکر هم خودش بالا می‌آوردش (PGlite در ‎/data‎) و بخشِ «فروشگاه»
#  دقیقاً همان است که در خانه: مدیرِ خودساخته، ایمیلِ کدها از پنل، پشتیبان با
#  مکث، گذرگاهِ زنده و به‌روزرسانیِ سرورِ حساب از خودِ پنل.
#  راهنما: docs/DEPLOY-ANYWHERE-fa.md
#
#    docker build --build-arg SHOP_REF=main -t vill3n-panel .
#    SHOP_REF=""  ⇒ بی سرورِ حساب (وقتی HLP_ACCOUNT_API به سرورِ دیگری می‌رود)
# ---------------------------------------------------------------------------
ARG NODE_IMAGE=node:22-alpine

# ── سرورِ حساب از ریپوی عمومیِ shop ─────────────────────────────────────────
FROM ${NODE_IMAGE} AS account
ARG SHOP_REPO=https://github.com/vil3ntec-it/shop.git
ARG SHOP_REF=main
#  🤖 باتِ تلگرامِ پمپ افزونهٔ سرورِ حساب است و در ریپوی پمپ می‌ماند (RULES: «باتِ پمپ
#  از ریپوی پمپ…») — همان کارِ account-server.yml: shopِ تازه (bots.js) بی بات ⇒ ساخت سرخ.
ARG PUMP_REPO=https://github.com/vil3ntec-it/pump-staion-yaqobi.git
RUN apk add --no-cache git
RUN mkdir -p /account-server \
 && if [ -n "$SHOP_REF" ]; then \
      git clone --depth 1 --branch "$SHOP_REF" "$SHOP_REPO" /tmp/shop \
      && cp -a /tmp/shop/server/. /account-server/ \
      && if [ -f /account-server/src/lib/bots.js ]; then \
           git clone -q --depth 1 --filter=blob:none --sparse "$PUMP_REPO" /tmp/pumpbot \
           && git -C /tmp/pumpbot sparse-checkout set telegram-bot \
           && test -f /tmp/pumpbot/telegram-bot/index.js \
           && mkdir -p /account-server/bots/pump \
           && cp /tmp/pumpbot/telegram-bot/index.js /account-server/bots/pump/index.js; \
         fi \
      && cd /account-server && npm ci --omit=dev --no-audit --no-fund \
      && rm -rf /tmp/shop /tmp/pumpbot /account-server/test /account-server/data /account-server/.env; \
    fi

# ── پنل ──────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE}

# tini: سیگنال به Node برسد · curl: سلامت · rclone: پشتیبانِ بیرون از سرور
# (HLP_OFFSITE_REMOTE؛ تنظیمش با RCLONE_CONFIG_* از محیط، بی فایلِ راز)
RUN apk add --no-cache tini curl rclone

WORKDIR /app

# لایهٔ وابستگی‌ها جدا از لایهٔ کد: تغییرِ کد نباید npm ci را دوباره اجرا کند
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
COPY --from=account /account-server /account-server

# کاربرِ غیرِ root. سرور روی پورتِ ۴۷۰۰ گوش می‌دهد (بالای ۱۰۲۴) پس امتیازِ
# root لازم نیست — و نداشتنش یعنی یک RCE هم کلِ کانتینر را نمی‌گیرد.
# ⚠️ /data و /backups پیش از VOLUME مالِ node می‌شوند تا volumeِ نامدارِ تازه
# همان مالکیت را بگیرد (bind mount را خودتان chown 1000 کنید).
RUN mkdir -p /data /backups && chown -R node:node /app /data /backups

USER node

#  ⚠️ نمایه از خودِ ایمیج: داخلِ کانتینر «docker» هستیم، مگر کسی صریحاً عوضش کند.
ENV HLP_DEPLOY=docker \
    HLP_DATA_DIR=/data \
    HLP_BACKUP_ROOT=/backups \
    HLP_HOST=0.0.0.0 \
    HLP_PORT=4700 \
    HLP_SITESYNC_PORT=4701 \
    NODE_ENV=production

EXPOSE 4700 4701
VOLUME ["/data", "/backups"]

# سلامت از خودِ ایمیج: اگر پنل جواب ندهد، داکر ری‌استارتش می‌کند
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4700/health || exit 1

# tini پروسهٔ ۱ می‌شود تا SIGTERM واقعاً به Node برسد و خاموش‌سازیِ تمیز
# (بستنِ دیتابیس، توقفِ سرورِ حساب) فرصتِ اجرا پیدا کند
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
