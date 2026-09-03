// ---------------------------------------------------------------------------
//  پوشهٔ اطلاعاتِ حساب‌ها — روی درایوِ خودتان، نه داخلِ برنامه
//
//  چرا: دیتابیس (panel.db) داخلِ پوشهٔ نصبِ برنامه است. کامپیوتر که عوض شود
//  یا برنامه که دوباره نصب شود، آن پوشه می‌رود. این‌جا برای هر حساب یک پوشهٔ
//  جدا روی درایوی که خودتان انتخاب کرده‌اید ساخته می‌شود؛ کافی است همان پوشه
//  را روی کامپیوترِ تازه بگذارید.
//
//  ساختار:
//      <ریشه>/
//        احمد رضایی - ahmad@gmail.com/
//          حساب.json          ← نام، نشانی، اشتراک، دستگاه‌ها
//          اطلاعات.json       ← آخرین وضعیتِ دادهٔ دکان
//          بکاپ/
//            2026-09-03 14-30.json
//
//  ⚠️ نامِ پوشه از ایمیل ساخته می‌شود، و ایمیل چیزی است که کاربر می‌نویسد.
//  بدونِ پاک‌سازی، یک نشانیِ ساختگی مثل «../../windows» می‌توانست نوشتن را
//  ببرد بیرونِ ریشه. safeFolder همهٔ این‌ها را می‌گیرد.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { getSetting, setSetting, logEvent } from '../db.js';

const SETTING = 'tohid_accounts_dir';
const DEFAULT_FOLDER = 'اطلاعات حساب‌ها';

/** ریشهٔ پوشه‌ها — تنظیمِ پنل، وگرنه متغیرِ محیطی، وگرنه خاموش */
export function accountsRoot() {
  const saved = String(getSetting(SETTING, '') || '').trim();
  if (saved) return saved;
  const env = String(process.env.HLP_ACCOUNTS_DIR || '').trim();
  return env || '';
}

/**
 * ریشه را می‌گذارد. اگر مسیری که داده شده خودش «اطلاعات حساب‌ها» نباشد،
 * همین نام به تهش اضافه می‌شود — تا کسی که «D:\» را می‌دهد، کلِ درایو را
 * پر از پوشهٔ حساب نکند.
 */
export function setAccountsRoot(dir) {
  const clean = String(dir || '').trim();
  if (!clean) {
    setSetting(SETTING, '');
    return { ok: true, root: '', enabled: false };
  }
  const root = path.basename(clean) === DEFAULT_FOLDER ? clean : path.join(clean, DEFAULT_FOLDER);
  fs.mkdirSync(root, { recursive: true });
  setSetting(SETTING, root);
  logEvent('info', 'panel', `پوشهٔ اطلاعاتِ حساب‌ها: ${root}`);
  return { ok: true, root, enabled: true };
}

/**
 * نامِ پوشه‌ای که روی هر سه سیستمِ فایل بی‌خطر است.
 *
 * ویندوز این نویسه‌ها را نمی‌پذیرد: \ / : * ? " < > | — و نامی که با نقطه یا
 * فاصله تمام شود هم دردسر می‌سازد. «..» هم هرگز نباید بماند، وگرنه نوشتن از
 * ریشه بیرون می‌زند.
 */
export function safeFolder(name) {
  const flat = String(name || '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\.\.+/g, '.')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return flat.slice(0, 80) || 'بی-نام';
}

/** پوشهٔ همین حساب — «نام - ایمیل» تا در فایل‌منیجر پیدا شود */
export function folderFor(account) {
  const root = accountsRoot();
  if (!root || !account) return '';
  const contact = account.email || account.phone || account.account_id;
  const label = account.name ? `${account.name} - ${contact}` : String(contact);
  return path.join(root, safeFolder(label));
}

/**
 * پوشه را می‌سازد و پروندهٔ حساب را می‌نویسد.
 *
 * هیچ‌وقت خطا پرتاب نمی‌کند: درایو ممکن است جدا شده باشد یا پر باشد، و آن
 * نباید جلوی ثبت‌نام یا ورودِ کاربر را بگیرد. خطا در لاگ می‌نشیند.
 */
export async function saveAccountFile(account, extra = {}) {
  const dir = folderFor(account);
  if (!dir) return { saved: false, reason: 'disabled' };
  try {
    await fsp.mkdir(path.join(dir, 'بکاپ'), { recursive: true });
    const payload = {
      accountId: account.account_id,
      name: account.name || '',
      email: account.email || '',
      phone: account.phone || '',
      createdAt: account.created_at ? new Date(account.created_at).toISOString() : null,
      lastLoginAt: account.last_login_at ? new Date(account.last_login_at).toISOString() : null,
      ...extra,
      updatedAt: new Date().toISOString(),
    };
    await fsp.writeFile(path.join(dir, 'حساب.json'), JSON.stringify(payload, null, 2), 'utf8');
    return { saved: true, dir };
  } catch (e) {
    logEvent('warn', 'panel', `پوشهٔ حسابِ ${account.account_id} نوشته نشد: ${e.message}`);
    return { saved: false, reason: e.message };
  }
}

/** آخرین وضعیتِ دادهٔ دکان + یک نسخه در پوشهٔ بکاپ */
export async function saveAccountData(account, data) {
  const dir = folderFor(account);
  if (!dir) return { saved: false, reason: 'disabled' };
  try {
    const backups = path.join(dir, 'بکاپ');
    await fsp.mkdir(backups, { recursive: true });
    const body = JSON.stringify(data ?? {}, null, 2);
    await fsp.writeFile(path.join(dir, 'اطلاعات.json'), body, 'utf8');

    // نامِ فایل با زمان — «:» روی ویندوز ممنوع است، پس با خط‌تیره
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '-');
    await fsp.writeFile(path.join(backups, `${stamp}.json`), body, 'utf8');
    await pruneBackups(backups);
    return { saved: true, dir };
  } catch (e) {
    logEvent('warn', 'panel', `دادهٔ حسابِ ${account.account_id} نوشته نشد: ${e.message}`);
    return { saved: false, reason: e.message };
  }
}

/** فقط ۳۰ بکاپِ آخر می‌ماند — وگرنه درایو با گذشتِ ماه‌ها پر می‌شود */
async function pruneBackups(dir, keep = 30) {
  const files = (await fsp.readdir(dir).catch(() => []))
    .filter((f) => f.endsWith('.json'))
    .sort();
  for (const old of files.slice(0, Math.max(0, files.length - keep))) {
    await fsp.rm(path.join(dir, old), { force: true }).catch(() => {});
  }
}

/** وضعیت، برای نشان دادن در پنل */
export function vaultStatus() {
  const root = accountsRoot();
  if (!root) return { enabled: false, root: '', writable: false, folders: 0 };
  let writable = false;
  let folders = 0;
  let error = null;
  try {
    fs.mkdirSync(root, { recursive: true });
    fs.accessSync(root, fs.constants.W_OK);
    writable = true;
    folders = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).length;
  } catch (e) {
    // درایو جدا شده یا اجازهٔ نوشتن نیست — کاربر باید همین را ببیند
    error = e.message;
  }
  return { enabled: true, root, writable, folders, error };
}
