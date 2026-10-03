// ---------------------------------------------------------------------------
//  آینهٔ به‌روزرسانیِ برنامهٔ پمپ — برنامه از همین سرور آپدیت می‌گیرد
//
//  خواستهٔ صاحب سامانه (۱۴۰۵/۰۷/۱۹): «کاری کن که از سرور آپدیت بگیره برنامه و
//  سرور هم از گیت‌هاب نسخه‌های جدیدِ پمپ رو بگیره، که درجا که توی گیت‌هاب
//  آپدیت رو گذاشتم سرور ببینه و به برنامه بگه.»
//
//      گیت‌هاب ──(هر ۲ دقیقه، با ETag)──▶ همین سرور: <dataDir>/pump-updates/<نسخه>/
//      برنامهٔ پمپ ──GET /api/pump-updates/latest──▶ همین سرور (از راهِ تونل)
//
//  ⛔ **برنامه دیگر لازم نیست گیت‌هاب را بشناسد**، و مخزنِ کد می‌تواند خصوصی
//  شود: این سرور با توکنِ گاوصندوقِ پنل («github:update-token») می‌خواند.
//
//  ⛔ **هیچ فایلی بی سنجش منتشر نمی‌شود**: اول `SHA256SUMS.txt`، بعد هر بسته با
//  همان هش سنجیده می‌شود؛ یکی نخورد ⇒ نسخهٔ قبلی سرِ جایش می‌ماند. و برنامه
//  خودش دوباره همان هش (و اگر کلید دارد، امضای فهرست) را می‌سنجد — پس این
//  آینه فقط رساننده است، نه جای اعتماد.
//
//  ⛔ **فایل نیمه‌کاره هرگز دیده نمی‌شود**: دانلود در پوشهٔ `.part` است و
//  `current.json` فقط وقتی (اتمی) نوشته می‌شود که همه‌چیز سالم باشد.
//
//  ⚠️ فقط آن‌چه برنامه به کار می‌برد گرفته می‌شود: نصاب (هر دو معماری در یک
//  فایل)، بسته‌های کوچکِ «PumpYaqobi-app-<پایه>.zip» و فهرستِ چک‌سام. زیپ‌های
//  کاملِ ۱۲۰ مگابایتی گرفته نمی‌شوند — برنامه نصاب را بر آن‌ها ترجیح می‌دهد.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.js';
import { get as httpGet, getJson } from '../update/http.js';
import { githubToken } from '../update/github.js';
import { LAYOUT } from '../update/layout.js';

/**
 * روشن است؟ پیش‌فرض: برنامهٔ ویندوز (`packaged`) و نصبِ یک‌دستوره
 * (`HLP_PUMP_MIRROR=1` در core.env). در نصب از روی مخزن و همهٔ آزمون‌ها
 * خاموش — وگرنه هر آزمونی ۱۷۰ مگابایت از گیت‌هاب می‌کشید.
 */
export function mirrorEnabled() {
  const env = process.env.HLP_PUMP_MIRROR;
  if (env === '0') return false;
  if (env === '1') return true;
  return LAYOUT === 'packaged';
}

/** مخزنِ انتشارِ برنامهٔ پمپ — فقط همین سرور می‌داندش، نه برنامه. */
export function pumpRepo() {
  return String(process.env.HLP_PUMP_REPO || 'vil3ntec-it/pump-staion-yaqobi').trim();
}

//  ⚠️ `HLP_GITHUB_API` فقط برای آزمون است (همان قلابِ update/github.js).
function api() {
  return (process.env.HLP_GITHUB_API || 'https://api.github.com').replace(/\/+$/, '');
}

export function mirrorDir() {
  return path.join(config.dataDir, 'pump-updates');
}

export const SUMS = 'SHA256SUMS.txt';
const VERSION = /^\d+(?:\.\d+){1,3}$/;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

/** کدام فایل‌های انتشار گرفته می‌شوند. */
export function wanted(name) {
  if (!SAFE_NAME.test(name)) return false;
  if (name === SUMS || name === `${SUMS}.sig` || name === 'version.txt') return true;
  if (/^PumpYaqobi-app-[A-Za-z0-9]+\.zip$/.test(name)) return true;   // بستهٔ کوچک
  if (/^PumpYaqobi-Setup(-[A-Za-z0-9]+)?\.exe$/.test(name)) return true;
  return false;
}

export function normalizeVersion(tag) {
  const v = String(tag || '').replace(/^v/i, '').trim();
  return VERSION.test(v) ? v : '';
}

/** «hash  name» ⇒ Map(name → hash کوچک) */
export function parseSums(text) {
  const out = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (m) out.set(m[2], m[1].toLowerCase());
  }
  return out;
}

function headers(extra = {}) {
  const h = {
    accept: 'application/vnd.github+json',
    'user-agent': 'control-center-pump-mirror',
    'x-github-api-version': '2022-11-28',
    ...extra,
  };
  const token = githubToken();
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

async function readJson(file) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return null; }
}

async function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o644 });
  await fsp.rename(tmp, file);
}

async function sha256Of(file) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

/** نسخه‌ای که همین حالا سرو می‌شود (یا null). */
export async function current() {
  const cur = await readJson(path.join(mirrorDir(), 'current.json'));
  if (!cur || !normalizeVersion(cur.version) || !Array.isArray(cur.assets)) return null;
  return cur;
}

// ---------------------------------------------------------------------------
//  🚦 درِ پخش — «آپدیت روی سرور باشد ولی تا خودم نخواهم به هیچ برنامه‌ای نرود»
//
//  خواستهٔ صاحب سامانه (۱۴۰۵/۰۷/۱۹). دو حالت، در `release.json`:
//
//      auto  هر نسخهٔ سالمی که از گیت‌هاب رسید همان لحظه به برنامه‌ها می‌رود
//            (رفتارِ ۱.۵۰.۳۰ — پیش‌فرض، تا هیچ نصبی بی‌خبر از کار نیفتد)
//      hold  نسخهٔ تازه گرفته و سنجیده می‌شود ولی برنامه‌ها همان «منتشرشده» را
//            می‌بینند، تا مدیر خودش «انتشار» را بزند
//
//  ⛔ «آن‌چه برنامه‌ها می‌بینند» فقط از `served()` می‌آید — هم `/latest` و هم
//  درِ فایل‌ها. نسخهٔ نگه‌داشته از درِ عمومی **دانلود هم نمی‌شود**؛ فقط از
//  درِ پنل (برای آزمودن روی کامپیوترِ خودِ مدیر).
// ---------------------------------------------------------------------------
export const MODES = Object.freeze(['auto', 'hold']);

/** حالِ درِ پخش. */
export async function releaseState() {
  const r = (await readJson(path.join(mirrorDir(), 'release.json'))) || {};
  return {
    mode: MODES.includes(r.mode) ? r.mode : 'auto',
    published: normalizeVersion(r.published) || null,
    previous: normalizeVersion(r.previous) || null,
    at: r.at || null,
    by: r.by || null,
  };
}

async function writeRelease(next) {
  await fsp.mkdir(mirrorDir(), { recursive: true });
  await writeJsonAtomic(path.join(mirrorDir(), 'release.json'), next);
}

/** فهرستِ یک نسخهٔ گرفته‌شده (یا null). */
export async function manifestOf(version) {
  if (!normalizeVersion(version)) return null;
  const m = await readJson(path.join(mirrorDir(), version, 'manifest.json'));
  if (m && m.version === version && Array.isArray(m.assets)) return m;
  //  ⚠️ نسخه‌ای که پیش از ۱.۵۰.۳۱ گرفته شده فقط در current.json فهرست دارد
  const cur = await current();
  return cur && cur.version === version ? cur : null;
}

/**
 * نسخه‌ای که برنامه‌ها همین حالا می‌بینند (یا null = «هیچ چیزی بیرون نمی‌رود»).
 */
export async function served() {
  const r = await releaseState();
  if (r.mode === 'auto') return current();
  return r.published ? manifestOf(r.published) : null;
}

/** حالت را عوض می‌کند. نگه داشتن همان نسخهٔ امروز را «منتشرشده» قفل می‌کند. */
export async function setMode(mode, { by = null } = {}) {
  if (!MODES.includes(mode)) throw Object.assign(new Error('bad_mode'), { status: 400 });
  const r = await releaseState();
  const cur = await current();
  const next = { ...r, mode, at: new Date().toISOString(), by };
  if (mode === 'hold') {
    //  ⛔ آن‌چه برنامه‌ها امروز می‌گیرند همان بماند — نه بیشتر، نه کمتر
    if (r.mode === 'auto') {
      const now = cur?.version || null;
      if (now !== r.published) { next.previous = r.published; next.published = now; }
    }
  } else if (cur && cur.version !== r.published) {
    next.previous = r.published;
    next.published = cur.version;
  }
  await writeRelease(next);
  return releaseState();
}

/** یک نسخهٔ گرفته‌شده را برای همهٔ برنامه‌ها منتشر می‌کند (یا عقب می‌برد). */
export async function publish(version, { by = null } = {}) {
  const v = normalizeVersion(version);
  const m = v ? await manifestOf(v) : null;
  if (!m) throw Object.assign(new Error('version_not_mirrored'), { status: 404 });
  const r = await releaseState();
  const next = { ...r, at: new Date().toISOString(), by };
  if (r.published !== v) { next.previous = r.published; next.published = v; }
  //  ⚠️ در حالتِ خودکار، انتشارِ نسخه‌ای جز تازه‌ترین یعنی «عقب بردن» —
  //  پس خودکار خاموش می‌شود، وگرنه دورِ بعدِ آینه همان را برمی‌گرداند.
  const cur = await current();
  if (r.mode === 'auto' && cur && cur.version !== v) next.mode = 'hold';
  await writeRelease(next);
  return releaseState();
}

/** نسخه‌های روی دیسک (تازه‌ترین اول). */
export async function versions() {
  const out = [];
  let entries = [];
  try { entries = await fsp.readdir(mirrorDir(), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isDirectory() || !normalizeVersion(e.name)) continue;
    const m = await manifestOf(e.name);
    if (!m) continue;
    out.push({
      version: m.version,
      name: m.name || null,
      notes: m.notes || '',
      publishedAt: m.publishedAt || null,
      mirroredAt: m.mirroredAt || null,
      assets: m.assets.map((a) => ({ name: a.name, size: a.size })),
    });
  }
  return out.sort((a, b) => compareVersions(b.version, a.version));
}

export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** حالِ آینه — برای کارِ اتوماسیون و صفحهٔ پنل. */
export async function status() {
  const cur = await current();
  const st = (await readJson(path.join(mirrorDir(), 'state.json'))) || {};
  const r = await releaseState();
  const out = await served();
  return {
    repo: pumpRepo(),
    enabled: mirrorEnabled(),
    version: cur?.version || null,
    publishedAt: cur?.publishedAt || null,
    mirroredAt: cur?.mirroredAt || null,
    checkedAt: st.checkedAt || null,
    error: st.error || null,
    mode: r.mode,
    served: out?.version || null,
    previous: r.previous,
    releaseAt: r.at,
    releaseBy: r.by,
    waiting: !!(cur && out?.version !== cur.version && r.mode === 'hold'),
  };
}

/** یک فایلِ انتشار را دانلود می‌کند (با توکن، اگر هست) و اندازه را می‌سنجد. */
async function download(asset, file) {
  //  ⛔ درِ API دارایی، نه `browser_download_url`: همین در برای مخزنِ **خصوصی**
  //  هم کار می‌کند (با توکن). تغییرِ مسیرِ بعدی توکن را نمی‌برد (http.js).
  const url = asset.url || asset.browser_download_url;
  const res = await httpGet(url, {
    headers: headers({ accept: 'application/octet-stream' }),
    timeout: 120_000,
  });
  if (res.status < 200 || res.status >= 300) {
    res.stream.resume();
    throw new Error(`download_http_${res.status}:${asset.name}`);
  }
  await pipeline(res.stream, fs.createWriteStream(file));
  const size = (await fsp.stat(file)).size;
  if (asset.size && size !== asset.size) throw new Error(`size_mismatch:${asset.name}`);
}

/**
 * یک دور: «نسخهٔ تازه‌ای روی گیت‌هاب هست؟ بگیر، بسنج، منتشر کن.»
 *
 * ⛔ هیچ‌وقت نسخهٔ سالمِ قبلی را خراب نمی‌کند: هر شکستی فقط در `state.json`
 * می‌نشیند و بارِ بعد دوباره.
 */
export async function syncOnce({ log = () => {} } = {}) {
  const dir = mirrorDir();
  await fsp.mkdir(dir, { recursive: true });
  const stateFile = path.join(dir, 'state.json');
  const state = (await readJson(stateFile)) || {};
  const cur = await current();

  const note = async (patch) => {
    Object.assign(state, patch, { checkedAt: new Date().toISOString() });
    await writeJsonAtomic(stateFile, state);
  };

  //  ══ ۱) پرسش — با ETag، پس «چیزی عوض نشده» هیچ سهمی از سقفِ گیت‌هاب نمی‌خورد
  const h = headers();
  if (state.etag && cur) h['if-none-match'] = state.etag;
  const res = await getJson(`${api()}/repos/${pumpRepo()}/releases/latest`, { headers: h, timeout: 20_000 });
  if (res.status === 304) {
    await note({ error: null });
    return { changed: false, version: cur?.version || null };
  }
  if (res.status < 200 || res.status >= 300 || !res.json) {
    const why = res.status === 404 ? 'not_found_or_private_without_token' : `github_http_${res.status}`;
    await note({ error: why });
    throw new Error(why);
  }

  const rel = res.json;
  const version = normalizeVersion(rel.tag_name);
  if (!version) {
    await note({ error: 'no_version_tag' });
    return { changed: false, version: cur?.version || null };
  }
  const etag = res.headers?.etag || null;

  if (cur && cur.version === version && cur.tag === rel.tag_name) {
    await note({ etag, error: null });
    return { changed: false, version };
  }

  //  ══ ۲) فهرستِ چک‌سام — بی آن هیچ چیزی منتشر نمی‌شود ═════════════════
  const assets = (rel.assets || []).filter((a) => a && wanted(a.name));
  const sumsAsset = assets.find((a) => a.name === SUMS);
  if (!sumsAsset) {
    await note({ error: 'no_checksums' });
    throw new Error('no_checksums');
  }

  const part = path.join(dir, `${version}.part`);
  await fsp.rm(part, { recursive: true, force: true });
  await fsp.mkdir(part, { recursive: true });

  try {
    log(`نسخهٔ ${version} — گرفتنِ فهرستِ چک‌سام`);
    await download(sumsAsset, path.join(part, SUMS));
    const sums = parseSums(await fsp.readFile(path.join(part, SUMS), 'utf8'));
    if (sums.size === 0) throw new Error('empty_checksums');

    const manifest = [];
    for (const a of assets) {
      const file = path.join(part, a.name);
      if (a.name !== SUMS) {
        log(`گرفتنِ ${a.name} (${Math.round((a.size || 0) / 1048576)} MB)`);
        await download(a, file);
      }
      const size = (await fsp.stat(file)).size;
      let sha = null;
      if (sums.has(a.name)) {
        sha = await sha256Of(file);
        if (sha !== sums.get(a.name)) throw new Error(`checksum_mismatch:${a.name}`);
      } else if (/\.(zip|exe)$/i.test(a.name)) {
        //  ⛔ بسته‌ای که در فهرست نیست منتشر نمی‌شود — برنامه هم نصبش نمی‌کرد.
        await fsp.rm(file, { force: true });
        continue;
      }
      manifest.push({ name: a.name, size, sha256: sha });
    }
    if (!manifest.some((m) => /\.(zip|exe)$/i.test(m.name))) throw new Error('no_packages');

    //  ══ ۳) جابه‌جاییِ اتمی ════════════════════════════════════════════════
    const next = {
      version,
      tag: rel.tag_name,
      name: rel.name || `v${version}`,
      notes: rel.body || '',
      publishedAt: rel.published_at || null,
      mirroredAt: new Date().toISOString(),
      assets: manifest,
    };
    await writeJsonAtomic(path.join(part, 'manifest.json'), next);
    const final = path.join(dir, version);
    await fsp.rm(final, { recursive: true, force: true });
    await fsp.rename(part, final);
    await writeJsonAtomic(path.join(dir, 'current.json'), next);
    await note({ etag, error: null });

    //  ══ درِ پخش: خودکار ⇒ همین حالا منتشر؛ نگه‌داشته ⇒ فقط آماده ════════
    const rel0 = await releaseState();
    if (rel0.mode === 'auto' && rel0.published !== version) {
      await writeRelease({ ...rel0, previous: rel0.published, published: version, at: new Date().toISOString(), by: 'auto' });
    }
    const rel1 = await releaseState();

    //  ══ ۴) نگه‌داری: تازه‌ترین، منتشرشده و یکی پیش از آن ══════════════════
    //  ⛔ نسخهٔ منتشرشده هرگز پاک نمی‌شود، وگرنه در حالتِ نگه‌داشته برنامه‌ها
    //  فهرستی می‌گرفتند که فایلش نیست.
    const keep = new Set([version, cur?.version, rel1.published, rel1.previous].filter(Boolean));
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const v = entry.name.replace(/\.part$/, '');
      if (entry.name.endsWith('.part') || !keep.has(v)) {
        await fsp.rm(path.join(dir, entry.name), { recursive: true, force: true });
      }
    }
    log(rel1.mode === 'auto'
      ? `نسخهٔ ${version} آماده شد و به برنامه‌ها می‌رود`
      : `نسخهٔ ${version} روی سرور آماده است — پخش خاموش است، تا «انتشار» را نزنید به هیچ برنامه‌ای نمی‌رود`);
    return { changed: true, version, from: cur?.version || null, held: rel1.mode === 'hold' };
  } catch (e) {
    await fsp.rm(part, { recursive: true, force: true }).catch(() => {});
    await note({ error: String(e.message || e) });
    throw e;
  }
}

/**
 * مسیرِ یک فایل — فقط اگر واقعاً در فهرستِ همان نسخه باشد.
 * ⛔ نام و نسخه از درخواست می‌آیند؛ هیچ‌کدام بی سنجش به مسیر نمی‌رسد.
 *
 * ⛔ درِ عمومی (`any: false`) فقط نسخهٔ منتشرشده و یکی پیش از آن را می‌دهد
 * (دانلودی که وسطِ انتشارِ تازه شروع شده نشکند). نسخهٔ نگه‌داشته فقط از درِ
 * پنل (`any: true`)، برای آزمودن روی کامپیوترِ خودِ مدیر.
 */
export async function filePath(version, name, { any = false } = {}) {
  if (!normalizeVersion(version) || !SAFE_NAME.test(String(name || ''))) return null;
  if (name === 'manifest.json') return null;
  if (!any) {
    const r = await releaseState();
    const out = await served();
    const allowed = new Set([out?.version].filter(Boolean));
    //  ⚠️ «یکی پیش از آن» فقط وقتی از منتشرشده کهنه‌تر است — پس از عقب بردن،
    //  نسخهٔ تازه‌ترِ کنارگذاشته از این در بیرون نمی‌رود.
    if (r.previous && out && compareVersions(r.previous, out.version) < 0) allowed.add(r.previous);
    if (!allowed.has(version)) return null;
  }
  const m = await manifestOf(version);
  if (!m || !m.assets.some((a) => a.name === name)) return null;
  const file = path.join(mirrorDir(), version, name);
  try { await fsp.access(file); } catch { return null; }
  return file;
}
