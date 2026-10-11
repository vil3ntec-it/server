'use strict';
/*
  به‌روزرسانی از GitHub — بی git، بی npm.

  روی GitHub کنارِ کد یک فهرست هست: release.json  ←  { version, files: [{ path, size, sha256 }] }
  (با `node scripts/make-release.js` ساخته می‌شود و CI می‌سنجد که با فایل‌ها یکی باشد.)

  ۱) فهرستِ GitHub خوانده می‌شود؛ اگر نسخه‌اش از نسخهٔ همین‌جا تازه‌تر نبود، کاری نمی‌شود.
  ۲) فقط فایل‌هایی که فرق دارند گرفته می‌شوند، هر کدام با sha256 و اندازه سنجیده و اول در
     data/update/ گذاشته می‌شوند. اگر حتی یکی نخورد، هیچ فایلی عوض نمی‌شود.
  ۳) بعد همه سرِ جایشان می‌نشینند و release.json آخر از همه نوشته می‌شود.
  پوشهٔ data، runtime و config.json هرگز دست نمی‌خورند.
*/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_URL = 'https://raw.githubusercontent.com/vil3ntec-it/server/main/sites/vill3n-top/';
const MAX_MANIFEST = 1024 * 1024;
const MAX_FILE = 20 * 1024 * 1024;
const MAX_FILES = 2000;

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function newer(a, b) {
  const pa = String(a || '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

// مسیرِ امن: نسبی، بی «..»، و بیرون از داده و تنظیماتِ همین کامپیوتر
function safePath(p) {
  if (typeof p !== 'string' || !p || p.length > 300) return false;
  if (p.startsWith('/') || p.includes('\\') || p.includes('\0') || /^[a-zA-Z]:/.test(p)) return false;
  const parts = p.split('/');
  if (parts.some((x) => !x || x === '.' || x === '..')) return false;
  const top = parts[0].toLowerCase();
  if (['data', 'runtime', 'node_modules', '.git'].includes(top)) return false;
  if (p === 'config.json' || p === 'release.json') return false;
  return true;
}

async function get(url, max, timeoutMs = 30000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ac.signal, redirect: 'follow', headers: { 'cache-control': 'no-cache' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const len = Number(r.headers.get('content-length') || 0);
    if (len > max) throw new Error('فایل بیش از اندازه بزرگ است');
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > max) throw new Error('فایل بیش از اندازه بزرگ است');
    return buf;
  } finally { clearTimeout(t); }
}

function readLocal(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'release.json'), 'utf8')); } catch (_) { return null; }
}
function localVersion(root) {
  const rel = readLocal(root);
  if (rel && rel.version) return rel.version;
  try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version; } catch (_) { return '0.0.0'; }
}

function writeAtomic(file, buf) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.new`;
  fs.writeFileSync(tmp, buf);
  try { fs.renameSync(tmp, file); } catch (e) {
    // ویندوز گاهی جایگزینیِ فایلِ بازِ دیگری را نمی‌پذیرد؛ یک بار با پاک‌کردن دوباره
    try { fs.unlinkSync(file); fs.renameSync(tmp, file); } catch (e2) { try { fs.unlinkSync(tmp); } catch (_) { /* نبود */ } throw e2; }
  }
}

/**
 * @returns {Promise<{ status: 'up-to-date'|'updated', version: string, changed?: number }>}
 */
async function checkAndApply({ root, dataDir, baseUrl = DEFAULT_URL, log = () => {} }) {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const raw = await get(`${base}release.json?t=${Date.now()}`, MAX_MANIFEST);
  let rel;
  try { rel = JSON.parse(raw.toString('utf8')); } catch (_) { throw new Error('release.json روی GitHub خراب است'); }
  if (!rel || typeof rel.version !== 'string' || !Array.isArray(rel.files) || rel.files.length > MAX_FILES) throw new Error('release.json روی GitHub درست نیست');

  const current = localVersion(root);
  if (!newer(rel.version, current)) return { status: 'up-to-date', version: current };

  for (const f of rel.files) {
    if (!f || !safePath(f.path) || !/^[0-9a-f]{64}$/.test(String(f.sha256)) || !Number.isInteger(f.size) || f.size < 0 || f.size > MAX_FILE) {
      throw new Error(`فهرستِ نسخهٔ ${rel.version} فایلِ نادرستی دارد: ${String(f && f.path).slice(0, 80)}`);
    }
  }

  const stage = path.join(dataDir, 'update', rel.version);
  fs.rmSync(stage, { recursive: true, force: true });
  const changed = [];
  try {
    for (const f of rel.files) {
      const target = path.join(root, ...f.path.split('/'));
      try { if (sha256(fs.readFileSync(target)) === f.sha256) continue; } catch (_) { /* فایل تازه است */ }
      const buf = await get(base + f.path.split('/').map(encodeURIComponent).join('/'), MAX_FILE);
      if (buf.length !== f.size || sha256(buf) !== f.sha256) throw new Error(`فایلِ ${f.path} با فهرست نمی‌خواند؛ به‌روزرسانی انجام نشد`);
      const staged = path.join(stage, ...f.path.split('/'));
      fs.mkdirSync(path.dirname(staged), { recursive: true });
      fs.writeFileSync(staged, buf);
      changed.push(f);
    }
    for (const f of changed) writeAtomic(path.join(root, ...f.path.split('/')), fs.readFileSync(path.join(stage, ...f.path.split('/'))));
    writeAtomic(path.join(root, 'release.json'), raw);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
  log(`به‌روزرسانی: ${current} ← ${rel.version} (${changed.length} فایل)`);
  return { status: 'updated', version: rel.version, from: current, changed: changed.length };
}

module.exports = { checkAndApply, newer, safePath, localVersion, DEFAULT_URL };
