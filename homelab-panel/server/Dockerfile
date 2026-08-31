# ---------------------------------------------------------------------------
#  ایمیجِ پنل
#
#  چرا node:22-alpine: SQLite داخلیِ خودِ Node استفاده می‌شود (node:sqlite)،
#  پس نه کامپایلری لازم است نه ابزارِ ساخت. ایمیج کوچک می‌ماند و روی یک
#  کامپیوترِ خانگی هم سریع بالا می‌آید.
# ---------------------------------------------------------------------------
FROM node:22-alpine

# cloudflared برای تونل — اگر تونل را خاموش کرده‌اید بی‌ضرر است
RUN apk add --no-cache tini curl

WORKDIR /app

# لایهٔ وابستگی‌ها جدا از لایهٔ کد: تغییرِ کد نباید npm ci را دوباره اجرا کند
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# کاربرِ غیرِ root. سرور روی پورتِ ۴۷۰۰ گوش می‌دهد (بالای ۱۰۲۴) پس امتیازِ
# root لازم نیست — و نداشتنش یعنی یک RCE هم کلِ کانتینر را نمی‌گیرد.
RUN mkdir -p /data && chown -R node:node /app /data
USER node

ENV HLP_DATA_DIR=/data \
    HLP_HOST=0.0.0.0 \
    HLP_PORT=4700 \
    NODE_ENV=production

EXPOSE 4700 4701
VOLUME ["/data"]

# سلامت از خودِ ایمیج: اگر پنل جواب ندهد، داکر ری‌استارتش می‌کند
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4700/health || exit 1

# tini پروسهٔ ۱ می‌شود تا SIGTERM واقعاً به Node برسد و خاموش‌سازیِ تمیز
# (بستنِ دیتابیس، توقفِ سایت‌ها) فرصتِ اجرا پیدا کند
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
