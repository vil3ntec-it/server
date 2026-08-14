# ─────────────────────────────────────────────────────────────────────────────
#  دستیارِ پشتیبانی — تصویرِ داکر
#
#  هیچ npm install ای نیست چون هیچ وابستگی‌ای نیست. تصویر تقریباً به اندازهٔ
#  خودِ node-alpine است.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

# فقط چیزی که سرویس واقعاً لازم دارد کپی می‌شود.
# پوشهٔ bin/ عمداً **کپی نمی‌شود**: اسکریپت‌های آن اجازهٔ اجرای دستور دارند و
# جایشان روی خودِ کامپیوترِ صاحبِ سرور است، نه داخلِ کانتینرِ سرویس.
COPY package.json ./
COPY src ./src
COPY knowledge ./knowledge

# کاربرِ غیرِ root — اگر روزی چیزی از سرویس فرار کرد، دستش خالی باشد
RUN mkdir -p /app/data && chown -R node:node /app
USER node

ENV AI_HOST=0.0.0.0 \
    AI_PORT=8788 \
    AI_MAX_CONCURRENT=1

EXPOSE 8788

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8788/ai/support/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
