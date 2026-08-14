// ---------------------------------------------------------------------------
//  تستِ پراکسیِ دستیارِ پشتیبانی
//
//      node test/ai-proxy.mjs
//
//  چیزی که این‌جا بررسی می‌شود، دقیقاً همان دو باگی است که موقعِ ساخت پیش آمد
//  و هر دو ساکت بودند (۴۰۴ و درخواستِ معلق):
//
//    ۱) میان‌افزار با app.use('/ai/support', …) نصب می‌شود و Express پیشوند را
//       از req.path برمی‌دارد → شرطِ مسیر باید روی originalUrl باشد.
//    ۲) اگر express.json زودتر اجرا شود، بدنه را می‌خورد و پراکسی برای همیشه
//       منتظر می‌ماند → بدنهٔ POST باید سالم برسد.
//
//  سرویسِ واقعیِ ai-support لازم نیست: یک سرویسِ ساختگی روی همان پورت می‌نشیند.
// ---------------------------------------------------------------------------
import http from 'node:http';
import assert from 'node:assert/strict';
import express from 'express';
import { aiProxy, AI_PREFIX } from '../src/ai/proxy.js';
import { config } from '../src/config.js';

// این تست دربارهٔ **خودِ پراکسی** است، نه دربارهٔ روشن/خاموش بودنِ دستیار روی
// این کامپیوتر. پس تنظیمِ محیطی را این‌جا کنار می‌گذاریم تا نتیجهٔ تست به
// HLP_AI_ENABLED بستگی نداشته باشد (وگرنه در اجرای کلِ تست‌ها که دستیار عمداً
// خاموش است، همه‌چیز ۵۰۳ می‌شود و تست بی‌دلیل قرمز می‌شود).
config.aiEnabled = true;

const AI_PORT = config.aiPort;
let passed = 0;
const ok = (name) => { passed++; console.log(`  ✅ ${name}`); };

// ── سرویسِ ساختگی به‌جای ai-support ─────────────────────────────────────────
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      seenPath: req.url,
      seenMethod: req.method,
      seenBody: body,
      seenAuth: req.headers.authorization || null,
      seenCookie: req.headers.cookie || null,
    }));
  });
});

await new Promise((r) => fake.listen(AI_PORT, '127.0.0.1', r));

// ── اپِ آزمایشی، با همان ترتیبی که در index.js هست ─────────────────────────
const app = express();
app.use(AI_PREFIX, aiProxy);            // پیش از express.json — عمدی
app.use(express.json());
app.use((req, res) => res.status(404).type('text/plain').send('not found'));

const server = http.createServer(app);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

console.log('\n── پراکسیِ دستیار ──');

// ۱) GET از راه پراکسی — مسیرِ کامل باید برسد
{
  const r = await fetch(`${base}/ai/support/health`);
  assert.equal(r.status, 200, 'GET به ۴۰۴ افتاد — یعنی شرطِ مسیر روی req.path است نه originalUrl');
  const j = await r.json();
  assert.equal(j.seenPath, '/ai/support/health', `مسیرِ رسیده: ${j.seenPath}`);
  ok('GET با مسیرِ کامل عبور می‌کند');
}

// ۲) رشتهٔ پرسش هم باید عبور کند
{
  const r = await fetch(`${base}/ai/support/search?q=%D9%85%DB%8C%D8%A7%D9%86%D8%A8%D8%B1`);
  const j = await r.json();
  assert.ok(j.seenPath.includes('q='), 'پرسش گم شد');
  ok('رشتهٔ پرسش (query string) عبور می‌کند');
}

// ۳) بدنهٔ POST باید سالم برسد — همان باگی که درخواست را معلق می‌کرد
{
  const payload = { question: 'میانبرها چیست؟' };
  const r = await fetch(`${base}/ai/support/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.seenMethod, 'POST');
  assert.deepEqual(JSON.parse(j.seenBody), payload, `بدنهٔ رسیده: ${j.seenBody}`);
  ok('بدنهٔ POST سالم می‌رسد');
}

// ۴) هدرِ نشستِ دستیار عبور کند، ولی کوکیِ پنل نه
{
  const r = await fetch(`${base}/ai/support/health`, {
    headers: { authorization: 'Bearer ai-token', cookie: 'panel_session=SECRET' },
  });
  const j = await r.json();
  assert.equal(j.seenAuth, 'Bearer ai-token', 'هدرِ نشستِ دستیار نرسید');
  assert.equal(j.seenCookie, null, 'کوکیِ پنل به سرویسِ دستیار درز کرد');
  ok('نشستِ دستیار عبور می‌کند ولی کوکیِ پنل درز نمی‌کند');
}

// ۵) مسیرهای دیگر دست‌نخورده بمانند
{
  const r = await fetch(`${base}/چیزِ-دیگر`);
  assert.equal(r.status, 404, 'پراکسی مسیرهای دیگر را هم گرفت');
  ok('مسیرهای غیرِ دستیار دست‌نخورده‌اند');
}

// ۶) وقتی سرویس بالا نیست، پیامِ روشن بدهد نه خطای مبهم
{
  await new Promise((r) => fake.close(r));
  const r = await fetch(`${base}/ai/support/health`);
  assert.equal(r.status, 503, `کدِ برگشتی: ${r.status}`);
  const j = await r.json();
  assert.ok(String(j.error).includes('در دسترس نیست'), j.error);
  ok('وقتی سرویس خاموش است، پیامِ روشن می‌دهد');
}

await new Promise((r) => server.close(r));
console.log(`\n✅ هر ${passed} تستِ پراکسی قبول شد\n`);
