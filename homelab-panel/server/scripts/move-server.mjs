#!/usr/bin/env node
// ---------------------------------------------------------------------------
//  جابه‌جاییِ برنامهٔ سرور — از کامپیوترِ خانه به VPS/داکر (و برعکس)
//
//      node scripts/move-server.mjs export  --data <پوشهٔ داده> --out <فایل.vmove>
//      node scripts/move-server.mjs inspect <فایل.vmove>
//      node scripts/move-server.mjs import  <فایل.vmove> --data <پوشهٔ دادهٔ تازه>
//      node scripts/move-server.mjs compare <فایل.vmove> --data <پوشهٔ داده>
//
//  رمزِ بسته: VILL3N_MOVE_PASSPHRASE (دستِ‌کم ۱۲ نویسه)، وگرنه از صفحه‌کلید پرسیده می‌شود.
//  راهنمای کامل: docs/DEPLOY-ANYWHERE-fa.md، بخشِ «جابه‌جاییِ داده».
//
//  قاعده‌ها (همه را آزمونِ test/move-server.mjs می‌سنجد):
//    ⛔ **پوشهٔ مبدأ هرگز نوشته نمی‌شود** — export فقط می‌خواند. سرورِ خانه
//       همان‌طور کار می‌کند تا صاحب سامانه خودش DNS یا برنامه‌ها را عوض کند.
//    ⛔ پنلِ روشن ⇒ export نمی‌کند: PGliteِ سرورِ حساب وسطِ نوشتن کپیِ سالم
//       نمی‌دهد. (‎--force‎ فقط برای ‎panel.pid‎ِ جامانده؛ در مانیفست «داغ» می‌نشیند.)
//    ⛔ دیتابیسِ پنل با ‎VACUUM INTO‎ برداشته می‌شود (WAL هم سالم)، و شمارِ ردیفِ
//       هر جدول در مانیفست؛ هر فایلِ دیگر با sha256.
//    ⛔ بسته **همیشه رمزشده** است (AES-256-GCM با کلیدِ scrypt از رمز): رازهای
//       سرورِ حساب، کلیدِ گاوصندوق و دیتابیسِ پنل از اینترنت می‌گذرند. بسته‌ای که
//       یک بایتش عوض شده باشد باز نمی‌شود.
//    ⛔ import اول در پوشهٔ موقت باز می‌کند و هر فایل را با sha256 و هر جدول را
//       با شمارِ ردیف می‌سنجد؛ فقط اگر همه درست بود پوشه جابه‌جا می‌شود. پوشهٔ
//       دادهٔ پرِ مقصد بی ‎--force‎ دست نمی‌خورد، و با ‎--force‎ کنار گذاشته
//       می‌شود (‎<پوشه>/.vmove-before-<زمان>‎) — راهِ برگشت.
//    ⛔ تطبیقِ شمار و مبلغِ دیتابیسِ سرورِ حساب کارِ ‎scripts/move-db.js‎ِ همان
//       سرور است (ریپوی shop) — اگر پیدا شود، پیش و پس از انتقال اجرا و
//       مقایسه می‌شود؛ اگر نه، **صریح** می‌گوید «سنجیده نشد» (نه سبزِ ساختگی).
//
//  هیچ import از کدِ پنل جز ‎node:‎ — باید وقتی پنل خاموش است کار کند.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';

const MAGIC = Buffer.from('VILL3NMV1\0');          // ۱۰ بایت
const PLAIN_HEAD = 'vill3n-move-plain/1\n';
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };
export const FORMAT = 'vill3n-move';
export const FORMAT_VERSION = 1;

/** آن‌چه با پوشهٔ داده نمی‌رود — هر کدام دلیلی دارد (و گزینه‌ای برای آوردنش) */
export const EXCLUDES = Object.freeze([
  { match: (r) => ['panel.pid', 'restart.flag', '.ready-probe'].includes(r), why: 'نشانهٔ پروسهٔ همین کامپیوتر' },
  { match: (r) => /^panel\.db(-wal|-shm|-journal)?$/.test(r), why: 'جایش عکسِ سالمِ VACUUM INTO می‌رود' },
  { match: (r) => r.endsWith('.part'), why: 'نوشتنِ نیمه‌کاره' },
  { match: (r) => /^\.vmove-/.test(r), why: 'پوشهٔ کنارگذاشتهٔ import پیشین (راهِ برگشت، نه داده)' },
  { match: (r) => /^(tmp|logs)\//.test(r), opt: 'logs', why: 'موقت و لاگ' },
  { match: (r) => /^cloudflared\//.test(r), opt: 'tunnel', why: 'کلیدِ تونلِ خانه — دو سرور با یک تونل ترافیک را نصف می‌کنند' },
  { match: (r) => /^bin\//.test(r), why: 'ابزارِ مخصوصِ سیستم‌عاملِ همین کامپیوتر' },
  { match: (r) => /^(updates|offsite-queue)\//.test(r), why: 'بستهٔ به‌روزرسانی و صفِ پشتیبانِ بیرونی' },
  { match: (r) => /^(pump-updates|site-updates)\//.test(r), opt: 'mirrors', why: 'آینهٔ دانلود — سرورِ تازه خودش می‌گیرد' },
  { match: (r) => /^backups\//.test(r), opt: 'backups', why: 'نسخه‌های قدیمیِ دیتابیسِ پنل (روی خانه می‌مانند)' },
]);

/* ─────────────────────────────── کمکی‌ها ─────────────────────────────── */

const toPosix = (p) => p.split(path.sep).join('/');

async function sha256File(file) {
  const h = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), new Writable({ write(c, _e, cb) { h.update(c); cb(); } }));
  return h.digest('hex');
}

async function walkFiles(root) {
  const out = [];
  async function visit(dir) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue; //  پیوند از مرزِ پوشه بیرون نمی‌زند
      if (e.isDirectory()) await visit(full);
      else if (e.isFile()) out.push(full);
    }
  }
  await visit(root);
  return out.sort();
}

/** شمارِ ردیفِ هر جدولِ یک دیتابیسِ SQLite */
export function sqliteCounts(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const out = {};
    for (const { name } of db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all()) {
      out[name] = Number(db.prepare(`SELECT COUNT(*) AS n FROM "${String(name).replace(/"/g, '""')}"`).get().n);
    }
    return out;
  } finally {
    db.close();
  }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

export function panelRunning(dataDir) {
  try {
    const pid = Number(fs.readFileSync(path.join(dataDir, 'panel.pid'), 'utf8').trim());
    return pidAlive(pid) && pid !== process.pid ? pid : 0;
  } catch { return 0; }
}

async function askPassphrase(label) {
  const env = process.env.VILL3N_MOVE_PASSPHRASE;
  if (env) return env;
  if (!process.stdin.isTTY) throw new Error('رمزِ بسته لازم است: VILL3N_MOVE_PASSPHRASE را بگذارید.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = function write(s) { if (!/[\r\n]/.test(s)) return; rl.output.write(s); };
  const ask = (q) => new Promise((r) => { process.stdout.write(q); rl.question('', (a) => r(a)); });
  try { return await ask(label); } finally { rl.close(); process.stdout.write('\n'); }
}

function checkPassphrase(p) {
  if (String(p || '').length < 12) throw new Error('رمزِ بسته دستِ‌کم ۱۲ نویسه باشد — این بسته رازهای سرور را دارد.');
}

const kdf = (pass, salt) => crypto.scryptSync(String(pass), salt, 32, SCRYPT);

/* ─────────────────── نوشتن: رکوردها ⇒ gzip ⇒ AES-GCM ─────────────────── */

/**
 * بسته را می‌نویسد. `items`: [{ name, file }] — هر فایل همان‌طور که هست.
 * ⚠️ متنِ ساده هرگز روی دیسک نمی‌نشیند: رکورد ⇒ gzip ⇒ رمز ⇒ فایل، جریانی.
 */
async function writeBundle(out, items, manifest, pass) {
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', kdf(pass, salt), iv);
  cipher.setAAD(MAGIC);
  const tmp = `${out}.part`;
  const sink = fs.createWriteStream(tmp, { mode: 0o600 });
  await new Promise((r, j) => sink.write(Buffer.concat([MAGIC, salt, iv]), (e) => (e ? j(e) : r())));

  const gz = zlib.createGzip({ level: 6 });
  const done = pipeline(gz, cipher, sink, { end: false });
  const put = (buf) => new Promise((r) => (gz.write(buf) ? r() : gz.once('drain', r)));

  await put(Buffer.from(PLAIN_HEAD));
  for (const item of items) {
    const st = await fsp.stat(item.file);
    await put(Buffer.from(`${JSON.stringify({ t: 'f', name: item.name, size: st.size })}\n`));
    let sent = 0;
    for await (const chunk of fs.createReadStream(item.file)) {
      sent += chunk.length;
      await put(chunk);
    }
    if (sent !== st.size) throw new Error(`فایل وسطِ کار عوض شد: ${item.name}`);
  }
  const m = Buffer.from(JSON.stringify(manifest, null, 2));
  await put(Buffer.from(`${JSON.stringify({ t: 'manifest', size: m.length })}\n`));
  await put(m);
  gz.end();
  await done;
  await new Promise((r, j) => sink.end(cipher.getAuthTag(), (e) => (e ? j(e) : r())));
  await fsp.rename(tmp, out);
}

/* ────────────── خواندن: AES-GCM ⇒ gunzip ⇒ رکوردها (جریانی) ────────────── */

/**
 * بسته را باز می‌کند و هر فایل را زیرِ `dest` می‌نویسد (اگر dest باشد).
 * @returns {Promise<{manifest, files: Map<name, {size, sha256}>}>}
 * ⚠️ برچسبِ GCM در پایان سنجیده می‌شود؛ تا آن لحظه آن‌چه نوشته شده فقط در پوشهٔ
 *    موقت است و با شکست پاک می‌شود — هیچ فایلِ دست‌خورده‌ای جای داده نمی‌نشیند.
 */
async function readBundle(file, pass, dest = null) {
  const st = await fsp.stat(file);
  const head = Buffer.alloc(MAGIC.length + SALT_LEN + IV_LEN);
  const tag = Buffer.alloc(TAG_LEN);
  const h = await fsp.open(file, 'r');
  try {
    await h.read(head, 0, head.length, 0);
    await h.read(tag, 0, TAG_LEN, st.size - TAG_LEN);
  } finally { await h.close(); }
  if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('این فایل بستهٔ جابه‌جاییِ VILL3N نیست.');
  const salt = head.subarray(MAGIC.length, MAGIC.length + SALT_LEN);
  const iv = head.subarray(MAGIC.length + SALT_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', kdf(pass, salt), iv);
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(tag);

  const files = new Map();
  let manifest = null;
  let buf = Buffer.alloc(0);
  let state = { mode: 'magic' };
  let out = null;
  let hash = null;
  const realDest = dest ? path.resolve(dest) : null;

  const openFile = async (name, size) => {
    if (typeof name !== 'string' || !name.startsWith('data/') || name.includes('\0')) throw new Error(`نامِ نادرست در بسته: ${name}`);
    hash = crypto.createHash('sha256');
    if (!realDest) { out = null; return; }
    const target = path.resolve(realDest, name.slice('data/'.length));
    const rel = path.relative(realDest, target);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`مسیرِ بیرون از پوشه در بسته: ${name}`);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    out = fs.createWriteStream(target, { mode: 0o600 });
    state.size = size;
  };
  const writeOut = (chunk) => new Promise((r, j) => {
    hash.update(chunk);
    if (!out) return r();
    out.write(chunk, (e) => (e ? j(e) : r()));
  });
  const closeOut = () => new Promise((r, j) => (out ? out.end((e) => (e ? j(e) : r())) : r()));

  const parser = new Writable({
    async write(chunk, _e, cb) {
      try {
        buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
        for (;;) {
          if (state.mode === 'magic') {
            if (buf.length < PLAIN_HEAD.length) break;
            if (buf.subarray(0, PLAIN_HEAD.length).toString() !== PLAIN_HEAD) throw new Error('قالبِ درونیِ بسته شناخته نیست.');
            buf = buf.subarray(PLAIN_HEAD.length);
            state = { mode: 'header' };
          } else if (state.mode === 'header') {
            const nl = buf.indexOf(10);
            if (nl < 0) { if (buf.length > 64 * 1024) throw new Error('سرآیندِ خراب'); break; }
            const rec = JSON.parse(buf.subarray(0, nl).toString('utf8'));
            buf = buf.subarray(nl + 1);
            if (rec.t === 'f') {
              if (!Number.isSafeInteger(rec.size) || rec.size < 0) throw new Error('اندازهٔ نادرست');
              await openFile(rec.name, rec.size);
              state = { mode: 'body', name: rec.name, left: rec.size, size: rec.size };
            } else if (rec.t === 'manifest') {
              state = { mode: 'manifest', left: rec.size, parts: [] };
            } else throw new Error(`رکوردِ ناشناخته: ${rec.t}`);
          } else if (state.mode === 'body') {
            if (state.left === 0 || buf.length) {
              const take = Math.min(state.left, buf.length);
              if (take) await writeOut(buf.subarray(0, take));
              buf = buf.subarray(take);
              state.left -= take;
            }
            if (state.left === 0) {
              await closeOut();
              files.set(state.name, { size: state.size, sha256: hash.digest('hex') });
              out = null;
              state = { mode: 'header' };
              continue;
            }
            break;
          } else if (state.mode === 'manifest') {
            const take = Math.min(state.left, buf.length);
            state.parts.push(buf.subarray(0, take));
            buf = buf.subarray(take);
            state.left -= take;
            if (state.left === 0) {
              manifest = JSON.parse(Buffer.concat(state.parts).toString('utf8'));
              state = { mode: 'end' };
            }
            break;
          } else if (state.mode === 'end') {
            if (buf.length) throw new Error('داده‌ای پس از مانیفست — بسته دست خورده است.');
            break;
          }
        }
        cb();
      } catch (e) { cb(e); }
    },
  });

  const body = fs.createReadStream(file, { start: head.length, end: st.size - TAG_LEN - 1 });
  try {
    await pipeline(body, decipher, zlib.createGunzip(), parser);
  } catch (e) {
    try { out?.destroy(); } catch { /* بسته */ }
    //  ⚠️ با رمزِ غلط یا بایتِ دست‌خورده، خروجیِ رمزگشایی پیش از سنجشِ برچسب
    //  به gunzip می‌رسد و همان‌جا می‌شکند — هر دو یک معنا دارند.
    if (/unable to authenticate|auth|header check|invalid|unexpected end|Z_DATA_ERROR|JSON|قالب|سرآیند|مانیفست/i.test(`${e.code || ''} ${e.message}`)) {
      throw new Error(`بسته باز نشد: رمز نادرست است یا فایل دست خورده/ناقص است (${e.code || e.message}).`);
    }
    throw e;
  }
  if (!manifest) throw new Error('بسته ناقص است (مانیفست نیست).');
  if (manifest.format !== FORMAT || manifest.formatVersion !== FORMAT_VERSION) throw new Error('نسخهٔ بسته شناخته نیست.');
  return { manifest, files };
}

/* ───────────────────── تطبیقِ دیتابیسِ سرورِ حساب ───────────────────── */

/** ‎scripts/move-db.js‎ِ سرورِ حساب (ریپوی shop) — اگر کنارِ این نصب باشد */
export function findAccountTool(dataDir, explicit = '') {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    explicit,
    process.env.HLP_ACCOUNT_DIR && path.join(process.env.HLP_ACCOUNT_DIR, 'scripts', 'move-db.js'),
    path.join(dataDir, 'account-server', 'app', 'scripts', 'move-db.js'),
    path.resolve(here, '..', '..', 'account-server', 'scripts', 'move-db.js'),
    path.resolve(here, '..', '..', '..', 'account-server', 'scripts', 'move-db.js'),
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

/** شمار، هش و جمعِ مبلغ‌های دیتابیسِ PGlite با ابزارِ خودِ سرورِ حساب */
export function inspectAccountDb(tool, pgDir) {
  if (!tool) return { ok: false, reason: 'ابزارِ تطبیقِ سرورِ حساب (scripts/move-db.js) پیدا نشد — با --account-tool بدهید؛ تا آن وقت فقط sha256ِ فایل‌ها سنجیده شد.' };
  if (!fs.existsSync(pgDir)) return { ok: false, reason: 'دیتابیسِ سرورِ حساب در این پوشه نیست.' };
  const r = spawnSync(process.execPath, [tool, 'inspect', '--db', `pglite:${pgDir}`, '--json'], { encoding: 'utf8', timeout: 10 * 60_000, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) return { ok: false, reason: `move-db inspect شکست خورد: ${(r.stderr || r.stdout || '').trim().slice(0, 400)}` };
  try { return { ok: true, report: JSON.parse(r.stdout) }; } catch { return { ok: false, reason: 'خروجیِ move-db inspect خوانده نشد.' }; }
}

/** دو گزارشِ inspect یکی‌اند؟ (شمار، هشِ ردیف‌ها و جمعِ مبلغ‌ها) */
export function sameAccountReport(a, b) {
  const diffs = [];
  const ta = a?.tables || {};
  const tb = b?.tables || {};
  for (const name of new Set([...Object.keys(ta), ...Object.keys(tb)])) {
    const x = ta[name];
    const y = tb[name];
    if (!x || !y) { diffs.push(`${name}: فقط در یک طرف`); continue; }
    if (x.rows !== y.rows) diffs.push(`${name}: ردیف ${x.rows} ⇐ ${y.rows}`);
    if (x.hash !== y.hash) diffs.push(`${name}: محتوای ردیف‌ها فرق دارد`);
    for (const col of new Set([...Object.keys(x.sums || {}), ...Object.keys(y.sums || {})])) {
      if (String(x.sums?.[col]) !== String(y.sums?.[col])) diffs.push(`${name}.${col}: جمع ${x.sums?.[col]} ⇐ ${y.sums?.[col]}`);
    }
  }
  return { same: diffs.length === 0, diffs };
}

/* ─────────────── نشانی‌های مطلقِ پوشهٔ داده در دیتابیسِ پنل ─────────────── */

/** ‎C:\X\data\websites\a‎ ⇒ ‎/data/websites/a‎ — فقط آن‌چه زیرِ پوشهٔ دادهٔ قدیم بود */
export function remapPath(value, oldRoot, newRoot) {
  if (typeof value !== 'string' || !oldRoot) return value;
  const win = /^[A-Za-z]:[\\/]/.test(oldRoot) || oldRoot.includes('\\');
  const norm = (s) => (win ? s.replace(/\\/g, '/').toLowerCase() : s).replace(/\/+$/, '');
  const v = win ? value.replace(/\\/g, '/') : value;
  const base = norm(oldRoot);
  const cmp = win ? v.toLowerCase() : v;
  if (cmp !== base && !cmp.startsWith(`${base}/`)) return value;
  const rest = v.slice(base.length).replace(/^\/+/, '');
  return rest ? path.join(newRoot, ...rest.split('/')) : newRoot;
}

function remapDeep(v, oldRoot, newRoot, hit) {
  if (typeof v === 'string') { const n = remapPath(v, oldRoot, newRoot); if (n !== v) hit.n++; return n; }
  if (Array.isArray(v)) return v.map((x) => remapDeep(x, oldRoot, newRoot, hit));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, remapDeep(x, oldRoot, newRoot, hit)]));
  return v;
}

/** نشانی‌های پوشهٔ دادهٔ قدیم را در دیتابیسِ پنلِ تازه به پوشهٔ تازه برمی‌گرداند */
export function remapPanelDb(dbFile, oldRoot, newRoot) {
  const db = new DatabaseSync(dbFile);
  const hit = { n: 0 };
  try {
    const has = (t) => db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(t);
    db.exec('BEGIN');
    if (has('settings')) {
      const upd = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
      for (const row of db.prepare('SELECT key, value FROM settings').all()) {
        let parsed;
        try { parsed = JSON.parse(row.value); } catch { continue; }
        const before = hit.n;
        const next = remapDeep(parsed, oldRoot, newRoot, hit);
        if (hit.n !== before) upd.run(JSON.stringify(next), row.key);
      }
    }
    for (const [table, col] of [['sites', 'root_path'], ['cc_projects', 'storage_path']]) {
      if (!has(table)) continue;
      const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
      if (!cols.includes(col)) continue;
      const upd = db.prepare(`UPDATE ${table} SET ${col} = ? WHERE rowid = ?`);
      for (const row of db.prepare(`SELECT rowid AS id, ${col} AS v FROM ${table}`).all()) {
        const n = remapPath(row.v, oldRoot, newRoot);
        if (n !== row.v) { upd.run(n, row.id); hit.n++; }
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* بسته */ }
    throw e;
  } finally {
    db.close();
  }
  return hit.n;
}

/** تنظیم‌هایی که به بیرونِ پوشهٔ داده اشاره می‌کنند — با پوشه نمی‌روند و باید گفت */
function outsidePaths(dbFile, dataDir) {
  const keys = ['cc_storage_root', 'sites_root', 'extra_file_roots', 'scan_roots'];
  const out = [];
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    for (const key of keys) {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
      if (!row) continue;
      let v;
      try { v = JSON.parse(row.value); } catch { continue; }
      for (const p of [].concat(v).filter((x) => typeof x === 'string' && x)) {
        if (remapPath(p, dataDir, '/x') === p) out.push({ key, path: p });
      }
    }
  } catch { /* بی جدولِ تنظیمات */ } finally { db.close(); }
  return out;
}

/* ─────────────────────────────── فرمان‌ها ─────────────────────────────── */

export async function exportData({ dataDir, out, pass, include = {}, force = false, accountTool = '' }) {
  const src = path.resolve(dataDir);
  if (!fs.existsSync(path.join(src, 'panel.db'))) throw new Error(`این پوشهٔ دادهٔ پنل نیست (panel.db نیست): ${src}`);
  checkPassphrase(pass);
  const running = panelRunning(src);
  if (running && !force) {
    throw new Error(`پنل روشن است (پروسهٔ ${running}). اول ببندیدش (برنامهٔ ویندوز: خروج از کنارِ ساعت؛ لینوکس: systemctl stop vill3n-panel) — ` +
      'سرورِ حسابِ روشن کپیِ سالم نمی‌دهد. بعد از export دوباره بازش کنید؛ سرورِ خانه همان‌طور کار می‌کند.');
  }

  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'vill3n-move-'));
  try {
    //  ۱) عکسِ سالمِ دیتابیسِ پنل — از **رونوشت** (با WALش)، نه خودِ فایل: باز کردنِ
    //  خودِ دیتابیس، حتی فقط‌خواندنی، کنارش ‎-wal/-shm‎ می‌سازد یا WAL را در آن
    //  می‌ریزد؛ پوشهٔ مبدأ باید بایت‌به‌بایت همان بماند.
    const copy = path.join(work, 'source.db');
    await fsp.copyFile(path.join(src, 'panel.db'), copy);
    if (fs.existsSync(path.join(src, 'panel.db-wal'))) await fsp.copyFile(path.join(src, 'panel.db-wal'), `${copy}-wal`);
    const snap = path.join(work, 'panel.db');
    const live = new DatabaseSync(copy);
    try { live.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`); } finally { live.close(); }
    const panelTables = sqliteCounts(snap);

    //  ۲) فهرستِ فایل‌ها
    const items = [{ name: 'data/panel.db', file: snap }];
    const excluded = [];
    for (const file of await walkFiles(src)) {
      const rel = toPosix(path.relative(src, file));
      const rule = EXCLUDES.find((x) => x.match(rel));
      if (rule && !(rule.opt && include[rule.opt])) { excluded.push(rel); continue; }
      items.push({ name: `data/${rel}`, file });
    }

    //  ۳) sha256 ِ هر فایل
    const files = [];
    for (const it of items) {
      const st = await fsp.stat(it.file);
      files.push({ name: it.name, size: st.size, sha256: await sha256File(it.file) });
    }

    //  ۴) تطبیقِ سرورِ حساب (اگر ابزارش هست)
    const tool = findAccountTool(src, accountTool);
    const account = inspectAccountDb(tool, path.join(src, 'account-server', 'pg'));

    let panelVersion = null;
    try { panelVersion = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version; } catch { /* بی نسخه */ }
    const manifest = {
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      createdAt: new Date().toISOString(),
      source: { host: os.hostname(), platform: process.platform, dataDir: src, panelVersion },
      hot: Boolean(running),
      include,
      files,
      bytes: files.reduce((a, f) => a + f.size, 0),
      panelDb: { tables: panelTables },
      account: account.ok ? { reconciled: true, report: account.report } : { reconciled: false, reason: account.reason },
      excluded,
      outside: outsidePaths(snap, src),
    };
    await writeBundle(path.resolve(out), items, manifest, pass);
    return { out: path.resolve(out), manifest };
  } finally {
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

export async function inspectBundle({ file, pass }) {
  const { manifest, files } = await readBundle(file, pass, null);
  const bad = manifest.files.filter((f) => files.get(f.name)?.sha256 !== f.sha256);
  const extra = [...files.keys()].filter((n) => !manifest.files.some((f) => f.name === n));
  return { manifest, ok: bad.length === 0 && extra.length === 0, bad: bad.map((f) => f.name), extra };
}

export async function importData({ file, dataDir, pass, force = false, accountTool = '', accountEnv = '' }) {
  const target = path.resolve(dataDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  /*
   *  ⚠️ پوشهٔ موقت **داخلِ** خودِ مقصد است، نه کنارش: در داکر مقصد خودِ volume
   *  است (‎/data‎) و نه جابه‌جا می‌شود نه می‌شود از بیرونش rename کرد (EXDEV).
   *  داخلِ همان دیسک، جابه‌جاییِ نهایی فقط چند rename است.
   */
  const staging = path.join(target, `.vmove-importing-${stamp}`);
  const previousDir = path.join(target, `.vmove-before-${stamp}`);
  const existing = fs.existsSync(target) ? fs.readdirSync(target).filter((n) => !n.startsWith('.vmove-importing-')) : [];
  if (existing.length && !force) {
    throw new Error(`پوشهٔ مقصد خالی نیست: ${target} — برای کنار گذاشتنش (نه پاک کردن) --force بدهید.`);
  }
  if (panelRunning(target)) throw new Error('پنلِ مقصد روشن است — اول خاموشش کنید.');
  await fsp.mkdir(target, { recursive: true });

  let promoted = false;
  try {
    const { manifest, files } = await readBundle(file, pass, staging);
    //  ۱) هر فایل با sha256
    const bad = manifest.files.filter((f) => files.get(f.name)?.sha256 !== f.sha256 || files.get(f.name)?.size !== f.size);
    if (bad.length) throw new Error(`${bad.length} فایل با مانیفست نمی‌خواند: ${bad.slice(0, 5).map((f) => f.name).join('، ')}`);
    //  ۲) هر جدولِ پنل با شمارِ ردیف
    const counts = sqliteCounts(path.join(staging, 'panel.db'));
    const tableDiff = Object.keys({ ...manifest.panelDb.tables, ...counts })
      .filter((t) => manifest.panelDb.tables[t] !== counts[t]);
    if (tableDiff.length) throw new Error(`شمارِ ردیفِ جدول‌های پنل نمی‌خواند: ${tableDiff.join('، ')}`);
    //  ۳) سرورِ حساب: همان شمار، هش و جمعِ مبلغ
    let account = { reconciled: false, reason: manifest.account?.reason || 'در بسته گزارشی نبود' };
    if (manifest.account?.reconciled) {
      const tool = findAccountTool(staging, accountTool);
      const now = inspectAccountDb(tool, path.join(staging, 'account-server', 'pg'));
      if (!now.ok) {
        account = { reconciled: false, reason: now.reason };
      } else {
        const cmp = sameAccountReport(manifest.account.report, now.report);
        if (!cmp.same) throw new Error(`دیتابیسِ سرورِ حساب پس از باز شدن با مبدأ نمی‌خواند: ${cmp.diffs.slice(0, 5).join(' · ')}`);
        account = { reconciled: true, tables: Object.keys(now.report.tables || {}).length, totals: now.report.totals || null };
      }
    }
    //  ۴) نشانی‌های پوشهٔ داده در دیتابیسِ پنل ⇒ پوشهٔ تازه
    const remapped = remapPanelDb(path.join(staging, 'panel.db'), manifest.source.dataDir, target);

    //  ۵) فقط حالا جابه‌جا — آن‌چه در مقصد بود کنار می‌رود، پاک نمی‌شود
    let previous = null;
    if (existing.length) {
      await fsp.mkdir(previousDir, { recursive: true });
      for (const name of existing) await fsp.rename(path.join(target, name), path.join(previousDir, name));
      previous = previousDir;
    }
    for (const name of await fsp.readdir(staging)) await fsp.rename(path.join(staging, name), path.join(target, name));
    await fsp.rm(staging, { recursive: true, force: true });
    promoted = true;

    //  ۶) محیطِ سرورِ حسابِ جدا (اگر خواسته شد) — همان رازها، وگرنه همهٔ نشست‌ها می‌پرند
    let envFile = null;
    if (accountEnv) {
      const sec = JSON.parse(fs.readFileSync(path.join(target, 'account-server', 'secrets.json'), 'utf8'));
      const lines = [
        '# رازهای سرورِ حسابِ منتقل‌شده — همان مقدارهای خانه (عوض کردنشان همهٔ نشست‌ها را باطل می‌کند)',
        `API_SECRET=${sec.apiSecret}`, `OTP_SECRET=${sec.otpSecret}`, `JWT_SECRET=${sec.jwtSecret}`,
        `ADMIN_BOOTSTRAP_USER=${sec.adminUser}`, `ADMIN_BOOTSTRAP_PASSWORD=${sec.adminPassword}`, '',
      ];
      envFile = path.resolve(accountEnv);
      fs.writeFileSync(envFile, lines.join('\n'), { mode: 0o600 });
    }
    return { target, previous, manifest, files: files.size, remapped, account, envFile };
  } finally {
    if (!promoted) await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

/** پس از import (یا هر وقت): پوشهٔ داده هنوز همان بسته است؟ */
export async function compareData({ file, dataDir, pass, accountTool = '' }) {
  const { manifest } = await readBundle(file, pass, null);
  const root = path.resolve(dataDir);
  const diffs = [];
  for (const f of manifest.files) {
    if (f.name === 'data/panel.db') continue; //  پس از import نشانی‌ها عوض می‌شوند؛ جدول‌ها پایین سنجیده می‌شوند
    const p = path.join(root, ...f.name.slice(5).split('/'));
    if (!fs.existsSync(p)) { diffs.push(`نیست: ${f.name}`); continue; }
    if ((await sha256File(p)) !== f.sha256) diffs.push(`عوض شده: ${f.name}`);
  }
  const counts = sqliteCounts(path.join(root, 'panel.db'));
  for (const t of Object.keys(manifest.panelDb.tables)) {
    if ((counts[t] ?? -1) < manifest.panelDb.tables[t]) diffs.push(`جدولِ ${t}: ${manifest.panelDb.tables[t]} ⇐ ${counts[t] ?? 'نیست'}`);
  }
  let account = null;
  if (manifest.account?.reconciled) {
    const now = inspectAccountDb(findAccountTool(root, accountTool), path.join(root, 'account-server', 'pg'));
    account = now.ok ? sameAccountReport(manifest.account.report, now.report) : { same: false, diffs: [now.reason] };
    if (!account.same) diffs.push(...account.diffs.map((d) => `سرورِ حساب: ${d}`));
  }
  return { same: diffs.length === 0, diffs };
}

/* ─────────────────────────────── خطِ فرمان ─────────────────────────────── */

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) args[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) args[k] = argv[++i];
      else args[k] = true;
    } else args._.push(a);
  }
  return args;
}

const HELP = `جابه‌جاییِ برنامهٔ سرور (docs/DEPLOY-ANYWHERE-fa.md)

  export  --data <پوشهٔ داده> --out <فایل.vmove> [--with-tunnel] [--with-mirrors] [--with-backups] [--with-logs]
  inspect <فایل.vmove>
  import  <فایل.vmove> --data <پوشهٔ تازه> [--force] [--account-env <فایلِ env>]
  compare <فایل.vmove> --data <پوشهٔ داده>

  رمز: VILL3N_MOVE_PASSPHRASE (یا از صفحه‌کلید) · --account-tool <مسیرِ move-db.js>`;

function fmtBytes(n) {
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (!cmd || args.help || args.h) { console.log(HELP); return 0; }
  const accountTool = args['account-tool'] || '';
  if (cmd === 'export') {
    if (!args.data || !args.out) { console.error(HELP); return 2; }
    const pass = await askPassphrase('رمزِ بسته (دستِ‌کم ۱۲ نویسه — به مقصد هم لازم است): ');
    const include = { tunnel: !!args['with-tunnel'], mirrors: !!args['with-mirrors'], backups: !!args['with-backups'], logs: !!args['with-logs'] };
    const r = await exportData({ dataDir: args.data, out: args.out, pass, include, force: !!args.force, accountTool });
    const m = r.manifest;
    console.log(`✅ بسته ساخته شد: ${r.out}`);
    console.log(`   ${m.files.length} فایل · ${fmtBytes(m.bytes)} · ${Object.keys(m.panelDb.tables).length} جدولِ پنل · رمزشده (AES-256-GCM)`);
    console.log(m.account.reconciled
      ? `   سرورِ حساب: ${Object.keys(m.account.report.tables || {}).length} جدول شمرده و هش شد${m.account.report.totals ? ` · ردیف‌ها ${m.account.report.totals.rows}` : ''}`
      : `   ⚠️ سرورِ حساب: ${m.account.reason}`);
    if (m.outside.length) console.log(`   ⚠️ بیرونِ پوشهٔ داده (با بسته نمی‌رود): ${m.outside.map((o) => o.path).join('، ')}`);
    if (m.hot) console.log('   ⚠️ با --force از پنلِ روشن گرفته شد — دیتابیسِ سرورِ حساب ممکن است ناسازگار باشد.');
    console.log('   سرورِ خانه دست نخورد و همان‌طور کار می‌کند.');
    return 0;
  }
  if (cmd === 'inspect') {
    const file = args._[1];
    if (!file) { console.error(HELP); return 2; }
    const pass = await askPassphrase('رمزِ بسته: ');
    const r = await inspectBundle({ file, pass });
    const m = r.manifest;
    console.log(`${r.ok ? '✅' : '❌'} ${file}`);
    console.log(`   از ${m.source.host} (${m.source.platform}) · ${m.createdAt} · پنل ${m.source.panelVersion || '؟'}`);
    console.log(`   ${m.files.length} فایل · ${fmtBytes(m.bytes)} · جدول‌های پنل: ${Object.entries(m.panelDb.tables).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    console.log(m.account.reconciled ? `   سرورِ حساب: ${JSON.stringify(m.account.report.totals || {})}` : `   ⚠️ سرورِ حساب: ${m.account.reason}`);
    if (!r.ok) console.log(`   ❌ نمی‌خواند: ${[...r.bad, ...r.extra].slice(0, 10).join('، ')}`);
    return r.ok ? 0 : 1;
  }
  if (cmd === 'import') {
    const file = args._[1];
    if (!file || !args.data) { console.error(HELP); return 2; }
    const pass = await askPassphrase('رمزِ بسته: ');
    const r = await importData({ file, dataDir: args.data, pass, force: !!args.force, accountTool, accountEnv: args['account-env'] || '' });
    console.log(`✅ ${r.files} فایل باز و با sha256 سنجیده شد ⇐ ${r.target}`);
    console.log(`   جدول‌های پنل: شمارِ ردیف‌ها همان مبدأ · ${r.remapped} نشانیِ پوشهٔ داده به پوشهٔ تازه برگشت`);
    console.log(r.account.reconciled
      ? `   سرورِ حساب: ${r.account.tables} جدول — شمار، هشِ ردیف‌ها و جمعِ مبلغ‌ها همان مبدأ ✅`
      : `   ⚠️ سرورِ حساب سنجیده نشد: ${r.account.reason}`);
    if (r.previous) console.log(`   پوشهٔ قبلی کنار رفت (راهِ برگشت): ${r.previous}`);
    if (r.envFile) console.log(`   رازهای سرورِ حساب برای سرورِ جدا: ${r.envFile} (۶۰۰)`);
    if (r.manifest.outside?.length) console.log(`   ⚠️ این‌ها بیرونِ پوشهٔ داده بودند و نیامدند: ${r.manifest.outside.map((o) => o.path).join('، ')}`);
    return 0;
  }
  if (cmd === 'compare') {
    const file = args._[1];
    if (!file || !args.data) { console.error(HELP); return 2; }
    const pass = await askPassphrase('رمزِ بسته: ');
    const r = await compareData({ file, dataDir: args.data, pass, accountTool });
    console.log(r.same ? '✅ پوشهٔ داده همان بسته است.' : `❌ ${r.diffs.length} اختلاف:\n   ${r.diffs.slice(0, 30).join('\n   ')}`);
    return r.same ? 0 : 1;
  }
  console.error(HELP);
  return 2;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().then((code) => process.exit(code)).catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
}
