// ---------------------------------------------------------------------------
//  «جابه‌جایی به کامپیوترِ دیگر» از خودِ پنل (۱.۵۰.۹۳) — همان قالب و همان کدِ
//  ‎scripts/move-server.mjs‎ (هیچ قالبِ دومی نیست؛ این‌جا فقط «پنلِ روشن» اضافه است).
//
//  ⛔ رمزِ بسته فقط در حافظهٔ همین درخواست: نه در کار (job)، نه در دفتر، نه در لاگ.
//  ⛔ export از پنلِ روشن:
//       • دیتابیسِ پنل با ‎VACUUM INTO‎ از همان اتصالِ خودِ پنل (عکسِ سازگار، WAL هم)؛
//       • سرورِ حسابِ زیرِ نظرِ پنل **چند ثانیه می‌ایستد**، از ‎<داده>/account-server‎ (جز کدِ ‎app/‎) رونوشت
//         گرفته می‌شود و همان دم دوباره روشن می‌شود — PGliteِ روشن کپیِ سالم نمی‌دهد؛
//       • sha256 ِ هر فایل همان بایت‌هایی است که در بسته رفت (writeBundle).
//  ⛔ import هرگز زیرِ پای پنلِ روشن جابه‌جا نمی‌کند: بسته در ‎.vmove-importing-‎ باز و کامل سنجیده می‌شود
//     (sha256، شمارِ ردیف، سرورِ حساب) ⇒ ‎.vmove-ready-‎ ⇒ پنل دوباره بالا می‌آید و ‎src/db.js‎ پیش از باز کردنِ
//     دیتابیس جابه‌جا می‌کند (`applyPendingMove`) — روی ویندوز فایلِ باز جابه‌جا نمی‌شود. دادهٔ قبلی کنار، نه پاک.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config, paths } from '../config.js';
import { db, logEvent } from '../db.js';
import { vacuumInto } from './sqlite.js';
import {
  exportData, stageImport, checkPassphrase, manifestSummary, outsidePaths,
  BUNDLE_MAGIC, EXCLUDES, MIN_PASSPHRASE, READY_PREFIX, READY_MARK, LAST_IMPORT,
} from '../../scripts/move-server.mjs';
import { accountStatus, stopAccountServer, startAccountServer, waitAccountServerExit } from '../account/supervisor.js';
import { scheduleRestart } from '../update/github.js';

export const CHUNK_BYTES = 8 * 1024 * 1024;
const EXPORT_TTL_MS = 6 * 60 * 60 * 1000;
const UPLOAD_TTL_MS = 6 * 60 * 60 * 1000;

export function maxBundleBytes() {
  const n = Number(process.env.HLP_MOVE_MAX_BYTES);
  return Number.isFinite(n) && n > 1024 ? Math.floor(n) : 16 * 1024 ** 3;
}

const root = () => path.join(config.dataDir, '.vmove-panel');
const dirOf = (kind) => path.join(root(), kind);

//  پس از هر بالا آمدن، بارگذاری‌ها و فایل‌های ساخته‌شدهٔ پیشین بی‌صاحب‌اند (فهرستشان در حافظه بود) — کارگاهِ پنل، نه داده
for (const kind of ['in', 'out', 'work']) {
  try { fs.rmSync(path.join(config.dataDir, '.vmove-panel', kind), { recursive: true, force: true }); } catch { /* بی‌خیال */ }
}

const fail = (status, code, message, extra = {}) => Object.assign(new Error(message || code), { status, code, ...extra });

/* ───────────────────────────── کارها (job) ───────────────────────────── */

const jobs = new Map();
let active = null;

function newJob(kind, by) {
  if (active) throw fail(409, 'busy', 'یک جابه‌جاییِ دیگر در جریان است — چند لحظه صبر کنید.');
  const job = { id: crypto.randomBytes(16).toString('hex'), kind, by, state: 'running', step: 'start', startedAt: Date.now(), finishedAt: null, result: null, error: null };
  jobs.set(job.id, job);
  for (const id of [...jobs.keys()].slice(0, -10)) jobs.delete(id);
  active = job.id;
  return job;
}

function run(job, fn) {
  Promise.resolve().then(fn).then(
    (result) => { job.result = result; job.state = 'done'; },
    (e) => {
      job.error = String(e?.message || e).slice(0, 600);
      job.state = 'failed';
      logEvent('warn', 'panel', `جابه‌جایی (${job.kind}) انجام نشد: ${job.error.slice(0, 200)}`);
    },
  ).finally(() => { job.finishedAt = Date.now(); if (active === job.id) active = null; });
}

export function jobView(id) {
  const j = jobs.get(String(id || ''));
  if (!j) return null;
  const { by, ...rest } = j;
  return { ...rest, mode: by?.mode || null };
}

export function jobOwner(id) {
  const j = jobs.get(String(id || ''));
  return j ? { ...j.by, kind: j.kind } : null;
}
export function isBusy() { return Boolean(active); }

/* ─────────────────────────────── export ─────────────────────────────── */

function sweep(kind, ttl) {
  try {
    for (const name of fs.readdirSync(dirOf(kind))) {
      const p = path.join(dirOf(kind), name);
      try { if (Date.now() - fs.statSync(p).mtimeMs > ttl) fs.rmSync(p, { recursive: true, force: true }); } catch { /* رفته */ }
    }
  } catch { /* پوشه نیست */ }
}

const exportsMeta = new Map();

/** نامِ فایلِ دانلود: ‎vill3n-<نامِ کامپیوتر>-<تاریخ>.vmove‎ — فقط حرف و رقم */
function downloadName(at) {
  const host = String(os.hostname() || 'server').replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'server';
  const d = new Date(at);
  const p2 = (n) => String(n).padStart(2, '0');
  return `vill3n-${host}-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.vmove`;
}

/**
 * @param {{ pass: string, include?: { backups?: boolean }, by: { id, username } }} opts
 * سرورِ حساب فقط وقتی پنل خودش روشنش کرده می‌ایستد؛ زمانِ خاموشی در نتیجه هست.
 */
export function startExport({ pass, include = {}, by }) {
  try { checkPassphrase(pass); } catch (e) { throw fail(400, 'passphrase_too_short', e.message); }
  const job = newJob('export', { ...by, mode: 'owner' });
  const inc = { backups: include.backups === true };
  run(job, async () => {
    sweep('out', EXPORT_TTL_MS);
    const work = path.join(dirOf('work'), job.id);
    await fsp.mkdir(work, { recursive: true });
    await fsp.mkdir(dirOf('out'), { recursive: true });
    let pausedAt = 0;
    let pauseMs = 0;
    let resumed = null;
    try {
      job.step = 'panel-db';
      const panelSnap = path.join(work, 'panel.db');
      vacuumInto(db, panelSnap);

      const acctDir = path.join(config.dataDir, 'account-server');
      let accountSnapshot = '';
      if (fs.existsSync(acctDir)) {
        const running = accountStatus().running;
        if (running) {
          job.step = 'account-pause';
          pausedAt = Date.now();
          stopAccountServer();
          if (!(await waitAccountServerExit(15000))) {
            resumed = startAccountServer().ok;
            throw new Error('سرورِ حساب در ۱۵ ثانیه نایستاد؛ چیزی برداشته نشد و دوباره روشن شد. کمی بعد دوباره بزنید.');
          }
        }
        try {
          job.step = 'account-copy';
          accountSnapshot = path.join(work, 'account-server');
          const app = path.join(acctDir, 'app');
          await fsp.cp(acctDir, accountSnapshot, {
            recursive: true,
            verbatimSymlinks: true,
            filter: (src) => src !== app && !src.startsWith(app + path.sep),
          });
        } finally {
          if (pausedAt) {
            resumed = startAccountServer().ok;
            pauseMs = Date.now() - pausedAt;
          }
        }
      }

      job.step = 'pack';
      const out = path.join(dirOf('out'), `${job.id}.vmove`);
      const r = await exportData({
        dataDir: config.dataDir, out, pass, include: inc, panelDbSnapshot: panelSnap, accountSnapshot,
        live: { from: 'panel', accountServer: pausedAt ? 'paused' : 'not_running', pauseMs },
      });
      const size = fs.statSync(out).size;
      const name = downloadName(r.manifest.createdAt);
      exportsMeta.set(job.id, { file: out, name, size, by: by?.id ?? null });
      logEvent('info', 'panel', `فایلِ جابه‌جایی ساخته شد (${r.manifest.files.length} فایل، ${size} بایت)${pausedAt ? ` — سرورِ حساب ${Math.round(pauseMs / 100) / 10} ثانیه ایستاد` : ''}`);
      return {
        id: job.id, name, size, summary: manifestSummary(r.manifest),
        account: { paused: Boolean(pausedAt), pauseMs, resumed },
        excludedPaths: r.manifest.excluded.slice(0, 40),
      };
    } finally {
      await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
    }
  });
  return job;
}

export function exportFile(id, userId) {
  const m = exportsMeta.get(String(id || ''));
  if (!m || !fs.existsSync(m.file)) return null;
  if (m.by != null && userId != null && m.by !== userId) return null;
  return m;
}

export function dropExport(id) {
  const m = exportsMeta.get(String(id || ''));
  if (!m) return false;
  exportsMeta.delete(String(id));
  fs.rmSync(m.file, { force: true });
  return true;
}

/* ─────────────────────────── بارگذاریِ بسته ─────────────────────────── */

const uploads = new Map();

function freeBytes(dir) {
  try {
    const st = fs.statfsSync(dir);
    return Number(st.bavail) * Number(st.bsize);
  } catch { return null; }
}

/** آغازِ بارگذاری — فقط یک بارگذاریِ باز در هر لحظه؛ قبلی دور ریخته می‌شود */
export function beginUpload({ size, by }) {
  const n = Number(size);
  if (!Number.isSafeInteger(n) || n < BUNDLE_MAGIC.length + 32) throw fail(400, 'bad_size', 'اندازهٔ فایل نادرست است.');
  const max = maxBundleBytes();
  if (n > max) throw fail(413, 'too_large', `فایل از سقف (${Math.round(max / 1024 ** 3)} گیگابایت) بزرگ‌تر است.`, { max });
  if (active) throw fail(409, 'busy', 'یک جابه‌جاییِ دیگر در جریان است.');
  sweep('in', UPLOAD_TTL_MS);
  fs.mkdirSync(dirOf('in'), { recursive: true });
  //  بسته + باز شدنش در پوشهٔ موقت ⇒ دستِ‌کم دو برابر
  const free = freeBytes(dirOf('in'));
  if (free != null && free < n * 2 + 256 * 1024 * 1024) {
    throw fail(507, 'disk_full', `جای خالیِ دیسک کم است: برای این فایل دستِ‌کم ${Math.ceil((n * 2) / 1024 ** 2)} مگابایت لازم است.`);
  }
  for (const u of uploads.values()) fs.rmSync(u.file, { force: true });
  uploads.clear();
  const id = crypto.randomBytes(16).toString('hex');
  const file = path.join(dirOf('in'), `${id}.vmove.part`);
  uploads.set(id, { id, file, size: n, received: 0, done: false, by, createdAt: Date.now() });
  return { uploadId: id, chunkBytes: CHUNK_BYTES, size: n };
}

export function uploadOf(id) { return uploads.get(String(id || '')) || null; }

/**
 * یک تکه (پشتِ سرِ هم، با offset) — ⛔ تکهٔ نخست پیش از نوشتن سنجیده می‌شود: بستهٔ VILL3N نیست ⇒ هیچ بایتی روی دیسک.
 * نامِ فایل را پنل می‌سازد (شناسهٔ تصادفی)؛ هیچ نامی از کاربر به مسیر نمی‌رسد.
 */
export function receiveChunk({ id, offset, body }) {
  const u = uploads.get(String(id || ''));
  if (!u) throw fail(404, 'upload_not_found', 'این بارگذاری پیدا نشد — از نو فایل را انتخاب کنید.');
  if (u.done) throw fail(409, 'upload_done', 'این فایل کامل رسیده است.');
  if (!Buffer.isBuffer(body) || !body.length) throw fail(400, 'empty_chunk', 'تکهٔ خالی.');
  if (Number(offset) !== u.received) throw fail(409, 'bad_offset', 'ترتیبِ تکه‌ها به هم خورد.', { received: u.received });
  if (body.length > CHUNK_BYTES || u.received + body.length > u.size) throw fail(413, 'too_large', 'تکه بزرگ‌تر از اندازهٔ اعلام‌شده است.');
  if (u.received === 0) {
    if (body.length < BUNDLE_MAGIC.length || !body.subarray(0, BUNDLE_MAGIC.length).equals(BUNDLE_MAGIC)) {
      uploads.delete(u.id);
      throw fail(400, 'not_vmove', 'این فایلِ جابه‌جاییِ VILL3N (.vmove) نیست.');
    }
    fs.writeFileSync(u.file, body, { mode: 0o600, flag: 'wx' });
  } else {
    fs.appendFileSync(u.file, body);
  }
  u.received += body.length;
  if (u.received === u.size) {
    const final = u.file.replace(/\.part$/, '');
    fs.renameSync(u.file, final);
    u.file = final;
    u.done = true;
  }
  return { received: u.received, size: u.size, done: u.done };
}

/* ─────────────────────────────── import ─────────────────────────────── */

/**
 * سنجشِ کامل در ‎.vmove-importing-‎ ⇒ ‎.vmove-ready-‎ ⇒ راه‌اندازیِ دوباره (اگر `restart`).
 * رمزِ غلط یا بستهٔ دست‌خورده ⇒ پوشهٔ موقت پاک، دادهٔ فعلی دست‌نخورده، فایلِ بارگذاری‌شده برای تلاشِ دوباره می‌ماند.
 */
export function startImport({ uploadId, pass, by, onReady }) {
  try { checkPassphrase(pass); } catch (e) { throw fail(400, 'passphrase_too_short', e.message); }
  const u = uploads.get(String(uploadId || ''));
  if (!u || !u.done) throw fail(404, 'upload_not_found', 'فایل کامل بارگذاری نشده است.');
  const job = newJob('import', by);
  run(job, async () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const staging = path.join(config.dataDir, `.vmove-importing-${stamp}`);
    job.step = 'verify';
    const r = await stageImport({ file: u.file, pass, staging, finalDir: config.dataDir });
    //  نشانه **آخر** نوشته می‌شود و فقط پس از آن نامِ پوشه «ready» می‌شود — نیمه‌کاره هرگز جابه‌جا نمی‌شود
    fs.writeFileSync(path.join(staging, READY_MARK), JSON.stringify({
      stamp, at: new Date().toISOString(), by: { username: by?.username || null, mode: by?.mode || null }, mode: by?.mode || null,
      account: r.account, remapped: r.remapped, manifest: r.manifest,
    }), { mode: 0o600 });
    fs.renameSync(staging, path.join(config.dataDir, `${READY_PREFIX}${stamp}`));
    uploads.delete(u.id);
    fs.rmSync(u.file, { force: true });
    const restart = process.env.HLP_MOVE_RESTART !== '0';
    logEvent('warn', 'panel', `فایلِ جابه‌جایی سنجیده شد (${r.files} فایل) — با راه‌اندازیِ دوبارهٔ پنل جای دادهٔ فعلی می‌نشیند`);
    onReady?.();
    if (restart) {
      setTimeout(async () => {
        try { stopAccountServer(); await waitAccountServerExit(10000); } catch { /* بی‌خیال */ }
        scheduleRestart(800);
      }, 1500).unref?.();
    }
    return { summary: manifestSummary(r.manifest), account: r.account, remapped: r.remapped, restart };
  });
  return job;
}

/* ─────────────────────────────── وضعیت ─────────────────────────────── */

export function lastImport() {
  try { return JSON.parse(fs.readFileSync(path.join(config.dataDir, LAST_IMPORT), 'utf8')); } catch { return null; }
}

export function pendingImport() {
  try { return fs.readdirSync(config.dataDir).some((n) => n.startsWith(READY_PREFIX)); } catch { return false; }
}

/** آن‌چه رابط پیش از ساختنِ فایل نشان می‌دهد */
export function moveInfo() {
  let outside = [];
  try { outside = outsidePaths(paths.db, config.dataDir).map((o) => o.path); } catch { /* بی جدول */ }
  const st = accountStatus();
  return {
    dataDir: config.dataDir,
    minPassphrase: MIN_PASSPHRASE,
    maxBytes: maxBundleBytes(),
    chunkBytes: CHUNK_BYTES,
    busy: isBusy(),
    accountServer: { supervised: Boolean(st.enabled && st.installed), running: Boolean(st.running) },
    excluded: EXCLUDES.map((x) => ({ what: x.what, why: x.why, optional: x.opt || null })),
    outside: [...new Set(outside)],
    pending: pendingImport(),
    lastImport: lastImport(),
  };
}
