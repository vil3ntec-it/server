#!/usr/bin/env node
// ---------------------------------------------------------------------------
//  وصل کردنِ همین سرور به یک «مرکز» (سرورهای من، ۱.۵۰.۹۴)
//
//      node scripts/join.mjs <نشانیِ مرکز> <کد>  [--name "VPS آلمان"] [--kind home|vps|foreign|hosting]
//      node scripts/join.mjs --leave                 جدا شدن از مرکز
//      node scripts/join.mjs --status                وضعیت
//      (گزینه‌های ‎--port‎ و ‎--data-dir‎ اگر پنل جای دیگری است؛ پیش‌فرض از ‎.env‎ ِ کنارِ پنل)
//
//  کد را مالکِ مرکز در «سرورهای من» ← «افزودنِ سرور» می‌سازد (۱۰ دقیقه، یک‌بارمصرف).
//  ⛔ با پنلِ روشنِ همین کامپیوتر از راهِ **کلیدِ محلی** (‎<پوشهٔ داده>/local-admin.key‎) حرف می‌زند — همان راهِ
//     ‎vill3n‎؛ همان کارِ دکمهٔ «تنظیمات ← وصل به مرکز» را صدا می‌زند (یک کد، یک راه). کلیدِ Ed25519 را خودِ پنل می‌سازد
//     و فقط در پوشهٔ داده با ‎0600‎ نگه می‌دارد؛ این ابزار نه کلید را می‌بیند نه کد را جایی می‌نویسد.
//  ⚠️ هیچ چیزی از پنل import نمی‌کند — باید با پنلِ روشن کار کند، نه به‌جای آن.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';

const SERVER_ROOT = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const v = args[i + 1] ?? '';
  args.splice(i, 2);
  return v;
};
const has = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
};

function readEnvFile(file) {
  const out = {};
  try {
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      let v = line.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      out[line.slice(0, eq).trim()] = v;
    }
  } catch { /* نیست */ }
  return out;
}

const env = readEnvFile(path.join(SERVER_ROOT, '.env'));
const PORT = Number(flag('--port') || process.env.HLP_PORT || env.HLP_PORT || 4700);
const DATA_DIR = path.resolve(flag('--data-dir') || process.env.HLP_DATA_DIR || env.HLP_DATA_DIR || path.join(SERVER_ROOT, 'data'));
const NAME = flag('--name');
const KIND = flag('--kind');
const LEAVE = has('--leave');
const STATUS = has('--status');
const BASE = `http://127.0.0.1:${PORT}`;

function usage() {
  console.log('  کاربرد:  node scripts/join.mjs <نشانیِ مرکز> <کد>  [--name نام] [--kind home|vps|foreign|hosting]');
  console.log('           node scripts/join.mjs --leave   ·   node scripts/join.mjs --status');
  return 2;
}

async function call(method, route, body) {
  let key = null;
  try { key = fs.readFileSync(path.join(DATA_DIR, 'local-admin.key'), 'utf8').trim(); } catch { /* نیست */ }
  if (!key || key.length < 32) throw new Error(`کلیدِ محلی پیدا نشد (${path.join(DATA_DIR, 'local-admin.key')}) — پنل روشن است؟ ‎--data-dir‎ درست است؟`);
  const r = await fetch(`${BASE}${route}`, {
    method,
    headers: { 'X-Local-Key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await r.json(); } catch { /* */ }
  return { status: r.status, json };
}

async function main() {
  try {
    if (STATUS) {
      //  وضعیت فقط برای مالک است (درِ ‎GET /api/fleet‎ کلیدِ محلی نمی‌پذیرد) ⇒ این‌جا فقط سلامتِ پنل
      const h = await fetch(`${BASE}/health`).then((r) => r.json()).catch(() => null);
      console.log(h ? `  ✅ پنل روشن است (نسخهٔ ${h.version}) — وضعیتِ وصل را در «تنظیمات ← سرورهای من» ببینید.` : '  ❌ پنل روی این کامپیوتر جواب نمی‌دهد.');
      return h ? 0 : 1;
    }
    if (LEAVE) {
      const r = await call('DELETE', '/api/fleet/link');
      if (r.status !== 200) { console.log(`  ❌ ${r.json?.message || r.json?.error || r.status}`); return 1; }
      console.log(`  ✅ از مرکز جدا شد${r.json.centerNotified ? '' : ' (مرکز خبردار نشد — آن‌جا «جدا کردن» را بزنید)'}.`);
      return 0;
    }
    const [center, code] = args;
    if (!center || !code) return usage();
    const r = await call('POST', '/api/fleet/link', { center, code, ...(NAME ? { name: NAME } : {}), ...(KIND ? { kind: KIND } : {}) });
    if (r.status !== 200) { console.log(`  ❌ ${r.json?.message || r.json?.error || r.status}`); return 1; }
    console.log(`  ✅ این سرور به مرکزِ ${r.json.link.centerUrl}${r.json.link.centerName ? ` («${r.json.link.centerName}»)` : ''} وصل شد.`);
    console.log('     در «سرورهای من» ِ مرکز تا چند ثانیهٔ دیگر «آنلاین» دیده می‌شود.');
    return 0;
  } catch (e) {
    console.log(`  ❌ ${e.message}`);
    return 1;
  }
}

process.exit(await main());
