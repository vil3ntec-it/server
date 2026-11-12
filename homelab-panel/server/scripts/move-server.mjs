#!/usr/bin/env node
// ---------------------------------------------------------------------------
//  جابه‌جاییِ برنامهٔ سرور — از کامپیوترِ خانه به VPS/داکر (و برعکس)
//
//      node scripts/move-server.mjs export  --data <پوشهٔ داده> --out <فایل.vmove>
//      node scripts/move-server.mjs inspect <فایل.vmove>
//      node scripts/move-server.mjs import  <فایل.vmove> --data <پوشهٔ دادهٔ تازه>
//      node scripts/move-server.mjs compare <فایل.vmove> --data <پوشهٔ داده>
//      … export|import --only <site:نامک | account-server | stations>   فقط یک برنامه (۱.۵۰.۹۵)
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
/** نخستین بایت‌های هر بسته — پنل پیش از نوشتنِ بارگذاری روی دیسک همین را می‌سنجد */
export const BUNDLE_MAGIC = Buffer.from(MAGIC);
const PLAIN_HEAD = 'vill3n-move-plain/1\n';
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };
export const FORMAT = 'vill3n-move';
export const FORMAT_VERSION = 1;

/** آن‌چه با پوشهٔ داده نمی‌رود — هر کدام دلیلی دارد (و گزینه‌ای برای آوردنش) */
export const EXCLUDES = Object.freeze([
  { what: 'panel.pid · restart.flag', match: (r) => ['panel.pid', 'restart.flag', '.ready-probe'].includes(r), why: 'نشانهٔ پروسهٔ همین کامپیوتر' },
  { what: 'panel.db-wal', match: (r) => /^panel\.db(-wal|-shm|-journal)?$/.test(r), why: 'جایش عکسِ سالمِ VACUUM INTO می‌رود' },
  { what: '*.part', match: (r) => r.endsWith('.part'), why: 'نوشتنِ نیمه‌کاره' },
  { what: '.vmove-*', match: (r) => /^\.vmove-/.test(r), why: 'پوشهٔ کنارگذاشتهٔ import پیشین (راهِ برگشت، نه داده)' },
  { what: 'tmp/ · logs/', match: (r) => /^(tmp|logs)\//.test(r), opt: 'logs', why: 'موقت و لاگ' },
  { what: 'cloudflared/', match: (r) => /^cloudflared\//.test(r), opt: 'tunnel', why: 'کلیدِ تونلِ خانه — دو سرور با یک تونل ترافیک را نصف می‌کنند' },
  { what: 'bin/', match: (r) => /^bin\//.test(r), why: 'ابزارِ مخصوصِ سیستم‌عاملِ همین کامپیوتر' },
  { what: 'updates/ · offsite-queue/', match: (r) => /^(updates|offsite-queue)\//.test(r), why: 'بستهٔ به‌روزرسانی و صفِ پشتیبانِ بیرونی' },
  { what: 'pump-updates/ · site-updates/', match: (r) => /^(pump-updates|site-updates)\//.test(r), opt: 'mirrors', why: 'آینهٔ دانلود — سرورِ تازه خودش می‌گیرد' },
  { what: 'backups/', match: (r) => /^backups\//.test(r), opt: 'backups', why: 'نسخه‌های قدیمیِ دیتابیسِ پنل (روی خانه می‌مانند)' },
]);

/* ─────────────────────────────── کمکی‌ها ─────────────────────────────── */

const toPosix = (p) => p.split(path.sep).join('/');

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

export const MIN_PASSPHRASE = 12;
export function checkPassphrase(p) {
  if (String(p || '').length < MIN_PASSPHRASE) throw new Error('رمزِ بسته دستِ‌کم ۱۲ نویسه باشد — این بسته رازهای سرور را دارد.');
}

const kdf = (pass, salt) => crypto.scryptSync(String(pass), salt, 32, SCRYPT);

/* ─────────────────── نوشتن: رکوردها ⇒ gzip ⇒ AES-GCM ─────────────────── */

/**
 * بسته را می‌نویسد. `items`: [{ name, file }] — هر فایل همان‌طور که هست.
 * ⚠️ متنِ ساده هرگز روی دیسک نمی‌نشیند: رکورد ⇒ gzip ⇒ رمز ⇒ فایل، جریانی.
 * ⛔ (۱.۵۰.۹۳) sha256 ِ هر فایل **همان بایت‌هایی است که در بسته رفت** (هنگامِ نوشتن، نه یک دورِ جدا پیش از آن):
 *    از پنلِ روشن فایلی که میانِ «هش» و «نوشتن» عوض می‌شد بسته‌ای می‌ساخت که مقصد حتماً ردش می‌کرد.
 *    هر فایل دقیقاً به اندازهٔ سرآیندش خوانده می‌شود؛ کوتاه‌تر شده ⇒ شکست (فایلِ نیمه‌نوشته پاک می‌شود).
 *    مانیفست (`files`، `bytes`) در پایانِ بسته است، پس همین‌جا پر می‌شود.
 */
async function writeBundle(out, items, manifest, pass) {
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', kdf(pass, salt), iv);
  cipher.setAAD(MAGIC);
  const tmp = `${out}.part`;
  const sink = fs.createWriteStream(tmp, { mode: 0o600 });
  const gz = zlib.createGzip({ level: 6 });
  let done = null;
  try {
    await new Promise((r, j) => sink.write(Buffer.concat([MAGIC, salt, iv]), (e) => (e ? j(e) : r())));
    done = pipeline(gz, cipher, sink, { end: false });
    done.catch(() => {});
    const put = (buf) => new Promise((r) => (gz.write(buf) ? r() : gz.once('drain', r)));

    await put(Buffer.from(PLAIN_HEAD));
    const files = [];
    for (const item of items) {
      const st = await fsp.stat(item.file);
      await put(Buffer.from(`${JSON.stringify({ t: 'f', name: item.name, size: st.size })}\n`));
      const h = crypto.createHash('sha256');
      let sent = 0;
      if (st.size > 0) {
        for await (const chunk of fs.createReadStream(item.file, { start: 0, end: st.size - 1 })) {
          sent += chunk.length;
          h.update(chunk);
          await put(chunk);
        }
      }
      if (sent !== st.size) throw new Error(`فایل وسطِ کار عوض شد: ${item.name} — دوباره بزنید.`);
      files.push({ name: item.name, size: st.size, sha256: h.digest('hex') });
    }
    manifest.files = files;
    manifest.bytes = files.reduce((a, f) => a + f.size, 0);
    const m = Buffer.from(JSON.stringify(manifest, null, 2));
    await put(Buffer.from(`${JSON.stringify({ t: 'manifest', size: m.length })}\n`));
    await put(m);
    gz.end();
    await done;
    await new Promise((r, j) => sink.end(cipher.getAuthTag(), (e) => (e ? j(e) : r())));
    await fsp.rename(tmp, out);
  } catch (e) {
    gz.destroy();
    await new Promise((r) => { if (sink.closed) r(); else { sink.once('close', r); sink.destroy(); } });
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
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
  //  ⛔ `pipeline` با نخستین خطا (رمزگشایی/gunzip) رد می‌شود ولی نوشتنِ ناهمگامِ همان دم (mkdir، ساختنِ فایل) ادامه
  //  داشت ⇒ پس از پاک شدنِ پوشهٔ موقت دوباره ساخته می‌شد و دادهٔ نیمه‌بازِ بستهٔ دست‌خورده در مقصد می‌ماند (۷ از ۴۰
  //  جای بیتِ دست‌خورده). حالا کارِ در جریان پیش از بازگشت تمام و بسته می‌شود و پس از شکست هیچ فایلی ساخته نمی‌شود.
  let inflight = Promise.resolve();
  let aborted = false;
  const realDest = dest ? path.resolve(dest) : null;

  const openFile = async (name, size) => {
    if (typeof name !== 'string' || !name.startsWith('data/') || name.includes('\0')) throw new Error(`نامِ نادرست در بسته: ${name}`);
    hash = crypto.createHash('sha256');
    if (!realDest) { out = null; return; }
    const target = path.resolve(realDest, name.slice('data/'.length));
    const rel = path.relative(realDest, target);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`مسیرِ بیرون از پوشه در بسته: ${name}`);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    if (aborted) throw new Error('بسته باز نشد (کار نیمه‌کاره بسته شد).');
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
    write(chunk, _e, cb) {
      inflight = (async () => {
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
      })();
      inflight.then(() => cb(), cb);
    },
  });

  const body = fs.createReadStream(file, { start: head.length, end: st.size - TAG_LEN - 1 });
  try {
    await pipeline(body, decipher, zlib.createGunzip(), parser);
  } catch (e) {
    aborted = true;
    await inflight.catch(() => {});
    if (out && !out.closed) await new Promise((r) => { out.once('close', r); out.destroy(); });
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
export function outsidePaths(dbFile, dataDir) {
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

/**
 * @param {string} [panelDbSnapshot] عکسِ سالمِ آماده (پنلِ روشن: ‎VACUUM INTO‎ از همان اتصالِ خودش) ⇒ جای رونوشت+VACUUM
 * @param {string} [accountSnapshot] رونوشتِ ‎<داده>/account-server‎ (بی ‎app/‎) که وقتی سرورِ حساب مکث کرده بود گرفته شد ⇒
 *        فایل‌های سرورِ حساب و تطبیقِ دیتابیسش از همین، نه از پوشهٔ زنده
 * @param {object} [live] برای مانیفست: از کجا و چطور گرفته شد (پنلِ روشن، مکثِ سرورِ حساب)
 */
export async function exportData({ dataDir, out, pass, include = {}, force = false, accountTool = '', panelDbSnapshot = '', accountSnapshot = '', live = null, only = '', sitesyncDir = '' }) {
  const src = path.resolve(dataDir);
  if (!fs.existsSync(path.join(src, 'panel.db'))) throw new Error(`این پوشهٔ دادهٔ پنل نیست (panel.db نیست): ${src}`);
  checkPassphrase(pass);
  const running = panelRunning(src);
  if (running && !force) {
    throw new Error(`پنل روشن است (پروسهٔ ${running}). اول ببندیدش (برنامهٔ ویندوز: خروج از کنارِ ساعت؛ لینوکس: systemctl stop vill3n-panel) — ` +
      'سرورِ حسابِ روشن کپیِ سالم نمی‌دهد. بعد از export دوباره بازش کنید؛ سرورِ خانه همان‌طور کار می‌کند.');
  }
  if (only) return exportOnly({ src, out, pass, only, running, accountTool, panelDbSnapshot, accountSnapshot, live, sitesyncDir });

  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'vill3n-move-'));
  try {
    //  ۱) عکسِ سالمِ دیتابیسِ پنل — از **رونوشت** (با WALش)، نه خودِ فایل: باز کردنِ
    //  خودِ دیتابیس، حتی فقط‌خواندنی، کنارش ‎-wal/-shm‎ می‌سازد یا WAL را در آن
    //  می‌ریزد؛ پوشهٔ مبدأ باید بایت‌به‌بایت همان بماند.
    let snap = panelDbSnapshot ? path.resolve(panelDbSnapshot) : path.join(work, 'panel.db');
    if (!panelDbSnapshot) {
      const copy = path.join(work, 'source.db');
      await fsp.copyFile(path.join(src, 'panel.db'), copy);
      if (fs.existsSync(path.join(src, 'panel.db-wal'))) await fsp.copyFile(path.join(src, 'panel.db-wal'), `${copy}-wal`);
      const conn = new DatabaseSync(copy);
      try { conn.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`); } finally { conn.close(); }
    }
    const panelTables = sqliteCounts(snap);

    //  ۲) فهرستِ فایل‌ها
    const items = [{ name: 'data/panel.db', file: snap }];
    const excluded = [];
    //  فایل‌های زندهٔ سرورِ حساب (جز کدِ ‎app/‎) وقتی رونوشتِ لحظهٔ مکث هست از همان رونوشت می‌آیند
    const fromSnapshot = (rel) => Boolean(accountSnapshot) && rel.startsWith('account-server/') && !rel.startsWith('account-server/app/');
    const take = (rel, file) => {
      const rule = EXCLUDES.find((x) => x.match(rel));
      if (rule && !(rule.opt && include[rule.opt])) { excluded.push(rel); return; }
      items.push({ name: `data/${rel}`, file });
    };
    for (const file of await walkFiles(src)) {
      const rel = toPosix(path.relative(src, file));
      if (!fromSnapshot(rel)) take(rel, file);
    }
    if (accountSnapshot) {
      for (const file of await walkFiles(path.resolve(accountSnapshot))) {
        const rel = `account-server/${toPosix(path.relative(path.resolve(accountSnapshot), file))}`;
        if (fromSnapshot(rel)) take(rel, file);
      }
    }

    //  ۳) تطبیقِ سرورِ حساب (اگر ابزارش هست) — sha256 ِ هر فایل هنگامِ نوشتنِ بسته (writeBundle)
    const tool = findAccountTool(src, accountTool);
    const account = inspectAccountDb(tool, path.join(accountSnapshot ? path.resolve(accountSnapshot) : path.join(src, 'account-server'), 'pg'));

    let panelVersion = null;
    try { panelVersion = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version; } catch { /* بی نسخه */ }
    const manifest = {
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      createdAt: new Date().toISOString(),
      source: { host: os.hostname(), platform: process.platform, dataDir: src, panelVersion },
      hot: Boolean(running),
      ...(live ? { live } : {}),
      include,
      files: [],
      bytes: 0,
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

/**
 * بسته را در `staging` (پوشهٔ موقتِ **داخلِ** مقصد) باز می‌کند و همه را می‌سنجد: هر فایل با sha256، هر جدولِ پنل با
 * شمارِ ردیف، سرورِ حساب با شمار/هش/جمعِ مبلغ؛ و نشانی‌های پوشهٔ داده در دیتابیسِ پنل را به `finalDir` برمی‌گرداند.
 * ⛔ هنوز هیچ چیزِ مقصد جابه‌جا نشده؛ یک اختلاف ⇒ `staging` پاک و خطا. (CLI و پنل هر دو همین را صدا می‌زنند.)
 */
export async function stageImport({ file, pass, staging, finalDir, accountTool = '' }) {
  try {
    const { manifest, files } = await readBundle(file, pass, staging);
    if (manifest.only) throw new Error(`این بستهٔ «فقط ${manifest.only}» است، نه کلِ سرور — با ‎import --only‎ وارد کنید؛ هیچ چیزی جابه‌جا نشد.`);
    //  ۱) هر فایل با sha256
    const bad = manifest.files.filter((f) => files.get(f.name)?.sha256 !== f.sha256 || files.get(f.name)?.size !== f.size);
    if (bad.length) throw new Error(`${bad.length} فایل با مانیفست نمی‌خواند: ${bad.slice(0, 5).map((f) => f.name).join('، ')}`);
    const extra = [...files.keys()].filter((n) => !manifest.files.some((f) => f.name === n));
    if (extra.length) throw new Error(`${extra.length} فایل در بسته هست که در مانیفست نیست: ${extra.slice(0, 5).join('، ')}`);
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
    const remapped = remapPanelDb(path.join(staging, 'panel.db'), manifest.source.dataDir, path.resolve(finalDir));
    return { manifest, files: files.size, remapped, account };
  } catch (e) {
    await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
}

/** ویندوز فایلی را که تازه بسته شده گاهی چند لحظه قفل نگه می‌دارد (ضدویروس، نمایه‌گر) */
function renameRetry(from, to) {
  for (let i = 0; ; i++) {
    try { fs.renameSync(from, to); return; } catch (e) {
      if (i >= 15 || !['EBUSY', 'EPERM', 'EACCES'].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
}

/**
 * جابه‌جاییِ نهایی — فقط rename: آن‌چه در مقصد بود ⇒ `‎.vmove-before-<stamp>‎` (کنار، **نه پاک**)، سپس محتوای
 * `staging` ⇒ مقصد. پوشه‌های ‎.vmove-*‎ (کنارگذاشته‌های پیشین، کارِ پنل) سرِ جایشان می‌مانند.
 * ⛔ شکستِ وسطِ راه ⇒ هر چه جابه‌جا شده بود برمی‌گردد و خطا. هم‌گام، تا پنل پیش از باز کردنِ دیتابیس صدایش بزند.
 */
export function promoteStaged({ staging, target, stamp, keep = [] }) {
  const root = path.resolve(target);
  const previousDir = path.join(root, `.vmove-before-${stamp}`);
  const stagingName = path.basename(path.resolve(staging));
  const existing = fs.readdirSync(root).filter((n) => !n.startsWith('.vmove-') && n !== stagingName);
  const moved = [];
  const placed = [];
  try {
    if (existing.length) {
      fs.mkdirSync(previousDir, { recursive: true });
      for (const name of existing) { renameRetry(path.join(root, name), path.join(previousDir, name)); moved.push(name); }
    }
    for (const name of fs.readdirSync(staging)) {
      if (keep.includes(name)) continue;
      renameRetry(path.join(staging, name), path.join(root, name));
      placed.push(name);
    }
  } catch (e) {
    for (const name of placed.reverse()) { try { fs.renameSync(path.join(root, name), path.join(staging, name)); } catch { /* بماند تا دستی */ } }
    for (const name of moved.reverse()) { try { fs.renameSync(path.join(previousDir, name), path.join(root, name)); } catch { /* بماند تا دستی */ } }
    try { fs.rmdirSync(previousDir); } catch { /* خالی نیست یا نیست */ }
    throw e;
  }
  return { previous: existing.length ? previousDir : null };
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
  const existing = fs.existsSync(target) ? fs.readdirSync(target).filter((n) => !n.startsWith('.vmove-importing-')) : [];
  if (existing.length && !force) {
    throw new Error(`پوشهٔ مقصد خالی نیست: ${target} — برای کنار گذاشتنش (نه پاک کردن) --force بدهید.`);
  }
  if (panelRunning(target)) throw new Error('پنلِ مقصد روشن است — اول خاموشش کنید.');
  await fsp.mkdir(target, { recursive: true });

  let promoted = false;
  try {
    const r = await stageImport({ file, pass, staging, finalDir: target, accountTool });
    //  ۵) فقط حالا جابه‌جا — آن‌چه در مقصد بود کنار می‌رود، پاک نمی‌شود
    const { previous } = promoteStaged({ staging, target, stamp });
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
    return { target, previous, manifest: r.manifest, files: r.files, remapped: r.remapped, account: r.account, envFile };
  } finally {
    if (!promoted) await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

function sha256FileSync(file) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.allocUnsafe(1 << 20);
    for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) h.update(buf.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return h.digest('hex');
}

/**
 * پوشهٔ داده هنوز همان مانیفست است؟ (هر فایل با sha256 — جز panel.db که نشانی‌هایش عوض شده و جدول‌هایش
 * با شمارِ ردیف سنجیده می‌شود؛ و سرورِ حساب با ابزارِ خودش اگر `checkAccount`). هم‌گام: پنل پس از جابه‌جاییِ
 * هنگامِ بالا آمدن، پیش از روشن شدنِ هر چیزی که در پوشه می‌نویسد، همین را می‌زند.
 */
export function compareManifest({ manifest, dataDir, accountTool = '', checkAccount = true }) {
  const root = path.resolve(dataDir);
  const diffs = [];
  for (const f of manifest.files) {
    if (f.name === 'data/panel.db') continue; //  پس از import نشانی‌ها عوض می‌شوند؛ جدول‌ها پایین سنجیده می‌شوند
    const p = path.join(root, ...f.name.slice(5).split('/'));
    if (!fs.existsSync(p)) { diffs.push(`نیست: ${f.name}`); continue; }
    if (sha256FileSync(p) !== f.sha256) diffs.push(`عوض شده: ${f.name}`);
  }
  const counts = sqliteCounts(path.join(root, 'panel.db'));
  for (const t of Object.keys(manifest.panelDb.tables)) {
    if ((counts[t] ?? -1) < manifest.panelDb.tables[t]) diffs.push(`جدولِ ${t}: ${manifest.panelDb.tables[t]} ⇐ ${counts[t] ?? 'نیست'}`);
  }
  if (checkAccount && manifest.account?.reconciled) {
    const now = inspectAccountDb(findAccountTool(root, accountTool), path.join(root, 'account-server', 'pg'));
    const account = now.ok ? sameAccountReport(manifest.account.report, now.report) : { same: false, diffs: [now.reason] };
    if (!account.same) diffs.push(...account.diffs.map((d) => `سرورِ حساب: ${d}`));
  }
  return { same: diffs.length === 0, diffs, files: manifest.files.length };
}

/** پس از import (یا هر وقت): پوشهٔ داده هنوز همان بسته است؟ */
export async function compareData({ file, dataDir, pass, accountTool = '' }) {
  const { manifest } = await readBundle(file, pass, null);
  if (manifest.only) throw coded('only_bundle', `بستهٔ «فقط ${manifest.only}» را ‎import --only‎ خودش پس از جای‌نشستن با sha256 می‌سنجد.`);
  return compareManifest({ manifest, dataDir, accountTool });
}

/* ───────────── پنل: «بازگرداندن از فایلِ جابه‌جایی» هنگامِ بالا آمدن ───────────── */

export const READY_PREFIX = '.vmove-ready-';
export const READY_MARK = '.vmove-ready.json';
export const LAST_IMPORT = '.vmove-last-import.json';

/** خلاصهٔ بی‌راز و بی‌نامِ فایل — برای رابط و دفتر */
export function manifestSummary(m) {
  return {
    createdAt: m.createdAt,
    only: m.only || null,
    source: { host: m.source?.host || null, platform: m.source?.platform || null, panelVersion: m.source?.panelVersion || null },
    files: m.files?.length || 0,
    bytes: m.bytes || 0,
    tables: Object.keys(m.panelDb?.tables || {}).length,
    rows: Object.values(m.panelDb?.tables || {}).reduce((a, n) => a + Number(n || 0), 0),
    account: m.account?.reconciled ? { reconciled: true, tables: Object.keys(m.account.report?.tables || {}).length } : { reconciled: false, reason: m.account?.reason || null },
    outside: (m.outside || []).map((o) => o.path),
    excluded: (m.excluded || []).length,
  };
}

/**
 * پنل این را **پیش از باز کردنِ دیتابیس** صدا می‌زند (src/db.js). اگر بستهٔ سنجیده‌شده‌ای منتظر است
 * (‎.vmove-ready-<stamp>/‎ با نشانه‌اش، که پنل فقط پس از سنجشِ کامل می‌سازد): دادهٔ فعلی کنار، بسته جای داده،
 * و همان دم دوباره با مانیفست مقایسه (پیش از آن‌که سرورِ حساب یا سایتی روشن شود و فایلی بنویسد).
 * نتیجه در ‎.vmove-last-import.json‎. شکست ⇒ همه سرِ جایش برمی‌گردد و پوشهٔ بسته ‎.vmove-failed-‎ می‌شود (پاک نه).
 */
export function applyPendingMove(dataDir) {
  const root = path.resolve(dataDir);
  let names;
  try { names = fs.readdirSync(root); } catch { return null; }
  const ready = names.filter((n) => n.startsWith(READY_PREFIX)).sort();
  if (!ready.length) return null;
  const dir = path.join(root, ready[ready.length - 1]);
  const write = (obj) => { try { fs.writeFileSync(path.join(root, LAST_IMPORT), JSON.stringify(obj, null, 2), { mode: 0o600 }); } catch { /* بی‌خیال */ } };
  let mark = null;
  try { mark = JSON.parse(fs.readFileSync(path.join(dir, READY_MARK), 'utf8')); } catch { /* نشانه نیست */ }
  const stamp = String(mark?.stamp || ready[ready.length - 1].slice(READY_PREFIX.length)).replace(/[^\w.-]/g, '');
  if (!mark?.manifest) {
    try { fs.renameSync(dir, path.join(root, `.vmove-failed-${stamp}`)); } catch { /* بماند */ }
    write({ at: new Date().toISOString(), stamp, ok: false, error: 'نشانهٔ بستهٔ سنجیده‌شده نبود — چیزی جابه‌جا نشد.' });
    return { ok: false };
  }
  try {
    const { previous } = promoteStaged({ staging: dir, target: root, stamp, keep: [READY_MARK] });
    fs.rmSync(dir, { recursive: true, force: true });
    const compare = compareManifest({ manifest: mark.manifest, dataDir: root, checkAccount: false });
    const result = {
      at: new Date().toISOString(), stamp, ok: true, previous, by: mark.by || null, mode: mark.mode || null,
      summary: manifestSummary(mark.manifest), account: mark.account || null, remapped: mark.remapped ?? null,
      compare: { same: compare.same, diffs: compare.diffs.slice(0, 50), files: compare.files },
    };
    write(result);
    return result;
  } catch (e) {
    try { fs.renameSync(dir, path.join(root, `.vmove-failed-${stamp}`)); } catch { /* بماند */ }
    write({ at: new Date().toISOString(), stamp, ok: false, error: `جابه‌جایی انجام نشد و دادهٔ قبلی سرِ جایش ماند: ${e.code || e.message}` });
    return { ok: false, error: e.message };
  }
}

/* ───────────────── «فقط یک برنامه»: ‎--only <app>‎ (۱.۵۰.۹۵) ─────────────────
 *
 *  همان قالبِ ‎.vmove‎، همان رمز (AES-256-GCM)، همان sha256 ِ هر فایل — فقط پوشه‌های **همان یک** برنامه:
 *    site:<نامک>     ریشهٔ سایت (‎data/site-root/‎)، فضای کاری (‎data/sites/<نامک>/‎) و دفترِ سرورِ سایت
 *                    (‎data/site-sync/sites/<نامک>/‎)؛ ردیفِ سایت و دامنه‌هایش در مانیفست (‎app‎).
 *    account-server  کلِ ‎<داده>/account-server/‎ — سرورِ حساب همیشه کامل (همهٔ دکان‌ها یک دفتر)، با تطبیقِ move-db.js.
 *    stations        ‎<داده>/stations/‎ — ⛔ فقط با پنلِ بسته: پمپ‌ها داخلِ پروسهٔ پنل‌اند و راهِ ایستاندنِ جدا ندارند؛
 *                    کدِ پمپ دست نمی‌خورد.
 *  شمارِ ردیفِ هر جدولِ هر دیتابیسِ SQLite ِ داخلِ همین پوشه‌ها در مانیفست (`sqlite`)، از **رونوشت** (فایلِ اصلی
 *  بایت‌به‌بایت همان می‌ماند)، و پس از باز شدن دوباره شمرده می‌شود.
 *  ⛔ import ِ ‎--only‎ فقط همین پوشه‌ها را جابه‌جا می‌کند. هم‌نامِ پیشینِ مقصد ⇒ ‎<داده>/.vmove-aside/<زمان>-…/‎ (پاک نه)؛
 *     هیچ فایل یا ردیفِ دیگری از مقصد (سایت‌های دیگر، پنل، سرورِ حساب) دست نمی‌خورد. بستهٔ کامل با ‎--only‎ و برعکس رد.
 */

const SLUG_RE = /^[a-z0-9؀-ۿ_-]{1,64}$/;
export const ASIDE_DIR = '.vmove-aside';
const SQLITE_HEAD = Buffer.from('SQLite format 3\0');

/** ‎site:<نامک>‎ (یا خودِ نامک) · ‎account-server‎ · ‎stations‎ ⇒ ‎{ kind, id, slug? }‎ */
export function parseOnly(spec) {
  const s = String(spec ?? '').trim();
  if (s === 'account-server' || s === 'account') return { kind: 'account', id: 'account-server' };
  if (s === 'stations' || s === 'pumps' || s === 'pump') return { kind: 'stations', id: 'stations' };
  const slug = s.startsWith('site:') ? s.slice(5) : s;
  if (!SLUG_RE.test(slug)) throw new Error(`برنامهٔ ناشناخته برای ‎--only‎: «${s.slice(0, 80)}» (site:<نامکِ سایت>، account-server یا stations)`);
  return { kind: 'site', id: `site:${slug}`, slug };
}

const onlyPrefixes = (only) => (only.kind === 'site'
  ? ['data/site-root/', `data/sites/${only.slug}/`, `data/site-sync/sites/${only.slug}/`]
  : [only.kind === 'account' ? 'data/account-server/' : 'data/stations/']);

const coded = (code, message) => Object.assign(new Error(message), { code });

function isSqliteFile(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(16);
    return fs.readSync(fd, b, 0, 16, 0) === 16 && b.equals(SQLITE_HEAD);
  } catch { return false; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

/** شمارِ ردیفِ هر جدول از **رونوشت** (با ‎-wal‎ ِ کنارش) — فایلِ اصلی و پوشه‌اش هیچ ‎-shm‎ ِ تازه‌ای نمی‌گیرند */
function countSqliteCopy(file, work) {
  const dir = fs.mkdtempSync(path.join(work, 'sq-'));
  try {
    const copy = path.join(dir, 'x.db');
    fs.copyFileSync(file, copy);
    if (fs.existsSync(`${file}-wal`)) fs.copyFileSync(`${file}-wal`, `${copy}-wal`);
    const db = new DatabaseSync(copy);
    try {
      const out = {};
      for (const { name } of db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all()) {
        out[name] = Number(db.prepare(`SELECT COUNT(*) AS n FROM "${String(name).replace(/"/g, '""')}"`).get().n);
      }
      return out;
    } finally { db.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** ردیفِ سایت، دامنه‌هایش و «سایتِ اصلی است؟» از عکسِ دیتابیسِ پنل */
function readSiteRow(dbFile, slug) {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    const row = db.prepare('SELECT * FROM sites WHERE slug = ?').get(slug);
    if (!row) return null;
    const domains = db.prepare('SELECT name FROM domains WHERE site_id = ? ORDER BY name').all(row.id).map((d) => d.name);
    let main = null;
    try { main = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'main_site_id'").get()?.value ?? 'null'); } catch { main = null; }
    return { row, domains, isMain: main != null && Number(main) === Number(row.id) };
  } finally { db.close(); }
}

const isWithin = (parent, child) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

async function exportOnly({ src, out, pass, only: spec, running, accountTool, panelDbSnapshot, accountSnapshot, live, sitesyncDir }) {
  const only = parseOnly(spec);
  if (only.kind === 'stations' && (live || running)) {
    throw coded('pump_cli_only', 'پمپ‌ها (تانک‌تیل) فقط با پنلِ بسته جابه‌جا می‌شوند: داخلِ پروسهٔ پنل‌اند و راهِ ایستاندنِ جدا ندارند '
      + '(کدِ پمپ دست نمی‌خورد). پنل را ببندید و همین فرمان را از خطِ فرمان بزنید.');
  }
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'vill3n-move-'));
  try {
    const items = [];
    const excluded = [];
    const addDir = async (dir, prefix, skip = () => false) => {
      for (const file of await walkFiles(dir)) {
        const rel = toPosix(path.relative(dir, file));
        if (skip(rel)) continue;
        if (rel.endsWith('.part')) { excluded.push(`${prefix.slice(5)}${rel}`); continue; } //  نوشتنِ نیمه‌کاره
        items.push({ name: `${prefix}${rel}`, file });
      }
    };
    let app;
    let account = { ok: false, reason: 'سرورِ حساب جزوِ این بسته نیست.' };
    if (only.kind === 'site') {
      let snap = panelDbSnapshot ? path.resolve(panelDbSnapshot) : '';
      if (!snap) {
        //  همان راهِ بستهٔ کامل: رونوشت (با WAL) ⇒ ‎VACUUM INTO‎؛ خودِ دیتابیس باز نمی‌شود
        snap = path.join(work, 'panel.db');
        const copy = path.join(work, 'source.db');
        await fsp.copyFile(path.join(src, 'panel.db'), copy);
        if (fs.existsSync(path.join(src, 'panel.db-wal'))) await fsp.copyFile(path.join(src, 'panel.db-wal'), `${copy}-wal`);
        const conn = new DatabaseSync(copy);
        try { conn.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`); } finally { conn.close(); }
      }
      const s = readSiteRow(snap, only.slug);
      if (!s) throw coded('site_not_found', `سایتِ «${only.slug}» در این پنل نیست.`);
      if (s.isMain) throw coded('main_site', 'سایتِ اصلی دفترِ اصلیِ سرورِ سایت (‎site-sync/‎) را دارد و جدا نمی‌رود — با «جابه‌جاییِ کامل» ببرید.');
      if (s.row.kind === 'external') throw coded('external_site', 'این سایت روی این کامپیوتر نیست (بیرونی) — چیزی برای بردن ندارد.');
      const root = path.resolve(String(s.row.root_path || ''));
      if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw coded('path_missing', `پوشهٔ سایت پیدا نشد: ${root}`);
      if (isWithin(root, src)) throw coded('bad_root', 'پوشهٔ این سایت پوشهٔ دادهٔ پنل را در بر دارد — یک سایت جدا نمی‌رود.');
      const syncDir = path.resolve(sitesyncDir || path.join(src, 'site-sync'));
      await addDir(root, 'data/site-root/');
      await addDir(path.join(src, 'sites', only.slug), `data/sites/${only.slug}/`);
      await addDir(path.join(syncDir, 'sites', only.slug), `data/site-sync/sites/${only.slug}/`);
      app = {
        type: 'site', slug: only.slug, name: s.row.name, kind: s.row.kind || 'static', port: s.row.port ?? null,
        startCommand: s.row.start_command ?? null, autostart: Boolean(s.row.autostart), enabled: Boolean(s.row.enabled),
        domain: s.row.domain || null, domains: s.domains, rootName: path.basename(root), rootPath: root,
      };
    } else if (only.kind === 'account') {
      const acctDir = path.join(src, 'account-server');
      if (!fs.existsSync(acctDir) && !accountSnapshot) throw coded('account_missing', 'سرورِ حساب در این پوشهٔ داده نیست (account-server/).');
      if (accountSnapshot) {
        //  پنلِ روشن: فایل‌های زنده از رونوشتِ لحظهٔ مکث، کدِ ‎app/‎ از خودِ پوشه (همان قاعدهٔ بستهٔ کامل)
        await addDir(path.resolve(accountSnapshot), 'data/account-server/', (rel) => rel === 'app' || rel.startsWith('app/'));
        await addDir(path.join(acctDir, 'app'), 'data/account-server/app/');
      } else {
        await addDir(acctDir, 'data/account-server/');
      }
      account = inspectAccountDb(findAccountTool(src, accountTool), path.join(accountSnapshot ? path.resolve(accountSnapshot) : acctDir, 'pg'));
      app = { type: 'account' };
    } else {
      const stDir = path.join(src, 'stations');
      if (!fs.existsSync(stDir)) throw coded('stations_missing', 'پوشهٔ پمپ‌ها (stations/) در این پوشهٔ داده نیست.');
      await addDir(stDir, 'data/stations/');
      app = { type: 'stations' };
    }
    if (!items.length) throw coded('empty_app', 'برای این برنامه هیچ فایلی پیدا نشد.');

    const sqlite = {};
    for (const it of items) {
      if (/-(wal|shm|journal)$/.test(it.name) || !isSqliteFile(it.file)) continue;
      try { sqlite[it.name] = countSqliteCopy(it.file, work); } catch { /* دیتابیسِ خراب: فقط sha256 */ }
    }

    let panelVersion = null;
    try { panelVersion = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version; } catch { /* بی نسخه */ }
    const manifest = {
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      createdAt: new Date().toISOString(),
      source: { host: os.hostname(), platform: process.platform, dataDir: src, panelVersion },
      hot: Boolean(running),
      ...(live ? { live } : {}),
      only: only.id,
      app,
      include: {},
      files: [],
      bytes: 0,
      panelDb: null,
      sqlite,
      account: account.ok ? { reconciled: true, report: account.report } : { reconciled: false, reason: account.reason },
      excluded,
      outside: [],
    };
    await writeBundle(path.resolve(out), items, manifest, pass);
    return { out: path.resolve(out), manifest };
  } finally {
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * بستهٔ ‎--only‎ را در `staging` باز و **همه** را می‌سنجد: sha256 و اندازهٔ هر فایل، نبودنِ فایلِ بیرون از همان برنامه،
 * شمارِ ردیفِ هر دیتابیسِ SQLite، و برای سرورِ حساب شمار/هش/جمعِ مبلغ (move-db.js). ⛔ هنوز هیچ چیزِ مقصد جابه‌جا نشده؛
 * یک اختلاف ⇒ `staging` پاک و خطا. (CLI و «سرورهای من» هر دو همین را صدا می‌زنند.)
 */
export async function stageOnlyImport({ file, pass, staging, accountTool = '', expect = '' }) {
  try {
    const { manifest, files } = await readBundle(file, pass, staging);
    if (!manifest.only) throw coded('full_bundle', 'این بستهٔ کامل (کلِ سرور) است، نه یک برنامه — بی ‎--only‎ وارد کنید؛ هیچ چیزی جابه‌جا نشد.');
    const only = parseOnly(manifest.only);
    if (expect && parseOnly(expect).id !== only.id) throw coded('wrong_app', `این بستهٔ «${only.id}» است، نه «${parseOnly(expect).id}».`);
    const bad = manifest.files.filter((f) => files.get(f.name)?.sha256 !== f.sha256 || files.get(f.name)?.size !== f.size);
    if (bad.length) throw coded('bad_files', `${bad.length} فایل با مانیفست نمی‌خواند: ${bad.slice(0, 5).map((f) => f.name).join('، ')}`);
    const extra = [...files.keys()].filter((n) => !manifest.files.some((f) => f.name === n));
    if (extra.length) throw coded('extra_files', `${extra.length} فایل در بسته هست که در مانیفست نیست: ${extra.slice(0, 5).join('، ')}`);
    const prefixes = onlyPrefixes(only);
    const outside = manifest.files.filter((f) => !prefixes.some((p) => f.name.startsWith(p)));
    if (outside.length) throw coded('outside_app', `بسته فایلی بیرون از «${only.id}» دارد: ${outside.slice(0, 5).map((f) => f.name).join('، ')}`);
    if (only.kind === 'site' && (manifest.app?.type !== 'site' || manifest.app.slug !== only.slug)) throw coded('bad_manifest', 'مانیفستِ سایت ناقص است.');

    const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'vill3n-move-'));
    try {
      for (const [name, want] of Object.entries(manifest.sqlite || {})) {
        const p = path.join(staging, ...name.slice('data/'.length).split('/'));
        const got = countSqliteCopy(p, work);
        const diff = Object.keys({ ...want, ...got }).filter((t) => want[t] !== got[t]);
        if (diff.length) throw coded('row_counts', `شمارِ ردیفِ ${name.slice(5)} نمی‌خواند: ${diff.join('، ')}`);
      }
    } finally {
      await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
    }

    let account = { reconciled: false, reason: manifest.account?.reason || 'در بسته گزارشی نبود' };
    if (only.kind === 'account' && manifest.account?.reconciled) {
      const now = inspectAccountDb(findAccountTool(staging, accountTool), path.join(staging, 'account-server', 'pg'));
      if (!now.ok) {
        account = { reconciled: false, reason: now.reason };
      } else {
        const cmp = sameAccountReport(manifest.account.report, now.report);
        if (!cmp.same) throw coded('account_mismatch', `دیتابیسِ سرورِ حساب پس از باز شدن با مبدأ نمی‌خواند: ${cmp.diffs.slice(0, 5).join(' · ')}`);
        account = { reconciled: true, tables: Object.keys(now.report.tables || {}).length, totals: now.report.totals || null };
      }
    }
    return { manifest, only, files: files.size, account, sqlite: Object.keys(manifest.sqlite || {}).length };
  } catch (e) {
    await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
}

/** نامِ امنِ یک تکهٔ مسیر (برای پوشهٔ تازهٔ سایت) */
const safeSegment = (s) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/^[.\s-]+|[.\s]+$/g, '').slice(0, 80);

/**
 * جای دادنِ بستهٔ سنجیده‌شده — هم‌گام، فقط rename (روی دیسکِ دیگر: رونوشت):
 *   • هم‌نامِ پیشینِ مقصد (همان سایت/سرورِ حساب/پمپ‌ها) ⇒ ‎<داده>/.vmove-aside/<stamp>-<برنامه>/‎ + ‎aside.json‎ (پاک نه)
 *   • سایت: پوشهٔ تازه زیرِ `sitesRoot` (نامِ آزاد؛ هرگز روی پوشهٔ موجود)، ردیف و دامنه‌ها در **همان تراکنش** با `db`
 *     (اتصالِ خودِ پنل یا DatabaseSync ِ CLI). `enabled=false` ⇒ ثبت می‌شود ولی خاموش و بی «اجرای خودکار» (سرورهای من).
 * ⛔ شکستِ وسطِ راه ⇒ ROLLBACK و همهٔ جابه‌جایی‌ها برمی‌گردند؛ مقصد همان است که بود.
 * `replace`: ‎'refuse'‎ (سایتِ هم‌نامِ فعالِ مقصد ⇒ رد) یا ‎'aside'‎ (کنار گذاشتنش).
 */
export function promoteOnly({ staging, manifest, dataDir, stamp, db = null, sitesRoot = '', sitesyncDir = '', port = null, enabled = null, replace = 'refuse' }) {
  const only = parseOnly(manifest.only);
  const root = path.resolve(dataDir);
  const syncDir = path.resolve(sitesyncDir || path.join(root, 'site-sync'));
  const asideBase = path.join(root, ASIDE_DIR, `${stamp}-${only.id.replace(/[^A-Za-z0-9؀-ۿ_-]+/g, '-')}`);
  const undo = [];
  const aside = [];
  const putAside = (from, what) => {
    if (!fs.existsSync(from)) return;
    fs.mkdirSync(asideBase, { recursive: true });
    let to = path.join(asideBase, what);
    try {
      renameRetry(from, to);
    } catch (e) {
      if (e.code !== 'EXDEV') throw e;
      to = `${from}.vmove-aside-${stamp}`; //  دیسکِ دیگر: کنارِ خودش، همان دیسک
      renameRetry(from, to);
    }
    undo.push({ kind: 'rename', from, to });
    aside.push({ what, from, to });
  };
  const place = (from, to) => {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    try {
      renameRetry(from, to);
      undo.push({ kind: 'rename', from, to });
    } catch (e) {
      if (e.code !== 'EXDEV') throw e;
      fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
      undo.push({ kind: 'copy', to });
    }
  };
  const rollback = () => {
    for (const u of undo.reverse()) {
      try {
        if (u.kind === 'rename') renameRetry(u.to, u.from);
        else fs.rmSync(u.to, { recursive: true, force: true }); //  فقط رونوشتی که همین حالا از بسته ساخته شد
      } catch { /* بماند تا دستی */ }
    }
  };
  const writeAsideNote = (extra) => {
    if (!aside.length) return;
    try {
      fs.writeFileSync(path.join(asideBase, 'aside.json'), JSON.stringify({ at: new Date().toISOString(), app: only.id, reason: 'import', items: aside, ...extra }, null, 2), { mode: 0o600 });
    } catch { /* یادداشت است، نه داده */ }
  };

  if (only.kind !== 'site') {
    const sub = only.kind === 'account' ? 'account-server' : 'stations';
    if (!fs.existsSync(path.join(staging, sub))) throw coded('bad_manifest', `پوشهٔ ${sub} در بسته نیست.`);
    try {
      putAside(path.join(root, sub), sub);
      place(path.join(staging, sub), path.join(root, sub));
      writeAsideNote({});
    } catch (e) { rollback(); throw e; }
    return { kind: only.kind, id: only.id, aside, asideDir: aside.length ? asideBase : null };
  }

  if (!db) throw coded('no_db', 'برای جای دادنِ سایت دیتابیسِ پنلِ مقصد لازم است.');
  const app = manifest.app;
  const slug = only.slug;
  const sRoot = path.resolve(sitesRoot || path.join(root, 'websites'));
  const markedAside = (s) => { try { return Boolean(db.prepare('SELECT 1 FROM fleet_aside WHERE app_id = ? AND restored_at IS NULL').get(`site:${s}`)); } catch { return false; } };
  const existing = db.prepare('SELECT * FROM sites WHERE slug = ?').get(slug) || null;
  if (existing && replace !== 'aside' && !markedAside(slug)) {
    throw coded('slug_taken', `سایتی با نامکِ «${slug}» از پیش روی این سرور هست — برای کنار گذاشتنش (نه پاک کردن) ‎--force‎ بدهید؛ هیچ چیزی جابه‌جا نشد.`);
  }
  const domainNames = [...new Set((app.domains || []).map((d) => String(typeof d === 'string' ? d : d?.name || '').toLowerCase()).filter(Boolean))];
  for (const name of domainNames) {
    const d = db.prepare('SELECT site_id FROM domains WHERE name = ?').get(name);
    if (!d || d.site_id == null || d.site_id === existing?.id) continue;
    const owner = db.prepare('SELECT slug FROM sites WHERE id = ?').get(d.site_id);
    if (owner && !markedAside(owner.slug)) throw coded('domain_taken', `دامنهٔ ${name} روی این سرور مالِ سایتِ «${owner.slug}» است؛ هیچ چیزی جابه‌جا نشد.`);
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    if (existing?.root_path && fs.existsSync(existing.root_path)) putAside(existing.root_path, 'root');
    putAside(path.join(root, 'sites', slug), 'workspace');
    putAside(path.join(syncDir, 'sites', slug), 'store');
    const base = safeSegment(app.rootName) || slug;
    let target = null;
    for (let i = 1; i <= 50 && !target; i++) {
      const cand = path.join(sRoot, i === 1 ? base : `${base}-${i}`);
      if (!fs.existsSync(cand) && !db.prepare('SELECT 1 FROM sites WHERE root_path = ? AND slug <> ?').get(cand, slug)) target = cand;
    }
    if (!target) throw coded('no_root_name', 'نامِ آزادی برای پوشهٔ سایت پیدا نشد.');
    if (fs.existsSync(path.join(staging, 'site-root'))) place(path.join(staging, 'site-root'), target);
    else { fs.mkdirSync(target, { recursive: true }); undo.push({ kind: 'copy', to: target }); }
    if (fs.existsSync(path.join(staging, 'sites', slug))) place(path.join(staging, 'sites', slug), path.join(root, 'sites', slug));
    if (fs.existsSync(path.join(staging, 'site-sync', 'sites', slug))) place(path.join(staging, 'site-sync', 'sites', slug), path.join(syncDir, 'sites', slug));

    const on = enabled == null ? (app.enabled ? 1 : 0) : (enabled ? 1 : 0);
    const auto = on && app.autostart ? 1 : 0;
    const finalPort = port ?? app.port ?? null;
    const t = Date.now();
    let siteId;
    if (existing) {
      db.prepare(`UPDATE sites SET name = ?, root_path = ?, domain = ?, port = ?, kind = ?, start_command = ?, autostart = ?, enabled = ?, updated_at = ? WHERE id = ?`)
        .run(String(app.name || slug), target, app.domain || null, finalPort, app.kind || 'static', app.startCommand ?? null, auto, on, t, existing.id);
      siteId = existing.id;
    } else {
      siteId = Number(db.prepare(`INSERT INTO sites(slug, name, root_path, domain, port, kind, start_command, autostart, enabled, created_at, updated_at)
                                 VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(slug, String(app.name || slug), target, app.domain || null, finalPort, app.kind || 'static', app.startCommand ?? null, auto, on, t, t).lastInsertRowid);
    }
    for (const name of domainNames) {
      const has = db.prepare('SELECT id FROM domains WHERE name = ?').get(name);
      if (has) db.prepare('UPDATE domains SET site_id = ? WHERE id = ?').run(siteId, has.id);
      else db.prepare('INSERT INTO domains(name, site_id, created_at) VALUES(?, ?, ?)').run(name, siteId, t);
    }
    db.exec('COMMIT');
    writeAsideNote({ previousRow: existing || null });
    return {
      kind: 'site', id: only.id, slug, siteId, rootPath: target, port: finalPort, domains: domainNames,
      original: { enabled: app.enabled ? 1 : 0, autostart: app.autostart ? 1 : 0 },
      previousRow: existing || null,
      aside, asideDir: aside.length ? asideBase : null,
    };
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* بسته */ }
    rollback();
    throw e;
  }
}

/** پس از جای‌نشستن: هر فایل همان sha256 ِ مانیفست است؟ (پیش از روشن شدنِ برنامه) */
export function compareOnly({ manifest, placed, dataDir, sitesyncDir = '' }) {
  const only = parseOnly(manifest.only);
  const root = path.resolve(dataDir);
  const syncDir = path.resolve(sitesyncDir || path.join(root, 'site-sync'));
  const map = only.kind === 'site'
    ? [['data/site-root/', placed.rootPath], [`data/sites/${only.slug}/`, path.join(root, 'sites', only.slug)], [`data/site-sync/sites/${only.slug}/`, path.join(syncDir, 'sites', only.slug)]]
    : [[onlyPrefixes(only)[0], path.join(root, only.kind === 'account' ? 'account-server' : 'stations')]];
  const diffs = [];
  for (const f of manifest.files) {
    const hit = map.find(([p]) => f.name.startsWith(p));
    if (!hit) { diffs.push(`بیرون: ${f.name}`); continue; }
    const p = path.join(hit[1], ...f.name.slice(hit[0].length).split('/'));
    if (!fs.existsSync(p)) { diffs.push(`نیست: ${f.name}`); continue; }
    if (sha256FileSync(p) !== f.sha256) diffs.push(`عوض شده: ${f.name}`);
  }
  return { same: diffs.length === 0, diffs, files: manifest.files.length };
}

/** پورتِ آزاد از روی ردیف‌های همین دیتابیس (CLI با پنلِ بسته؛ پنل خودش `allocatePort` دارد) */
function freePortFromRows(db, preferred, slug) {
  const used = new Set(db.prepare('SELECT port FROM sites WHERE port IS NOT NULL AND slug <> ?').all(slug).map((r) => Number(r.port)));
  if (preferred && !used.has(Number(preferred))) return Number(preferred);
  for (let p = 8100; p <= 8999; p++) if (!used.has(p)) return p;
  return null;
}

/** CLI: ‎import <فایل> --data <پوشه> --only‎ — پنلِ مقصد بسته، پوشه‌اش یک نصبِ راه‌افتاده */
export async function importOnly({ file, dataDir, pass, accountTool = '', sitesRoot = '', force = false, expect = '' }) {
  const target = path.resolve(dataDir);
  if (!fs.existsSync(path.join(target, 'panel.db'))) {
    throw coded('not_installed', `پوشهٔ مقصد پنلِ راه‌افتاده نیست (panel.db نیست): ${target} — برای یک برنامه، پنلِ مقصد یک بار بالا آمده باشد؛ برای کلِ سرور بی ‎--only‎.`);
  }
  if (panelRunning(target)) throw coded('panel_running', 'پنلِ مقصد روشن است — اول خاموشش کنید، یا از «سرورهای من» ِ مرکز جابه‌جا کنید.');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const staging = path.join(target, `.vmove-importing-${stamp}`);
  let db = null;
  try {
    const r = await stageOnlyImport({ file, pass, staging, accountTool, expect });
    let placed;
    if (r.only.kind === 'site') {
      db = new DatabaseSync(path.join(target, 'panel.db'));
      db.exec('PRAGMA busy_timeout = 5000');
      db.exec('PRAGMA foreign_keys = ON');
      let sRoot = sitesRoot;
      if (!sRoot) { try { sRoot = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'sites_root'").get()?.value ?? 'null') || ''; } catch { sRoot = ''; } }
      placed = promoteOnly({
        staging, manifest: r.manifest, dataDir: target, stamp, db, sitesRoot: typeof sRoot === 'string' && sRoot ? sRoot : path.join(target, 'websites'),
        port: freePortFromRows(db, r.manifest.app.port, r.manifest.app.slug), replace: force ? 'aside' : 'refuse',
      });
    } else {
      placed = promoteOnly({ staging, manifest: r.manifest, dataDir: target, stamp });
    }
    const after = compareOnly({ manifest: r.manifest, placed, dataDir: target });
    return { target, manifest: r.manifest, only: r.only, files: r.files, account: r.account, sqlite: r.sqlite, placed, after };
  } finally {
    db?.close();
    await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
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

  فقط یک برنامه (پنلِ هر دو طرف بسته؛ همان قالب و رمز):
  export  --data <پوشهٔ داده> --out <فایل.vmove> --only <site:نامک | account-server | stations>
  import  <فایل.vmove> --data <پوشهٔ دادهٔ مقصد> --only [همان] [--sites-root <ریشهٔ سایت‌ها>] [--force]

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
    if (args.only === true) { console.error('‎--only‎ نامِ برنامه می‌خواهد: site:<نامک>، account-server یا stations'); return 2; }
    if (args.only) parseOnly(args.only); //  نامِ نادرست پیش از پرسیدنِ رمز
    const pass = await askPassphrase('رمزِ بسته (دستِ‌کم ۱۲ نویسه — به مقصد هم لازم است): ');
    if (args.only) {
      const r = await exportData({ dataDir: args.data, out: args.out, pass, force: !!args.force, accountTool, only: args.only });
      const m = r.manifest;
      console.log(`✅ بستهٔ «فقط ${m.only}» ساخته شد: ${r.out}`);
      console.log(`   ${m.files.length} فایل · ${fmtBytes(m.bytes)} · ${Object.keys(m.sqlite || {}).length} دیتابیسِ SQLite شمرده شد · رمزشده (AES-256-GCM)`);
      if (m.app?.type === 'site') console.log(`   سایت «${m.app.name}» · دامنه‌ها: ${(m.app.domains || []).join('، ') || '—'}`);
      if (m.only === 'account-server') {
        console.log(m.account.reconciled ? `   سرورِ حساب: ${Object.keys(m.account.report.tables || {}).length} جدول شمرده و هش شد` : `   ⚠️ سرورِ حساب: ${m.account.reason}`);
      }
      console.log('   پوشهٔ مبدأ دست نخورد. پس از import، برنامه را روی مبدأ روشن نکنید (دو دفتر).');
      return 0;
    }
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
    console.log(`${r.ok ? '✅' : '❌'} ${file}${m.only ? ` — فقط «${m.only}»` : ''}`);
    console.log(`   از ${m.source.host} (${m.source.platform}) · ${m.createdAt} · پنل ${m.source.panelVersion || '؟'}`);
    console.log(m.only
      ? `   ${m.files.length} فایل · ${fmtBytes(m.bytes)} · ${Object.keys(m.sqlite || {}).length} دیتابیسِ SQLite`
      : `   ${m.files.length} فایل · ${fmtBytes(m.bytes)} · جدول‌های پنل: ${Object.entries(m.panelDb.tables).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    console.log(m.account.reconciled ? `   سرورِ حساب: ${JSON.stringify(m.account.report.totals || {})}` : `   ⚠️ سرورِ حساب: ${m.account.reason}`);
    if (!r.ok) console.log(`   ❌ نمی‌خواند: ${[...r.bad, ...r.extra].slice(0, 10).join('، ')}`);
    return r.ok ? 0 : 1;
  }
  if (cmd === 'import') {
    const file = args._[1];
    if (!file || !args.data) { console.error(HELP); return 2; }
    if (args.only !== undefined && args.only !== true) parseOnly(args.only);
    const pass = await askPassphrase('رمزِ بسته: ');
    if (args.only !== undefined) {
      const r = await importOnly({
        file, dataDir: args.data, pass, accountTool, force: !!args.force,
        sitesRoot: typeof args['sites-root'] === 'string' ? args['sites-root'] : '', expect: args.only === true ? '' : args.only,
      });
      console.log(`✅ «${r.only.id}»: ${r.files} فایل باز و با sha256 سنجیده شد${r.sqlite ? ` · شمارِ ردیفِ ${r.sqlite} دیتابیس همان مبدأ` : ''}`);
      if (r.placed.kind === 'site') console.log(`   سایت ⇐ ${r.placed.rootPath} · پورت ${r.placed.port ?? '—'} · دامنه‌ها: ${r.placed.domains.join('، ') || '—'}`);
      if (r.only.kind === 'account') {
        console.log(r.account.reconciled ? `   سرورِ حساب: ${r.account.tables} جدول — شمار، هش و جمعِ مبلغ همان مبدأ ✅` : `   ⚠️ سرورِ حساب سنجیده نشد: ${r.account.reason}`);
      }
      console.log(r.after.same ? '   پس از جای‌نشستن: هر فایل همان بسته است ✅' : `   ❌ ${r.after.diffs.length} اختلاف پس از جای‌نشستن: ${r.after.diffs.slice(0, 5).join('، ')}`);
      if (r.placed.asideDir) console.log(`   هم‌نامِ پیشینِ مقصد کنار رفت (پاک نه): ${r.placed.asideDir}`);
      console.log('   دادهٔ برنامه‌های دیگرِ این سرور دست نخورد. نشانی/تونلِ این برنامه را به این سرور ببرید (docs/DEPLOY-ANYWHERE-fa.md).');
      return r.after.same ? 0 : 1;
    }
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
