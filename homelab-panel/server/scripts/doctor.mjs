#!/usr/bin/env node
// ---------------------------------------------------------------------------
//  بررسیِ سلامتِ نصب
//      node scripts/doctor.mjs
//
//  پیش از بالا آوردنِ پنل می‌گوید چه چیزی سرِ جایش نیست — تا به‌جای یک خطای
//  گنگ وسطِ کار، همان اول پیامِ روشن ببینید.
//
//  اگر چیزی جدی خراب باشد با کدِ ۱ بیرون می‌آید تا اسکریپتِ نصب متوقف شود.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let problems = 0;
let warnings = 0;
const ok = (m) => console.log(`      ✅ ${m}`);
const warn = (m) => {
  warnings++;
  console.log(`      ⚠️  ${m}`);
};
const bad = (m) => {
  problems++;
  console.log(`      ❌ ${m}`);
};

function portFree(port, host = '0.0.0.0') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, host);
  });
}

/* ------------------------------ Node ----------------------------------- */

const major = Number(process.versions.node.split('.')[0]);
if (major >= 22) ok(`Node.js ${process.versions.node}`);
else bad(`Node.js ${process.versions.node} — نسخهٔ ۲۲ یا بالاتر لازم است`);

// SQLite داخلیِ Node — بدونش پنل اصلاً بالا نمی‌آید
try {
  await import('node:sqlite');
  ok('SQLite داخلیِ Node در دسترس است');
} catch {
  bad('ماژول node:sqlite در دسترس نیست — Node را به نسخهٔ ۲۲.۵ یا بالاتر ببرید');
}

/* --------------------------- وابستگی‌ها --------------------------------- */

const required = ['express', 'socket.io', 'jsonwebtoken', 'ws', 'qrcode'];
const missing = required.filter((name) => !fs.existsSync(path.join(SERVER_ROOT, 'node_modules', name)));
if (missing.length === 0) ok(`وابستگی‌ها نصب‌اند (${required.length} بسته)`);
else bad(`این بسته‌ها نصب نیستند: ${missing.join(', ')} — «npm install» را بزنید`);

/* ---------------------------- رابط کاربری ------------------------------- */

const indexHtml = path.join(SERVER_ROOT, 'public', 'index.html');
if (fs.existsSync(indexHtml)) {
  const html = await fsp.readFile(indexHtml, 'utf8');
  const asset = html.match(/assets\/(index-[A-Za-z0-9_-]+)\.js/);
  if (asset && fs.existsSync(path.join(SERVER_ROOT, 'public', 'assets', `${asset[1]}.js`))) {
    ok(`رابط کاربری آماده است (build ${asset[1].replace('index-', '')})`);
  } else {
    bad('فایل‌های رابط کاربری ناقص‌اند — در پوشهٔ web دستور «npm run build» را بزنید');
  }
} else {
  bad('رابط کاربری ساخته نشده — در پوشهٔ web دستور «npm install && npm run build» را بزنید');
}

/* ------------------------------ تنظیمات --------------------------------- */

const envPath = path.join(SERVER_ROOT, '.env');
const env = {};
if (fs.existsSync(envPath)) {
  for (const line of (await fsp.readFile(envPath, 'utf8')).split(/\r?\n/)) {
    const clean = line.trim();
    if (!clean || clean.startsWith('#')) continue;
    const eq = clean.indexOf('=');
    if (eq > 0) env[clean.slice(0, eq).trim()] = clean.slice(eq + 1).trim();
  }
  ok('.env خوانده شد');
} else {
  warn('.env نیست — مقادیرِ پیش‌فرض به کار می‌روند');
}

const port = Number(process.env.HLP_PORT || env.HLP_PORT || 4700);
const syncPort = Number(process.env.HLP_SITESYNC_PORT || env.HLP_SITESYNC_PORT || 4701);

/* ------------------------------ پورت‌ها --------------------------------- */

for (const [name, value] of [['پنل', port], ['سرورِ سایت', syncPort]]) {
  if (!value) continue;
  if (await portFree(value)) ok(`پورتِ ${name} (${value}) آزاد است`);
  else warn(`پورتِ ${name} (${value}) در حال استفاده است — شاید پنل از قبل بالاست`);
}

/* ------------------------- پوشهٔ داده و انبار ---------------------------- */

const dataDir = path.resolve(process.env.HLP_DATA_DIR || env.HLP_DATA_DIR || path.join(SERVER_ROOT, 'data'));
try {
  await fsp.mkdir(dataDir, { recursive: true });
  const probe = path.join(dataDir, `.doctor-${Date.now()}`);
  await fsp.writeFile(probe, 'ok');
  await fsp.rm(probe, { force: true });
  ok(`پوشهٔ داده نوشتنی است: ${dataDir}`);
} catch (e) {
  bad(`پوشهٔ داده نوشتنی نیست (${e.code}): ${dataDir}`);
}

// فضای آزادِ دیسک
try {
  const st = await fsp.statfs(dataDir);
  const freeGb = (st.bavail * st.bsize) / 1024 ** 3;
  if (freeGb >= 1) ok(`فضای آزاد: ${freeGb.toFixed(1)} گیگابایت`);
  else warn(`فضای آزادِ کم: ${freeGb.toFixed(2)} گیگابایت — بکاپ‌ها جا می‌خواهند`);
} catch { /* روی این سیستم‌عامل در دسترس نیست */ }

// حافظه
const totalGb = os.totalmem() / 1024 ** 3;
if (totalGb >= 1) ok(`حافظهٔ سیستم: ${totalGb.toFixed(1)} گیگابایت`);
else warn(`حافظهٔ کم: ${totalGb.toFixed(1)} گیگابایت`);

/* ------------------------------ گواهیِ TLS ------------------------------ */

const cert = process.env.HLP_TLS_CERT || env.HLP_TLS_CERT;
const key = process.env.HLP_TLS_KEY || env.HLP_TLS_KEY;
if (cert || key) {
  if (cert && key && fs.existsSync(cert) && fs.existsSync(key)) ok('گواهیِ https پیدا شد');
  else bad('HLP_TLS_CERT یا HLP_TLS_KEY داده شده ولی فایلش نیست');
} 

/* -------------------------------- خلاصه --------------------------------- */

console.log('');
if (problems) {
  console.log(`      ${problems} مشکل و ${warnings} هشدار پیدا شد.`);
  process.exit(1);
}
console.log(warnings ? `      همه‌چیز آماده است (${warnings} هشدار).` : '      همه‌چیز آماده است.');
process.exit(0);
