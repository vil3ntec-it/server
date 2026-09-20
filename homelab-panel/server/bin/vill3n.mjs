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
//
//  با پنل از راهِ **کلیدِ محلی** حرف می‌زند (src/local-key.js): فایلی که فقط
//  روی همین کامپیوتر خوانده می‌شود، پس نه رمزی لازم است نه ورودی. تنظیمات از
//  <ریشه>/secrets/core.env می‌آید — همان که install.sh نوشته.
//
//  ⚠️ هیچ وابستگی‌ای ندارد و از هیچ ماژولِ پنل import نمی‌کند: باید وقتی هم
//  که پنل افتاده یا node_modules خراب است کار کند — دقیقاً وقتی لازم است.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const v = args[i + 1] ?? '';
  args.splice(i, 2);
  return v;
};
const ROOT = path.resolve(flag('--root') || process.env.VILL3N_ROOT || '/srv/vill3n');
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

function help() {
  console.log(`
  vill3n — سرورِ خانگی

    vill3n status            وضعیت: سرویس، پنل، سرورِ حساب، تونل، پشتیبان‌ها، وابستگی‌ها
    vill3n update            پشتیبان ← دریافتِ کدِ تازه ← نصبِ وابستگی‌ها ← ری‌استارت
    vill3n backup            پشتیبانِ همین حالا (کتابخانه + دیتابیسِ پنل، رمزشده در صفِ offsite)
    vill3n agent on|off      دستیارِ هوشمند
    vill3n repair            بررسی و تعمیرِ پوشه‌ها، دسترسی‌ها، ابزارها و سرویس‌ها (sudo برای ابزارها)
    vill3n logs [n]          آخرین n سطرِ لاگِ پنل

  گزینه‌ها: --root <مسیر> (پیش‌فرض ${ROOT}) · --json (خروجیِ ماشینی برای status)
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
