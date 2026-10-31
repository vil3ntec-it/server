#!/usr/bin/env node
// ---------------------------------------------------------------------------
//  vill3n — دستورِ خطِ فرمانِ سرورِ خانگی (بندِ ۱۰.۳ی پرامپت)
//
//      vill3n status          سرویس، پنل (/health)، سرورِ حساب، تونل، پشتیبان‌ها
//      vill3n update          پشتیبان ← git pull ← npm ci ← ری‌استارت
//      vill3n backup          پشتیبانِ همین حالا (از راهِ پنل)
//      vill3n agent on|off    دستیارِ هوشمند
//      vill3n repair          بررسی و تعمیرِ هر چیزی که خراب یا حذف شده
//      vill3n logs [n]        لاگِ پنل
//      vill3n owner-reset     بازیابیِ مالکِ اصلی — فقط روی همین کامپیوتر (پایین)
//
//  با پنل از راهِ **کلیدِ محلی** حرف می‌زند (src/local-key.js): فایلی که فقط
//  روی همین کامپیوتر خوانده می‌شود، پس نه رمزی لازم است نه ورودی. تنظیمات از
//  <ریشه>/secrets/core.env می‌آید — همان که install.sh نوشته.
//
//  ⚠️ هیچ وابستگی‌ای ندارد و از هیچ ماژولِ پنل import نمی‌کند: باید وقتی هم
//  که پنل افتاده یا node_modules خراب است کار کند — دقیقاً وقتی لازم است.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const v = args[i + 1] ?? '';
  args.splice(i, 2);
  return v;
};
const ROOT = path.resolve(flag('--root') || process.env.VILL3N_ROOT || '/srv/vill3n');
const DATA_DIR_FLAG = flag('--data-dir');
const JSON_OUT = args.includes('--json');
if (JSON_OUT) args.splice(args.indexOf('--json'), 1);
const cmd = args[0] || 'help';

const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => console.log(`  ❌ ${m}`);
const warn = (m) => console.log(`  ⚠️  ${m}`);
const info = (m) => console.log(`  ·  ${m}`);

/* --------------------------- تنظیمات و کلید ----------------------------- */

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

const ENV_FILE = path.join(ROOT, 'secrets', 'core.env');
const env = readEnvFile(ENV_FILE);
const PORT = Number(process.env.HLP_PORT || env.HLP_PORT || 4700);
const PUBLIC_PORT = Number(process.env.HLP_SITESYNC_PORT || env.HLP_SITESYNC_PORT || 4701);
const DATA_DIR = process.env.HLP_DATA_DIR || env.HLP_DATA_DIR || path.join(ROOT, 'data', 'core');
const PANEL_DIR = process.env.VILL3N_PANEL_DIR || path.join(ROOT, 'core', 'panel');
const SERVER_DIR = path.join(PANEL_DIR, 'homelab-panel', 'server');
const UNIT = 'vill3n-panel';
const BASE = `http://127.0.0.1:${PORT}`;

function localKey() {
  try {
    const k = fs.readFileSync(path.join(DATA_DIR, 'local-admin.key'), 'utf8').trim();
    if (k.length >= 32) return k;
  } catch { /* پنل هنوز بالا نیامده یا پوشه دیگری است */ }
  return null;
}

async function api(method, route, body) {
  const key = localKey();
  if (!key) throw new Error(`کلیدِ محلی پیدا نشد (${path.join(DATA_DIR, 'local-admin.key')}) — پنل دستِ‌کم یک بار باید بالا آمده باشد`);
  const ctrl = new AbortController();
  const abortTimer = setTimeout(() => ctrl.abort(), 20 * 60_000);
  try {
    const r = await fetch(`${BASE}${route}`, {
      method,
      headers: { 'X-Local-Key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* متن */ }
    if (!r.ok) throw new Error(json?.message || json?.error || `${r.status} ${text.slice(0, 120)}`);
    return json;
  } finally {
    clearTimeout(abortTimer);
  }
}

function sh(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { encoding: 'utf8', stdio: opts.inherit ? 'inherit' : 'pipe', ...opts });
  return { ok: r.status === 0, code: r.status, out: String(r.stdout || '').trim(), err: String(r.stderr || '').trim() };
}
const has = (c) => sh('/bin/sh', ['-c', `command -v ${c}`]).ok;
const isRoot = () => typeof process.getuid === 'function' && process.getuid() === 0;

function unitState(name) {
  if (!has('systemctl')) return null;
  const a = sh('systemctl', ['is-active', name]);
  const e = sh('systemctl', ['is-enabled', name]);
  return { active: a.out || 'unknown', enabled: e.out || 'unknown' };
}

async function health(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(4000) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/* ------------------------------- دستورها ------------------------------- */

async function status() {
  const report = { root: ROOT, port: PORT, publicPort: PUBLIC_PORT };
  console.log(`\n  🏠 سرورِ خانگی — ${ROOT}\n`);

  const unit = unitState(UNIT);
  report.service = unit;
  if (!unit) warn('systemd این‌جا نیست — سرویس سنجیده نشد');
  else if (unit.active === 'active') ok(`سرویس ${UNIT}: روشن (${unit.enabled})`);
  else bad(`سرویس ${UNIT}: ${unit.active} — «vill3n repair» یا «systemctl status ${UNIT}»`);

  const h = await health(PORT);
  report.panel = h;
  if (h) ok(`پنل جواب می‌دهد — نسخهٔ ${h.version || '?'} روی پورتِ ${PORT}`);
  else bad(`پنل روی پورتِ ${PORT} جواب نمی‌دهد`);

  const pub = await health(PUBLIC_PORT);
  report.publicPort = pub ? { ok: true, mode: pub.mode } : { ok: false };
  if (pub) ok(`پورتِ عمومی (${PUBLIC_PORT}) جواب می‌دهد`);
  else warn(`پورتِ عمومی (${PUBLIC_PORT}) جواب نمی‌دهد — تونل و برنامه‌ها به این پورت می‌رسند`);

  if (h) {
    try {
      const s = await api('GET', '/api/platform/status');
      report.detail = s;
      const a = s.accountServer || {};
      if (!a.enabled) info('سرورِ حساب: خاموش (HLP_ACCOUNT_AUTOSTART=0)');
      else if (a.up) ok(`سرورِ حساب: بالا (نسخهٔ ${a.version || '?'}${a.restarts ? `، ${a.restarts} بار برگشته` : ''})`);
      else if (!a.installed) bad('سرورِ حساب: کدش نصب نیست (HLP_ACCOUNT_DIR) — «vill3n repair»');
      else bad(`سرورِ حساب: جواب نمی‌دهد${a.lastError ? ` — ${a.lastError}` : ''}`);

      const t = s.tunnel;
      if (!t) info('تونل: خاموش');
      else if (t.status === 'connected' || t.status === 'running') ok(`تونل: ${t.status}${t.url ? ` — ${t.url}` : ''}`);
      else warn(`تونل: ${t.status || '?'}${t.error ? ` — ${t.error}` : ''}`);
      const cf = unitState('cloudflared');
      if (cf) (cf.active === 'active' ? ok : warn)(`سرویسِ cloudflared: ${cf.active}`);

      const ag = s.agent || {};
      if (ag.enabled === false) info('دستیار: از پنل برداشته شده');
      else info(`دستیار: ${ag.paused ? 'خاموش' : 'روشن'}${ag.modelLoaded ? ' — مدل در رَم' : ''}`);

      const b = s.backups || {};
      const rt = b.restoreTest;
      info(`رمزنگاریِ پشتیبان: ${b.encryption?.label || '?'}${b.encryption?.keyExists ? '' : ' (کلید هنوز ساخته نشده)'}`);
      if (!rt) warn('تستِ بازیابی هنوز اجرا نشده');
      else (rt.ok ? ok : bad)(`تستِ بازیابی: ${rt.ok ? 'سالم' : 'رد شد'} — ${new Date(rt.at).toLocaleString('fa-IR')}${rt.ok ? '' : ` — ${(rt.problems || []).join(' · ')}`}`);
      const q = b.offsite?.queue?.length || 0;
      info(`مقصدِ خارج از سرور: ${b.offsite?.label || '?'}${q ? ` — ${q} فایل در صف` : ''}`);

      const heal = await api('GET', '/api/platform/selfheal');
      report.selfheal = { ok: heal.ok, hardMissing: heal.hardMissing, missing: (heal.missing || []).map((m) => m.name) };
      if (!heal.applicable) info('خودترمیمی: روی این سیستم لازم نیست');
      else if (heal.ok) ok(`وابستگی‌ها: همه سرِ جایشان (${heal.items.length} مورد)`);
      else bad(`وابستگی‌ها: ${heal.hardMissing} مورد کم است — ${heal.missing.filter((m) => !m.optional).map((m) => m.name).join('، ')} — «vill3n repair»`);
    } catch (e) {
      warn(`جزئیات از پنل گرفته نشد: ${e.message}`);
    }
  }
  if (JSON_OUT) console.log(JSON.stringify(report, null, 2));
  console.log('');
  return h ? 0 : 1;
}

async function backup() {
  console.log('\n  💾 پشتیبانِ همین حالا…');
  const r = await api('POST', '/api/platform/backup', { note: 'دستی — vill3n backup' });
  ok(`کتابخانه: ${r.library.folder}${r.library.encrypted ? ` (آرشیوِ رمزشده: ${path.basename(r.library.encrypted.path)})` : ''}`);
  if (r.db?.file) ok(`دیتابیسِ پنل: ${r.db.file}`);
  else warn(`دیتابیسِ پنل: ${r.db?.error || 'گرفته نشد'}`);
  console.log('');
  return 0;
}

async function agent(on) {
  const r = await api('POST', '/api/platform/agent', { on });
  ok(`دستیار ${on ? 'روشن' : 'خاموش'} شد${r.modelLoaded ? ' (مدل در رَم)' : ''}`);
  return 0;
}

async function repair() {
  console.log('\n  🔧 بررسی و تعمیر…\n');
  //  ۱) آن‌چه پنل خودش می‌تواند (پوشه‌ها، دسترسی‌ها، سرویسِ افتاده)
  let heal = null;
  if (await health(PORT)) {
    try {
      heal = await api('POST', '/api/platform/selfheal/repair', { installer: false });
      for (const r of heal.repaired || []) ok(`${r.name} — ${r.how}`);
      for (const s of heal.skipped || []) info(`${s.name}: ${s.why}`);
    } catch (e) {
      warn(`پنل تعمیر نکرد: ${e.message}`);
    }
  } else {
    warn('پنل بالا نیست — فقط نصب‌کننده دوباره می‌دود');
  }
  //  ۲) هرچه مانده: خودِ install.sh با --repair (همان مرحله‌ها، بی پرسش)
  const script = [path.join(PANEL_DIR, 'install.sh'), path.resolve(SERVER_DIR, '..', '..', 'install.sh')].find((p) => fs.existsSync(p));
  if (!script) {
    bad('install.sh پیدا نشد — کدِ پنل کامل نیست؟');
    return 1;
  }
  const skipSystem = process.env.VILL3N_SKIP_SYSTEM === '1';
  if (!isRoot() && !skipSystem) {
    warn('برای نصبِ دوبارهٔ ابزارها و سرویس‌ها root لازم است: «sudo vill3n repair»');
    return heal && heal.hardMissing === 0 ? 0 : 1;
  }
  const r = sh('/bin/bash', [script, '--repair', '--non-interactive'], { inherit: true, env: { ...process.env, VILL3N_ROOT: ROOT } });
  if (r.ok) ok('نصب‌کننده همهٔ مرحله‌ها را دوباره گذراند');
  else bad(`نصب‌کننده با کدِ ${r.code} برگشت — لاگ: ${path.join(ROOT, 'logs', 'core', 'install')}`);
  return r.ok ? 0 : 1;
}

async function update() {
  console.log('\n  ⬆️  به‌روزرسانی\n');
  //  ۱) پشتیبان — همیشه، پیش از هر چیزی
  if (await health(PORT)) {
    try {
      const r = await api('POST', '/api/platform/backup', { note: 'خودکار — پیش از به‌روزرسانی (vill3n update)' });
      ok(`پشتیبان گرفته شد: ${r.library.folder}`);
    } catch (e) {
      bad(`پشتیبان گرفته نشد: ${e.message} — به‌روزرسانی متوقف شد`);
      return 1;
    }
  } else {
    warn('پنل بالا نیست؛ پشتیبانِ پیش از به‌روزرسانی از راهِ پنل ممکن نشد');
  }
  //  ۲) کد
  if (fs.existsSync(path.join(PANEL_DIR, '.git')) && has('git')) {
    const before = sh('git', ['-C', PANEL_DIR, 'rev-parse', '--short', 'HEAD']).out;
    const pull = sh('git', ['-C', PANEL_DIR, 'pull', '--ff-only'], { inherit: true });
    if (!pull.ok) {
      bad('git pull ناموفق بود — چیزی دستی عوض شده؟ (git status را ببینید)');
      return 1;
    }
    const after = sh('git', ['-C', PANEL_DIR, 'rev-parse', '--short', 'HEAD']).out;
    if (before === after) ok(`همین نسخه تازه‌ترین است (${after})`);
    else ok(`کد از ${before} به ${after} رسید`);
    const ci = sh('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: SERVER_DIR, inherit: true });
    if (!ci.ok) {
      bad('npm ci ناموفق بود');
      return 1;
    }
    ok('وابستگی‌ها نصب شد');
  } else {
    //  نصبی که با گیت نیامده: همان به‌روزرسانیِ خودِ پنل (بستهٔ GitHub)
    info('کلونِ گیت نیست — به‌روزرسانی از بستهٔ GitHub (npm run update)');
    const r = sh('npm', ['run', 'update'], { cwd: SERVER_DIR, inherit: true });
    if (!r.ok) return 1;
  }
  //  ۳) ری‌استارت
  if (has('systemctl') && unitState(UNIT)) {
    const r = sh('systemctl', ['restart', UNIT]);
    if (r.ok) ok(`سرویس ${UNIT} دوباره بالا آمد`);
    else warn(`ری‌استارتِ سرویس نشد (${r.err || 'root لازم است؟'}) — «sudo systemctl restart ${UNIT}»`);
  } else {
    warn('systemd نیست — پنل را خودتان دوباره بالا بیاورید');
  }
  console.log('');
  return 0;
}

function logs() {
  const n = Number(args[1]) || 100;
  if (has('journalctl') && unitState(UNIT)) {
    sh('journalctl', ['-u', UNIT, '-n', String(n), '--no-pager'], { inherit: true });
    return 0;
  }
  const dir = path.join(ROOT, 'logs', 'core');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.log')).map((f) => path.join(dir, f)); } catch { /* */ }
  if (!files.length) {
    warn(`نه journalctl هست نه لاگی در ${dir}`);
    return 1;
  }
  const latest = files.map((f) => ({ f, m: fs.statSync(f).mtimeMs })).sort((a, b) => b.m - a.m)[0].f;
  const lines = fs.readFileSync(latest, 'utf8').split('\n');
  console.log(lines.slice(-n).join('\n'));
  return 0;
}

/* ------------------------- بازیابیِ مالکِ اصلی -------------------------
 *
 *  ⛔ (فاز ۱ ِ ممیزی، ۶-۳ / S6 — ۱۴۰۵/۰۸/۰۹) «راهِ بازیابیِ امنِ مالک» تا
 *  امروز نبود: رمزِ فراموش‌شده + گم شدنِ اپِ دوعاملی و کدهای بازیابی یعنی
 *  دست‌کاریِ دستیِ دیتابیس. این دستور همان را امن می‌کند:
 *
 *    • ⛔ **هرگز از HTTP نیست** — هیچ مسیری در پنل این کار را نمی‌کند. فقط
 *      کسی که روی همین کامپیوتر پوسته دارد و `panel.db` را می‌تواند بنویسد.
 *      (کلیدِ محلی هم نه: آن پنلِ بالا می‌خواهد، و این دستور دقیقاً برای
 *      وقتی است که هیچ راهی به پنل نمانده.)
 *    • پیش از هر تغییر یک پشتیبان از دیتابیس (`VACUUM INTO` در `backups/`).
 *    • رمزِ **یک‌بارمصرف**، یک بار روی همین ترمینال چاپ می‌شود و هیچ‌جا نوشته
 *      نمی‌شود؛ ورود با آن فقط «رمزِ تازه بگذار» را باز می‌کند
 *      (`must_change_password` — سرور اجبار می‌کند، نه رابط).
 *    • دوعاملی خاموش (مگر `--keep-2fa`)، نقشِ مدیر و حسابِ باز برمی‌گردد.
 *    • **همهٔ** نشست‌های پنل باطل — نشستِ دزدیده‌شده هم با بقیه می‌میرد.
 *    • یک ردیف در دفترِ رخدادها (`panel.owner.reset`) با کاربرِ سیستم‌عامل.
 *
 *  ⚠️ بی هیچ import از کدِ پنل (قاعدهٔ همین فایل): فقط `node:sqlite` و
 *  `node:crypto`، با همان قالبِ هشِ `src/auth.js` (scrypt N=16384 r=8 p=1).
 */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${key.toString('hex')}`;
}

/** رمزی که آدم بتواند درست تایپ کند: بی ۰/O و ۱/l/I */
function oneTimePassword() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(20);
  let out = '';
  for (const b of bytes) out += abc[b % abc.length];
  return `${out.slice(0, 5)}-${out.slice(5, 10)}-${out.slice(10, 15)}-${out.slice(15, 20)}`;
}

/** پوشهٔ دادهٔ پنل: --data-dir ← HLP_DATA_DIR / core.env ← پوشهٔ data کنارِ همین کد (نصبِ ویندوز) */
function panelDbPath() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  //  ⛔ --data-dir ِ صریح تنها جاست — نه این‌که اگر آن‌جا نبود، دیتابیسِ دیگری بی‌صدا عوض شود
  const dirs = (DATA_DIR_FLAG ? [DATA_DIR_FLAG] : [process.env.HLP_DATA_DIR, env.HLP_DATA_DIR, DATA_DIR, path.resolve(here, '..', 'data')])
    .filter(Boolean)
    .map((d) => path.resolve(d));
  for (const d of [...new Set(dirs)]) {
    const f = path.join(d, 'panel.db');
    if (fs.existsSync(f)) return f;
  }
  return null;
}

async function confirmTty(question) {
  if (!process.stdin.isTTY) return false;
  const rl = (await import('node:readline')).createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  return String(answer).trim().toLowerCase() === 'yes';
}

async function ownerReset() {
  const userFlag = flag('--user');
  const keep2fa = args.includes('--keep-2fa');
  const yes = args.includes('--yes');
  const dbFile = panelDbPath();
  if (!dbFile) {
    bad(`panel.db پیدا نشد — پوشهٔ داده را با --data-dir بدهید (پیش‌فرض: ${DATA_DIR})`);
    return 1;
  }
  try {
    fs.accessSync(dbFile, fs.constants.R_OK | fs.constants.W_OK);
  } catch {
    bad(`دسترسیِ نوشتن به ${dbFile} نیست — با کاربرِ سرویس یا «sudo vill3n owner-reset» بزنید`);
    return 1;
  }
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    bad('این Node ‏node:sqlite ندارد — Node 22.5 یا تازه‌تر لازم است (همان که پنل می‌خواهد)');
    return 1;
  }

  if (!JSON_OUT) {
    console.log('\n  🔑 بازیابیِ مالکِ اصلیِ پنل');
    info(`دیتابیس: ${dbFile}`);
    info(`رمز عوض می‌شود${keep2fa ? '' : '، دوعاملی خاموش می‌شود'} و همهٔ نشست‌های پنل (همهٔ کاربران) باطل می‌شوند.`);
  }
  if (!yes && !(await confirmTty('  برای ادامه «yes» بنویسید: '))) {
    warn('کاری نشد (بی --yes و بی تأیید)');
    return 2;
  }

  const db = new DatabaseSync(dbFile);
  const st = fs.statSync(dbFile);
  const touched = [dbFile];
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    const hasTable = (n) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(n));
    if (!hasTable('users')) {
      bad('جدولِ users نیست — این دیتابیسِ پنل نیست؟');
      return 1;
    }

    //  ۱) پشتیبان — پیش از هر تغییری
    const backups = path.join(path.dirname(dbFile), 'backups');
    fs.mkdirSync(backups, { recursive: true });
    const p2 = (n) => String(n).padStart(2, '0');
    const now = new Date();
    const stamp = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`;
    //  دو بازیابی در یک ثانیه نباید روی پشتیبانِ اولی بیفتد (VACUUM INTO روی فایلِ موجود خطا می‌دهد)
    let backup = path.join(backups, `panel-${stamp}-owner-reset.db`);
    for (let n = 2; fs.existsSync(backup); n++) backup = path.join(backups, `panel-${stamp}-owner-reset-${n}.db`);
    db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
    try { fs.chmodSync(backup, 0o600); } catch { /* ویندوز */ }
    touched.push(backup);

    //  ۲) ستونِ «رمزِ یک‌بارمصرف» — اگر پنلِ تازه هنوز رویش بالا نیامده (همان مهاجرتِ ۰۰۷)
    const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
    if (!cols.includes('must_change_password')) db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
    const hasTotp = cols.includes('totp_enabled');

    //  ۳) چه کسی؟ — همان قاعدهٔ `ownerId()`: قدیمی‌ترین مدیرِ فعال
    let target = null;
    if (userFlag) {
      target = db.prepare('SELECT * FROM users WHERE username = ?').get(String(userFlag).trim());
      if (!target) {
        bad(`کاربرِ «${userFlag}» نیست`);
        return 1;
      }
    } else {
      target = db.prepare("SELECT * FROM users WHERE role = 'admin' AND disabled = 0 ORDER BY id LIMIT 1").get()
        || db.prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
      if (!target) {
        bad('هیچ حسابِ مدیری در این پنل نیست — نامِ حساب را با --user بدهید');
        return 1;
      }
    }

    //  ۴) رمزِ یک‌بارمصرف، دوعاملی، نقش و باز بودن؛ همهٔ نشست‌ها؛ ردیفِ دفتر — یک تراکنش
    const otp = oneTimePassword();
    const osUser = (() => { try { return os.userInfo().username; } catch { return 'unknown'; } })();
    const totpWasOn = hasTotp && Boolean(target.totp_enabled);
    let revoked = 0;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare("UPDATE users SET password_hash = ?, must_change_password = 1, role = 'admin', disabled = 0 WHERE id = ?")
        .run(hashPassword(otp), target.id);
      if (hasTotp && !keep2fa) {
        db.prepare('UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_enabled = 0, totp_recovery = NULL WHERE id = ?').run(target.id);
      }
      revoked = hasTable('sessions') ? Number(db.prepare('DELETE FROM sessions').run().changes) : 0;
      db.exec(`CREATE TABLE IF NOT EXISTS cc_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL, entity TEXT, entity_id TEXT,
        project_id INTEGER, detail TEXT, result TEXT NOT NULL DEFAULT 'ok', ip TEXT, at INTEGER NOT NULL)`);
      const detail = {
        via: 'vill3n owner-reset',
        host: os.hostname(),
        totpReset: totpWasOn && !keep2fa,
        roleRestored: target.role !== 'admin',
        reenabled: Boolean(target.disabled),
        sessionsRevoked: revoked,
        backup: path.basename(backup),
      };
      db.prepare('INSERT INTO cc_audit(actor, action, entity, entity_id, detail, result, ip, at) VALUES(?,?,?,?,?,?,?,?)')
        .run(`cli:${osUser}`, 'panel.owner.reset', 'user', target.username, JSON.stringify(detail), 'ok', 'local-cli', Date.now());
      if (hasTable('events')) {
        db.prepare('INSERT INTO events(site_id, level, source, message, created_at) VALUES(NULL, ?, ?, ?, ?)')
          .run('warn', 'panel', `بازیابیِ مالک از خطِ فرمانِ همین کامپیوتر (${osUser}): رمزِ «${target.username}» یک‌بارمصرف شد${totpWasOn && !keep2fa ? '، دوعاملی خاموش شد' : ''} و ${revoked} نشست باطل شد`, Date.now());
      }
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* */ }
      throw e;
    }

    if (JSON_OUT) {
      console.log(JSON.stringify({ ok: true, username: target.username, oneTimePassword: otp, sessionsRevoked: revoked,
        totpReset: totpWasOn && !keep2fa, backup }, null, 2));
    } else {
      ok(`پشتیبان: ${backup}`);
      ok(`حساب: ${target.username}${target.role !== 'admin' ? ' (نقشِ مدیر برگشت)' : ''}${target.disabled ? ' (دوباره باز شد)' : ''}`);
      ok(`${revoked} نشست باطل شد${totpWasOn ? (keep2fa ? ' · دوعاملی ماند' : ' · دوعاملی خاموش شد') : ''}`);
      console.log(`\n  رمزِ یک‌بارمصرف (فقط همین یک بار نشان داده می‌شود):\n\n      ${otp}\n`);
      info('با همین رمز وارد پنل شوید؛ پنل پیش از هر کاری رمزِ تازه می‌خواهد. بعد دوعاملی را از «حسابِ من» دوباره روشن کنید.');
      info('اگر «درخواست‌ها زیاد شد» دیدید: ۱۵ دقیقه صبر کنید یا پنل را ری‌استارت کنید (سقفِ حدسِ رمز در حافظهٔ پنل است).');
      console.log('');
    }
    return 0;
  } finally {
    try { db.close(); } catch { /* */ }
    //  ⚠️ اجرا با root نباید فایلی بسازد که سرویسِ پنل نتواند بنویسد
    if (isRoot()) {
      for (const f of [...touched, `${dbFile}-wal`, `${dbFile}-shm`]) {
        try { if (fs.existsSync(f)) fs.chownSync(f, st.uid, st.gid); } catch { /* */ }
      }
    }
  }
}

function help() {
  console.log(`
  vill3n — سرورِ خانگی

    vill3n status            وضعیت: سرویس، پنل، سرورِ حساب، تونل، پشتیبان‌ها، وابستگی‌ها
    vill3n update            پشتیبان ← دریافتِ کدِ تازه ← نصبِ وابستگی‌ها ← ری‌استارت
    vill3n backup            پشتیبانِ همین حالا (کتابخانه + دیتابیسِ پنل، رمزشده در صفِ offsite)
    vill3n agent on|off      دستیارِ هوشمند
    vill3n repair            بررسی و تعمیرِ پوشه‌ها، دسترسی‌ها، ابزارها و سرویس‌ها (sudo برای ابزارها)
    vill3n logs [n]          آخرین n سطرِ لاگِ پنل
    vill3n owner-reset       بازیابیِ مالکِ اصلی، فقط روی همین کامپیوتر: پشتیبان ← رمزِ یک‌بارمصرف
                             ← دوعاملی خاموش ← همهٔ نشست‌ها باطل ← ردیفِ دفتر
                             [--user <نام>] [--keep-2fa] [--yes] [--data-dir <پوشهٔ دادهٔ پنل>]

  گزینه‌ها: --root <مسیر> (پیش‌فرض ${ROOT}) · --json (خروجیِ ماشینی برای status و owner-reset)
`);
  return 0;
}

try {
  let code = 0;
  switch (cmd) {
    case 'status': code = await status(); break;
    case 'backup': code = await backup(); break;
    case 'update': code = await update(); break;
    case 'repair': code = await repair(); break;
    case 'logs': code = logs(); break;
    case 'owner-reset': code = await ownerReset(); break;
    case 'agent':
      if (!['on', 'off'].includes(args[1])) { help(); code = 2; break; }
      code = await agent(args[1] === 'on');
      break;
    case 'help': case '--help': case '-h': code = help(); break;
    default:
      bad(`دستورِ «${cmd}» شناخته نیست`);
      help();
      code = 2;
  }
  process.exit(code);
} catch (e) {
  bad(e.message);
  process.exit(1);
}
