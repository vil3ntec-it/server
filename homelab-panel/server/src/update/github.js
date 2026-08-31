// ---------------------------------------------------------------------------
//  به‌روزرسانی از GitHub — بررسی، دانلود، نصب، برگشت
//
//  چطور کار می‌کند:
//      ۱) آخرین Release (یا اگر Release نبود، آخرین کامیتِ شاخهٔ اصلی) خوانده می‌شود.
//      ۲) بستهٔ zip از GitHub می‌آید و درستی‌اش بررسی می‌شود.
//      ۳) از نصبِ فعلی بکاپ گرفته می‌شود.
//      ۴) فایل‌ها جایگزین می‌شوند — به‌جز data/ و .env و node_modules.
//      ۵) اگر وابستگی‌ها عوض شده بود، npm install اجرا می‌شود.
//      ۶) پنل خودش را دوباره بالا می‌آورد.
//
//  اگر هر گامی بخورد زمین، هیچ فایلی جابه‌جا نشده و نصبِ قبلی دست‌نخورده است.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.js';
import { db, getSetting, setSetting, logEvent } from '../db.js';
import { readSecret } from '../control/vault.js';
import { audit } from '../control/audit.js';
import { extractZip, readZipIndex, createZip, walk } from '../control/zip.js';
import { versionInfo } from '../version.js';
import { run } from '../lib/exec.js';
import { get as httpGet, getJson } from './http.js';
import {
  LAYOUT,
  SERVER_ROOT,
  installedServerRoot,
  SHELL_DIR,
  INSTALL_ROOT as ROOT,
  isProtected,
  destinationFor,
  backupSources,
  layoutInfo,
} from './layout.js';

/** ریشهٔ نصب — از layout.js می‌آید، چون در برنامهٔ ویندوز جای دیگری است */
export const INSTALL_ROOT = ROOT;
const UPDATE_DIR = path.join(config.dataDir, 'updates');
const API = 'https://api.github.com';

/* ------------------------- کدام مخزن؟ ---------------------------------- */

/** از تنظیمات، وگرنه از خودِ .git، وگرنه پیش‌فرضِ همین پروژه */
export function repoSlug() {
  const saved = getSetting('cc_update_repo', null);
  if (saved && /^[\w.-]+\/[\w.-]+$/.test(saved)) return saved;
  if (process.env.HLP_UPDATE_REPO && /^[\w.-]+\/[\w.-]+$/.test(process.env.HLP_UPDATE_REPO)) {
    return process.env.HLP_UPDATE_REPO;
  }
  try {
    const cfg = fs.readFileSync(path.join(INSTALL_ROOT, '.git', 'config'), 'utf8');
    const m = cfg.match(/url\s*=\s*.*github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\s*$/m);
    if (m) return m[1];
  } catch { /* مخزن گیت نیست */ }
  return 'vil3ntec-it/server';
}

export function updateChannel() {
  const value = getSetting('cc_update_channel', 'release');
  return value === 'branch' ? 'branch' : 'release';
}

export function updateBranch() {
  return getSetting('cc_update_branch', 'main');
}

/**
 * برچسبِ انتشاری که ساختِ ویندوزِ همین پنل زیرش می‌نشیند.
 *
 * چرا لازم است: در همین مخزن انتشارهای دیگری هم هست — برنامهٔ اندروید زیر
 * برچسب‌های خودش. آن‌ها هم «تازه‌ترین انتشار» حساب می‌شوند و کامیتشان مالِ
 * روزِ دیگری است. بدونِ این، پنل می‌توانست انتشارِ برنامهٔ اندروید را
 * «نسخهٔ تازهٔ خودش» بگیرد و با نصبش کلِ سرور را به یک کامیتِ قدیمی برگرداند.
 */
export function panelReleaseTag() {
  return getSetting('cc_update_tag', 'windows-preview');
}

/** توکنِ GitHub (برای مخزنِ خصوصی یا سقفِ درخواستِ بالاتر) از گاوصندوق می‌آید */
export const GITHUB_TOKEN_SECRET = 'github:update-token';

function githubToken() {
  try {
    const row = db
      .prepare("SELECT id FROM cc_secrets WHERE scope = 'global' AND name = ?")
      .get(GITHUB_TOKEN_SECRET);
    return row ? readSecret(row.id) : null;
  } catch {
    // گاوصندوق هنوز ساخته نشده — بدونِ توکن هم مخزنِ عمومی خوانده می‌شود
    return null;
  }
}

function githubHeaders() {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'control-center-updater',
    'x-github-api-version': '2022-11-28',
  };
  const token = githubToken();
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

async function ghJson(pathname, { timeout = 20000 } = {}) {
  const res = await getJson(`${API}${pathname}`, { headers: githubHeaders(), timeout });
  if (res.status === 404) return null;
  if (res.status < 200 || res.status >= 300) {
    // پیامِ خودِ GitHub خواناتر از یک کدِ خشک است
    const detail = res.json?.message ? ` — ${res.json.message}` : '';
    throw new Error(`github_http_${res.status}${detail}`);
  }
  return res.json;
}

/* ------------------------------ بررسی ---------------------------------- */

function normalizeVersion(v) {
  return String(v || '').replace(/^v/i, '').trim();
}

function isNewer(remote, local) {
  const a = normalizeVersion(remote).split(/[.-]/);
  const b = normalizeVersion(local).split(/[.-]/);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = Number(a[i] ?? 0);
    const y = Number(b[i] ?? 0);
    if (Number.isNaN(x) || Number.isNaN(y)) return normalizeVersion(remote) !== normalizeVersion(local);
    if (x !== y) return x > y;
  }
  return false;
}

const VERSION_TAG = /^v?\d+(?:\.\d+)+$/i;
const VERSION_IN_NAME = /(\d+(?:\.\d+)+)/;

/**
 * شمارهٔ نسخهٔ یک انتشار — یا null اگر شماره‌ای در کار نباشد.
 *
 * برچسبِ ثابت («windows-preview») شماره نیست؛ شماره داخلِ نامِ فایلِ نصبی
 * است: ControlCenter-Setup-1.4.0.exe. تا وقتی شماره را نخوانیم نمی‌شود
 * فهمید نسخهٔ آن‌طرف جلوتر است یا عقب‌تر — و همین بود که اجازه می‌داد
 * به‌روزرسانی، آدم را به عقب ببرد.
 */
export function releaseVersionOf(release) {
  const tag = String(release?.tag_name || '');
  if (VERSION_TAG.test(tag)) return normalizeVersion(tag);
  for (const asset of Array.isArray(release?.assets) ? release.assets : []) {
    const found = VERSION_IN_NAME.exec(String(asset?.name || ''));
    if (found) return found[1];
  }
  return null;
}

/**
 * از میانِ انتشارهای مخزن، آن‌هایی که مالِ خودِ پنل‌اند — و از میانشان
 * جلوترین. بقیهٔ انتشارها (برنامهٔ اندروید و هرچه فردا اضافه شود) نادیده
 * گرفته می‌شوند، نه اینکه با تاریخِ انتشار با پنل رقابت کنند.
 */
export function pickPanelRelease(releases, tag = 'windows-preview') {
  const mine = (Array.isArray(releases) ? releases : []).filter(
    (r) => r && r.tag_name && !r.draft && (r.tag_name === tag || VERSION_TAG.test(String(r.tag_name)))
  );
  if (!mine.length) return null;

  return mine.reduce((best, row) => {
    if (!best) return row;
    const a = releaseVersionOf(row);
    const b = releaseVersionOf(best);
    if (a && b && a !== b) return isNewer(a, b) ? row : best;
    // شماره‌ها یکی است یا خوانده نشد — تازه‌ترین انتشار
    const at = Date.parse(row.published_at || row.created_at || 0) || 0;
    const bt = Date.parse(best.published_at || best.created_at || 0) || 0;
    return at > bt ? row : best;
  }, null);
}

/**
 * آخرین نسخهٔ موجود روی GitHub.
 * @returns {{available:boolean, current:string, latest:string|null, ...}}
 */
export async function checkForUpdate({ force = false } = {}) {
  const repo = repoSlug();
  const channel = updateChannel();
  const current = versionInfo.version || '0.0.0';
  const installedCommit = getSetting('cc_update_commit', null);
  const out = {
    repo,
    channel,
    current,
    installedCommit,
    latest: null,
    available: false,
    publishedAt: null,
    notes: null,
    downloadUrl: null,
    checkedAt: Date.now(),
    error: null,
  };

  try {
    if (channel === 'release') {
      // /releases/latest نسخه‌های پیش‌نمایش را نادیده می‌گیرد و ساختِ ویندوزِ
      // این پنل پیش‌نمایش است، پس همیشه خالی برمی‌گردد. فهرست را می‌گیریم و
      // از میانش انتشارِ خودِ پنل را برمی‌داریم — نه «تازه‌ترین انتشارِ مخزن»،
      // که می‌تواند مالِ برنامهٔ اندروید و کامیتش مالِ هفتهٔ پیش باشد.
      const all = await ghJson(`/repos/${repo}/releases?per_page=30`);
      const release = pickPanelRelease(all, panelReleaseTag())
        || (await ghJson(`/repos/${repo}/releases/latest`));

      if (release && release.tag_name) {
        const version = releaseVersionOf(release);
        out.prerelease = Boolean(release.prerelease);
        out.latest = version || normalizeVersion(release.tag_name);
        out.tag = release.tag_name;
        /*
         *  برچسبِ چرخشی هر بار دوباره ساخته می‌شود ولی published_at اش سرِ
         *  همان روزِ اول می‌ماند و تکان نمی‌خورد؛ آنچه جلو می‌رود created_at
         *  است. تازه‌ترشان را برمی‌داریم، وگرنه «تاریخِ انتشار» چیزی را
         *  می‌گوید که ماه‌ها پیش بوده و هر مقایسه‌ای با آن غلط درمی‌آید.
         */
        out.publishedAt = Math.max(
          release.published_at ? Date.parse(release.published_at) : 0,
          release.created_at ? Date.parse(release.created_at) : 0,
        ) || null;
        out.notes = release.body ? String(release.body).slice(0, 8000) : null;
        out.downloadUrl = release.zipball_url;

        const sha = /^[0-9a-f]{40}$/i.test(String(release.target_commitish || ''))
          ? release.target_commitish
          : null;
        if (sha) out.commit = sha;

        /*
         *  به‌روزرسانی فقط به جلو.
         *
         *  تا حالا برای برچسبِ بی‌شماره فقط کامیت سنجیده می‌شد: «کامیتش با
         *  مالِ ما فرق دارد» یعنی «نسخهٔ تازه هست» — حتی اگر آن کامیت مالِ
         *  قبل بود. نتیجه‌اش این می‌شد که دکمهٔ به‌روزرسانی آدم را به نسخهٔ
         *  قدیمی می‌برد. حالا اگر شمارهٔ آن‌طرف عقب‌تر باشد، اصلاً پیشنهاد
         *  نمی‌شود.
         */
        if (version && isNewer(current, version)) {
          out.available = Boolean(force);
          out.behind = true;
        } else if (version && isNewer(version, current)) {
          out.available = true;
        } else if (version) {
          // همان شماره، ساختِ تازه‌تر: فقط اگر واقعاً بعد از نصبِ ما منتشر شده
          const installedAt = Number(getSetting('cc_update_installed_at', 0)) || 0;
          out.available = force
            || Boolean(sha && sha !== installedCommit && (!installedAt || (out.publishedAt || 0) > installedAt));
        } else {
          out.available = force || Boolean(sha && sha !== installedCommit);
        }

        setSetting('cc_update_last_check', out.checkedAt);
        return out;
      }
      // مخزن هنوز Release ندارد — می‌رویم سراغِ شاخه
      out.channel = 'branch';
    }

    const branch = updateBranch();
    const commits = await ghJson(`/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=1`);
    const head = Array.isArray(commits) ? commits[0] : null;
    if (!head) {
      out.error = 'no_commits_found';
      return out;
    }
    out.latest = head.sha.slice(0, 7);
    out.commit = head.sha;
    out.branch = branch;
    out.publishedAt = head.commit?.committer?.date ? Date.parse(head.commit.committer.date) : null;
    out.notes = head.commit?.message ? String(head.commit.message).slice(0, 2000) : null;
    out.downloadUrl = `https://codeload.github.com/${repo}/zip/${head.sha}`;
    out.available = force || !installedCommit || installedCommit !== head.sha;
    setSetting('cc_update_last_check', out.checkedAt);
    return out;
  } catch (e) {
    out.error = e.message;
    return out;
  }
}

/* ------------------------------ دانلود --------------------------------- */

export async function downloadUpdate(info) {
  if (!info?.downloadUrl) throw new Error('no_download_url');
  await fsp.mkdir(UPDATE_DIR, { recursive: true });
  const name = `update-${normalizeVersion(info.latest || 'head')}-${Date.now()}.zip`;
  const target = path.join(UPDATE_DIR, name);

  const res = await httpGet(info.downloadUrl, { headers: githubHeaders(), timeout: 120000 });
  if (res.status < 200 || res.status >= 300) throw new Error(`download_http_${res.status}`);

  await pipeline(res.stream, fs.createWriteStream(target));
  const st = await fsp.stat(target);
  if (st.size < 1024) throw new Error('download_too_small');

  // باید واقعاً یک zip سالم باشد
  const index = await readZipIndex(target);
  if (!index.entries.length) throw new Error('archive_empty');

  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(target)) hash.update(chunk);

  return { path: target, size: st.size, entries: index.entries.length, checksum: hash.digest('hex') };
}

/* ------------------------------- نصب ----------------------------------- */

/**
 * درختِ باز شده را روی نصبِ واقعی می‌نشاند.
 *
 * هر مسیر از destinationFor رد می‌شود، چون در برنامهٔ ویندوز مقصدِ
 * homelab-panel/server جای دیگری است و بقیهٔ مخزن اصلاً مقصدی ندارد.
 */
async function copyTree(from, { onFile = null } = {}) {
  let copied = 0;
  let skipped = 0;
  async function visit(src, rel) {
    for (const entry of await fsp.readdir(src, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const srcPath = path.join(src, entry.name);

      if (entry.isDirectory()) {
        // پوشه‌ها را دنبال می‌کنیم مگر اینکه کلِ شاخه محافظت‌شده باشد
        if (LAYOUT === 'repo' && isProtected(childRel)) {
          skipped++;
          continue;
        }
        await visit(srcPath, childRel);
        continue;
      }
      if (!entry.isFile()) continue;

      const dstPath = destinationFor(childRel);
      if (!dstPath) {
        skipped++;
        continue;
      }
      await fsp.mkdir(path.dirname(dstPath), { recursive: true });
      await fsp.copyFile(srcPath, dstPath);
      copied++;
      onFile?.(childRel);
    }
  }
  await visit(from, '');
  return { copied, skipped };
}

/** بکاپ از نصبِ فعلی — قبل از دست زدن به هر فایلی */
export async function backupInstall(label = 'pre-update') {
  await fsp.mkdir(UPDATE_DIR, { recursive: true });
  const target = path.join(UPDATE_DIR, `install-${label}-${Date.now()}.zip`);

  // نامِ داخلِ بکاپ همیشه نامِ نسبیِ مخزن است، تا برگرداندن از همان نگاشتِ
  // نصب رد شود و در هر چیدمانی سرِ جای درست بنشیند.
  const entries = [];
  for (const source of backupSources()) {
    const found = await walk(source.root, { skip: source.skip });
    for (const entry of found) entries.push({ ...entry, name: `${source.prefix}${entry.name}` });
  }

  const result = await createZip(target, entries);
  return { path: target, ...result };
}

/**
 * بسته باید همین برنامه باشد، نه یک برنامهٔ دیگر و نه نسخه‌ای عقب‌تر.
 *
 * چرا لازم است: به‌روزرسانی هر بسته‌ای را روی نصب می‌نشاند. اگر بسته از
 * شاخه‌ای بیاید که این بخش‌ها را ندارد، همه‌شان پاک می‌شوند و کاربر با یک
 * پنلِ قدیمی روبه‌رو می‌شود که حتی صفحهٔ به‌روزرسانی ندارد تا برگردد.
 * پس هرچه الان نصب است، باید در بسته هم باشد.
 */
function packageProblems(sourceRoot, newPkg, installedVersion) {
  const problems = [];

  if (installedVersion && newPkg.version && isNewer(installedVersion, newPkg.version)) {
    problems.push(`نسخهٔ بسته (${newPkg.version}) از نسخهٔ نصب‌شده (${installedVersion}) عقب‌تر است`);
  }

  const root = installedServerRoot();
  const installed = (...parts) => fs.existsSync(path.join(root, ...parts));
  const needed = ['homelab-panel/server/src/index.js'];

  if (installed('src', 'control')) needed.push('homelab-panel/server/src/control');
  if (installed('src', 'update')) needed.push('homelab-panel/server/src/update');
  if (installed('public', 'index.html')) needed.push('homelab-panel/server/public/index.html');
  // برنامهٔ ویندوز حتماً از بسته‌ای ساخته شده که پوستهٔ برنامه را داشته
  if (LAYOUT === 'packaged') needed.push('homelab-panel/desktop/app/main-impl.js');

  for (const rel of needed) {
    if (!fs.existsSync(path.join(sourceRoot, ...rel.split('/')))) problems.push(`بسته «${rel}» را ندارد`);
  }

  return problems;
}

/**
 * نصبِ بستهٔ دانلودشده.
 * @returns گزارشِ کامل؛ اگر جایی خطا بدهد، پیش از جابه‌جاییِ فایل‌ها متوقف می‌شود.
 */
export async function applyUpdate(info, downloaded, { actor = 'admin', restart = true } = {}) {
  const steps = [];
  const step = (name, status, detail = null) => {
    steps.push({ name, status, detail, at: Date.now() });
    return steps;
  };

  // ۱) باز کردن در پوشهٔ موقت
  const staging = path.join(UPDATE_DIR, `staging-${Date.now()}`);
  await fsp.mkdir(staging, { recursive: true });
  await extractZip(downloaded.path, staging);
  step('extract', 'ok', { dir: staging });

  // GitHub همه‌چیز را داخل یک پوشهٔ سرشاخه می‌گذارد
  const top = (await fsp.readdir(staging, { withFileTypes: true })).filter((e) => e.isDirectory());
  const sourceRoot = top.length === 1 ? path.join(staging, top[0].name) : staging;

  // ۲) بسته باید واقعاً همین برنامه باشد
  const marker = path.join(sourceRoot, 'homelab-panel', 'server', 'package.json');
  if (!fs.existsSync(marker)) {
    await fsp.rm(staging, { recursive: true, force: true });
    step('validate', 'error', 'package_marker_missing');
    throw Object.assign(new Error('invalid_package'), { steps });
  }
  const newPkg = JSON.parse(await fsp.readFile(marker, 'utf8'));

  // نسخه و محتوای نصبِ فعلی — قبل از اینکه به چیزی دست بزنیم
  let installedPkg = {};
  try {
    installedPkg = JSON.parse(await fsp.readFile(path.join(installedServerRoot(), 'package.json'), 'utf8'));
  } catch { /* نصبِ ناقص؛ آن‌وقت فقط سنجشِ محتوا می‌ماند */ }

  const problems = packageProblems(sourceRoot, newPkg, installedPkg.version);
  if (problems.length) {
    await fsp.rm(staging, { recursive: true, force: true });
    step('validate', 'error', { reason: 'package_incomplete', problems });
    throw Object.assign(new Error('package_incomplete'), { steps, problems, incomplete: true });
  }
  step('validate', 'ok', { version: newPkg.version });

  // ۳) بکاپ از نصبِ فعلی
  let backup = null;
  try {
    backup = await backupInstall('pre-update');
    step('backup', 'ok', { path: backup.path, files: backup.files, size: backup.size });
  } catch (e) {
    await fsp.rm(staging, { recursive: true, force: true });
    step('backup', 'error', e.message);
    throw Object.assign(new Error(`backup_failed: ${e.message}`), { steps });
  }

  // ۴) آیا وابستگی‌ها عوض شده‌اند؟ (قبل از جایگزینی می‌سنجیم)
  const depsChanged =
    JSON.stringify(installedPkg.dependencies || {}) !== JSON.stringify(newPkg.dependencies || {});

  // ۴ب) در برنامهٔ بسته‌بندی‌شده npm وجود ندارد. اگر وابستگی‌ها عوض شده باشند
  //     و npm در دسترس نباشد، همین‌جا می‌ایستیم — هنوز هیچ فایلی جابه‌جا نشده.
  //     نصبِ نیمه‌کاره‌ای که وابستگی‌اش کم است، بدتر از به‌روز نشدن است.
  let npmAvailable = true;
  if (depsChanged) {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const probe = await run(npmCmd, ['--version'], { timeout: 30000 }).catch(() => ({ ok: false }));
    npmAvailable = Boolean(probe.ok);
    if (!npmAvailable && LAYOUT === 'packaged') {
      await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
      step('dependencies', 'error', 'needs_installer');
      throw Object.assign(
        new Error('deps_need_installer'),
        { steps, backup, needsInstaller: true },
      );
    }
  }

  // ۵) جایگزینی
  let copyReport;
  try {
    copyReport = await copyTree(sourceRoot);
    step('install', 'ok', copyReport);
  } catch (e) {
    step('install', 'error', e.message);
    throw Object.assign(new Error(`install_failed: ${e.message}`), { steps, backup });
  } finally {
    await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
  }

  // ۶) وابستگی‌ها
  if (depsChanged && !npmAvailable) {
    step('dependencies', 'error', 'npm در دسترس نیست');
  } else if (depsChanged) {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const res = await run(npm, ['install', '--omit=dev', '--no-audit', '--no-fund'], {
      timeout: 10 * 60 * 1000,
      cwd: SERVER_ROOT,
    });
    step('dependencies', res.ok ? 'ok' : 'error', (res.stderr || res.stdout || '').slice(-1500));
  } else {
    step('dependencies', 'skipped', 'بدون تغییر');
  }

  // ۷) ثبتِ نسخهٔ نصب‌شده
  setSetting('cc_update_version', newPkg.version || info.latest || null);
  if (info.commit) setSetting('cc_update_commit', info.commit);
  setSetting('cc_update_installed_at', Date.now());
  setSetting('cc_update_last_backup', backup?.path || null);
  step('record', 'ok', { version: newPkg.version, commit: info.commit || null });

  // نشانهٔ «به‌روزرسانی نشست» برای برنامهٔ ویندوز. پوستهٔ برنامه داخلِ فایلِ
  // برنامه است، نه داخلِ سرور، پس تا کلِ برنامه دوباره باز نشود عوض نمی‌شود.
  try {
    await fsp.mkdir(UPDATE_DIR, { recursive: true });
    await fsp.writeFile(
      path.join(UPDATE_DIR, 'applied.json'),
      JSON.stringify(
        { version: newPkg.version || null, commit: info.commit || null, at: Date.now(), layout: LAYOUT },
        null,
        2,
      ),
      'utf8',
    );
  } catch { /* نشانه ننشست؛ به‌روزرسانی سرِ جایش هست */ }

  audit({
    actor,
    action: 'update.apply',
    entity: 'panel',
    entityId: newPkg.version || info.latest,
    detail: { repo: info.repo, from: versionInfo.version, to: newPkg.version, steps: steps.map((s) => `${s.name}:${s.status}`) },
  });
  logEvent('info', 'panel', `به‌روزرسانی به نسخهٔ ${newPkg.version} انجام شد`);

  if (restart) scheduleRestart();

  return { ok: true, steps, backup, version: newPkg.version, restart };
}

/* ------------------------------ راه‌اندازیِ دوباره ----------------------- */

/**
 * پنل خودش را دوباره بالا می‌آورد. اگر زیرِ سرویس (systemd / NSSM / اسکریپت)
 * باشد، خروج کافی است؛ وگرنه یک پروسهٔ مستقل ساخته می‌شود.
 */
export function scheduleRestart(delayMs = 1200) {
  const marker = path.join(config.dataDir, 'restart.flag');
  try {
    fs.writeFileSync(marker, String(Date.now()), 'utf8');
  } catch { /* بی‌خیال */ }

  setTimeout(() => {
    // در برنامهٔ ویندوز، خودِ برنامه سرور را دوباره بالا می‌آورد — و چون
    // پوستهٔ برنامه هم عوض شده، کلِ برنامه دوباره باز می‌شود.
    if (LAYOUT === 'packaged') process.exit(0);
    try {
      const child = spawn(process.execPath, [path.join(SERVER_ROOT, 'src', 'index.js')], {
        cwd: SERVER_ROOT,
        detached: true,
        stdio: 'ignore',
        env: process.env,
      });
      child.unref();
    } catch { /* اگر سرویس مدیریتش می‌کند، خودش برمی‌گردد */ }
    process.exit(0);
  }, delayMs).unref?.();
}

/* ------------------------------ برگشت ---------------------------------- */

/** آخرین بکاپِ نصب را برمی‌گرداند */
export async function rollback({ actor = 'admin' } = {}) {
  const backupPath = getSetting('cc_update_last_backup', null);
  if (!backupPath || !fs.existsSync(backupPath)) throw new Error('no_backup');
  const staging = path.join(UPDATE_DIR, `rollback-${Date.now()}`);
  await extractZip(backupPath, staging);
  const report = await copyTree(staging);
  await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
  audit({ actor, action: 'update.rollback', entity: 'panel', detail: { backupPath, ...report } });
  scheduleRestart();
  return { ok: true, ...report, backupPath };
}

export function updateStatus() {
  return {
    repo: repoSlug(),
    channel: updateChannel(),
    branch: updateBranch(),
    current: versionInfo.version,
    build: versionInfo.build,
    ...layoutInfo(),
    installedVersion: getSetting('cc_update_version', null),
    installedCommit: getSetting('cc_update_commit', null),
    installedAt: getSetting('cc_update_installed_at', null),
    lastCheck: getSetting('cc_update_last_check', null),
    lastBackup: getSetting('cc_update_last_backup', null),
    autoCheck: getSetting('cc_update_autocheck', true) !== false,
  };
}

/** بررسیِ خودکارِ روزانه — فقط خبر می‌دهد، خودش نصب نمی‌کند */
let autoTimer = null;
export function startUpdateWatcher({ intervalMs = 6 * 3600 * 1000 } = {}) {
  if (autoTimer) return;
  autoTimer = setInterval(async () => {
    if (getSetting('cc_update_autocheck', true) === false) return;
    try {
      const info = await checkForUpdate();
      if (info.available) {
        logEvent('info', 'panel', `نسخهٔ تازه در دسترس است: ${info.latest}`);
        setSetting('cc_update_pending', { latest: info.latest, at: Date.now() });
      } else {
        setSetting('cc_update_pending', null);
      }
    } catch { /* اینترنت نبود */ }
  }, intervalMs);
  autoTimer.unref?.();
}

export function stopUpdateWatcher() {
  if (autoTimer) clearInterval(autoTimer);
  autoTimer = null;
}
