// ---------------------------------------------------------------------------
//  آینهٔ به‌روزرسانیِ سایت‌ها — سایت از همین سرور آپدیت می‌گیرد، نه از گیت‌هاب
//
//  خواستهٔ صاحب سامانه (۱۴۰۵/۰۷/۱۹): «اپدیت رو از سرور بگیره؛ هر تغییری توی سایت
//  میدم باید توی سرور به سایت برسه … میخام گیت هاب دیده نشه توی سایت.»
//
//      ریپوی خودِ سایت (مثلاً VILL3N-WEB-، release.json) ──(هر ۱۰ دقیقه)──▶ <dataDir>/site-updates/<شناسه>/<نسخه>/
//      سایت ──GET http://127.0.0.1:<پورتِ پنل>/site-updates/<شناسه>/…──▶ همین سرور (فقط از خودِ کامپیوتر)
//
//  ⛔ سایت هیچ نشانیِ گیت‌هاب نمی‌شناسد: پنل نشانیِ آینه را در SITE_UPDATE_URL به
//     پروسهٔ سایت می‌دهد (sites/workspace.js).
//  ⛔ هیچ فایلی بی سنجش منتشر نمی‌شود: هر فایل با اندازه و sha256ِ release.json
//     سنجیده می‌شود؛ یکی نخورد ⇒ نسخهٔ سالمِ قبلی سرِ جایش. دانلود در `.part`
//     و current.json اتمی. خودِ سایت هم دوباره همان هش را می‌سنجد.
//  ⛔ مسیرهای data/، runtime/ و config.json هرگز در فهرست پذیرفته نمی‌شوند.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { get as httpGet } from '../update/http.js';
import { githubToken } from '../update/github.js';
import { LAYOUT } from '../update/layout.js';

/**
 * سایت‌هایی که آینه برایشان نگه داشته می‌شود: شناسهٔ site.json → ریپوی خودِ سایت.
 * ⛔ هر سایت ریپوی جدای خودش را دارد (خواستهٔ صاحب سامانه)، نه پوشه‌ای در ریپوی server.
 */
export const SOURCES = { 'vill3n-top': { repo: 'vil3ntec-it/VILL3N-WEB-', branch: 'main' } };

const VERSION = /^\d+(?:\.\d+){1,3}$/;
const MAX_FILE = 20 * 1024 * 1024;
const MAX_FILES = 2000;
const KEEP = 2;

/** روشن است؟ مثلِ آینهٔ پمپ: برنامهٔ ویندوز و نصبِ یک‌دستوره؛ آزمون‌ها خاموش */
export function siteMirrorEnabled() {
  const env = process.env.HLP_SITE_MIRROR;
  if (env === '0') return false;
  if (env === '1') return true;
  return LAYOUT === 'packaged';
}

//  ⚠️ HLP_SITE_RAW فقط برای آزمون است (به‌جای https://raw.githubusercontent.com/)
function rawBase({ repo, branch }) {
  const root = (process.env.HLP_SITE_RAW || 'https://raw.githubusercontent.com/').replace(/\/*$/, '/');
  return `${root}${repo}/${branch}/`;
}

export function mirrorRoot() {
  return path.join(config.dataDir, 'site-updates');
}

/** همان قاعدهٔ خودِ سایت (src/core/updater.js) */
export function safePath(p) {
  if (typeof p !== 'string' || !p || p.length > 300) return false;
  if (p.startsWith('/') || p.includes('\\') || p.includes('\0') || /^[a-zA-Z]:/.test(p)) return false;
  const parts = p.split('/');
  if (parts.some((x) => !x || x === '.' || x === '..')) return false;
  if (['data', 'runtime', 'node_modules', '.git'].includes(parts[0].toLowerCase())) return false;
  if (p === 'config.json' || p === 'release.json') return false;
  return true;
}

export function validateRelease(rel) {
  if (!rel || !VERSION.test(String(rel.version)) || !Array.isArray(rel.files) || rel.files.length > MAX_FILES) return false;
  return rel.files.every((f) => f && safePath(f.path) && /^[0-9a-f]{64}$/.test(String(f.sha256))
    && Number.isInteger(f.size) && f.size >= 0 && f.size <= MAX_FILE);
}

async function fetchBuf(url, max) {
  const token = githubToken();
  const headers = { 'cache-control': 'no-cache', 'user-agent': 'homelab-panel' };
  if (token && /^https:\/\/raw\.githubusercontent\.com\//.test(url)) headers.authorization = `token ${token}`;
  const res = await httpGet(url, { headers, timeout: 60000 });
  if (res.status !== 200) { res.stream.resume(); throw new Error(`HTTP ${res.status}`); }
  const chunks = [];
  let size = 0;
  for await (const c of res.stream) {
    size += c.length;
    if (size > max) { res.stream.destroy(); throw new Error('فایل بیش از اندازه بزرگ است'); }
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

function readCurrent(id) {
  try {
    const cur = JSON.parse(fs.readFileSync(path.join(mirrorRoot(), id, 'current.json'), 'utf8'));
    return VERSION.test(String(cur.version)) ? cur : null;
  } catch {
    return null;
  }
}

/** یک دور: برای هر سایت، اگر نسخهٔ تازه‌ای روی گیت‌هاب هست، بگیر و بسنج */
export async function syncOnce({ log = () => {} } = {}) {
  const out = [];
  for (const [id, src] of Object.entries(SOURCES)) {
    try {
      out.push(await guarded(id, src, log));
    } catch (e) {
      log(`آینهٔ سایتِ ${id}: ${e.message}`);
      out.push({ id, error: e.message });
    }
  }
  return { sites: out, changed: out.some((x) => x.changed) };
}

/**
 * یک سایت، همین حالا — برای دکمهٔ «بررسی» در پنلِ خودِ سایت (POST /site-updates/<شناسه>/__refresh).
 * دو درخواستِ هم‌زمان یکی می‌شوند؛ هر سایت حداکثر هر ۲۰ ثانیه یک بار.
 */
const inflight = new Map();
const lastRefresh = new Map();
// ⛔ کارِ ۱۰ دقیقه‌ای و دکمه هرگز هم‌زمان در همان پوشهٔ .part نمی‌نویسند
function guarded(id, src, log) {
  if (inflight.has(id)) return inflight.get(id);
  const p = syncSite(id, rawBase(src), log).finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}
export async function refreshSite(id, { log = () => {} } = {}) {
  if (!Object.hasOwn(SOURCES, id)) return null;
  if (!siteMirrorEnabled()) return { id, changed: false, error: 'آینهٔ سایت در این کنترول سنتر خاموش است' };
  if (inflight.has(id)) return inflight.get(id).catch((e) => ({ id, changed: false, error: e.message }));
  if (Date.now() - (lastRefresh.get(id) || 0) < 20000) return { id, changed: false, throttled: true, version: readCurrent(id)?.version || null };
  lastRefresh.set(id, Date.now());
  return guarded(id, SOURCES[id], log)
    .catch((e) => { log(`آینهٔ سایتِ ${id}: ${e.message}`); return { id, changed: false, error: e.message, version: readCurrent(id)?.version || null }; });
}

async function syncSite(id, base, log) {
  const raw = await fetchBuf(`${base}release.json?t=${Date.now()}`, 1024 * 1024);
  let rel;
  try { rel = JSON.parse(raw.toString('utf8')); } catch { throw new Error('release.json خراب است'); }
  if (!validateRelease(rel)) throw new Error('release.json درست نیست');

  const cur = readCurrent(id);
  if (cur?.version === rel.version) return { id, version: rel.version, changed: false };

  const siteDir = path.join(mirrorRoot(), id);
  const part = path.join(siteDir, `${rel.version}.part`);
  const final = path.join(siteDir, rel.version);
  const prev = cur ? path.join(siteDir, cur.version) : null;
  await fsp.rm(part, { recursive: true, force: true });

  for (const f of rel.files) {
    const target = path.join(part, ...f.path.split('/'));
    await fsp.mkdir(path.dirname(target), { recursive: true });
    // فایلِ یکسان با نسخهٔ قبلی دوباره دانلود نمی‌شود
    let buf = null;
    if (prev) {
      try {
        const old = await fsp.readFile(path.join(prev, ...f.path.split('/')));
        if (old.length === f.size && sha256(old) === f.sha256) buf = old;
      } catch { /* تازه است */ }
    }
    if (!buf) {
      buf = await fetchBuf(base + f.path.split('/').map(encodeURIComponent).join('/'), MAX_FILE);
      if (buf.length !== f.size || sha256(buf) !== f.sha256) {
        await fsp.rm(part, { recursive: true, force: true });
        throw new Error(`${f.path} با فهرست نمی‌خواند؛ نسخهٔ ${rel.version} نگه داشته نشد`);
      }
    }
    await fsp.writeFile(target, buf);
  }
  await fsp.writeFile(path.join(part, 'release.json'), raw);
  await fsp.rm(final, { recursive: true, force: true });
  await fsp.rename(part, final);

  const tmp = path.join(siteDir, `current.json.${process.pid}`);
  await fsp.writeFile(tmp, JSON.stringify({ version: rel.version, at: new Date().toISOString() }));
  await fsp.rename(tmp, path.join(siteDir, 'current.json'));

  // فقط دو نسخهٔ آخر می‌ماند تا سایتی که وسطِ گرفتن است نشکند
  const versions = (await fsp.readdir(siteDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && VERSION.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const v of versions.slice(KEEP)) await fsp.rm(path.join(siteDir, v), { recursive: true, force: true });

  log(`آینهٔ سایتِ ${id}: نسخهٔ ${rel.version} آماده شد`);
  return { id, version: rel.version, from: cur?.version ?? null, changed: true };
}

/**
 * فایلی که باید به سایت داده شود — یا null.
 * فقط release.json و فایل‌هایی که در فهرستِ نسخهٔ جاری آمده‌اند.
 */
export function servedFile(id, relPath) {
  if (!Object.hasOwn(SOURCES, id)) return null;
  const cur = readCurrent(id);
  if (!cur) return null;
  const dir = path.join(mirrorRoot(), id, cur.version);
  if (relPath === 'release.json') return path.join(dir, 'release.json');
  if (!safePath(relPath)) return null;
  let rel;
  try { rel = JSON.parse(fs.readFileSync(path.join(dir, 'release.json'), 'utf8')); } catch { return null; }
  if (!rel.files.some((f) => f.path === relPath)) return null;
  return path.join(dir, ...relPath.split('/'));
}

/** نشانیِ آینه برای پروسهٔ یک سایت — یا null اگر این سایت آینه ندارد */
export function updateUrlFor(siteRoot) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(siteRoot, 'site.json'), 'utf8'));
    const id = String(manifest?.id || '');
    if (!Object.hasOwn(SOURCES, id)) return null;
    return `http://127.0.0.1:${config.port}/site-updates/${id}/`;
  } catch {
    return null;
  }
}
