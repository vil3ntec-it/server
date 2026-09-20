// ---------------------------------------------------------------------------
//  رمزنگاریِ آرشیوِ پشتیبان — بندِ ۷ی پرامپت: «رمزنگاری بکاپ‌ها (age یا gpg)»
//
//  دو راه، یک قرارداد:
//    • اگر «age» روی سیستم هست ⇒ همان (کلیدِ X25519 که یک بار با age-keygen
//      ساخته می‌شود). فایل: <نام>.age
//    • وگرنه ⇒ AES-256-GCM خودِ Node (هیچ وابستگیِ تازه‌ای). فایل: <نام>.enc
//      قالب: «VLN1» · nonce(۱۲) · متنِ رمزشده · برچسبِ GCM(۱۶) در انتها
//
//  کلید در <dataDir>/backup-keys/ با دسترسی ۶۰۰ می‌نشیند و **هیچ‌وقت**
//  بازنویسی نمی‌شود: کلیدِ عوض‌شده یعنی همهٔ پشتیبان‌های پیشین غیرقابلِ باز
//  شدن. راه‌اندازِ نصب همان پوشه را با پوشهٔ secrets/ می‌برد.
//
//  ⚠️ نسخهٔ محلیِ پشتیبان (پوشهٔ کنارِ دیتابیس) عمداً رمز نمی‌شود: دیتابیسِ
//  زنده هم همان‌جا و رمزنشده است و رمز کردنِ کپی‌اش چیزی به امنیت اضافه
//  نمی‌کرد — ولی بازگردانیِ یک‌کلیکی را کند و شکننده می‌کرد. آن‌چه از این
//  کامپیوتر **بیرون می‌رود** (صفِ offsite) همیشه رمزشده است.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { config } from '../config.js';

const MAGIC = Buffer.from('VLN1');
const NONCE = 12;
const TAG = 16;

/** پوشهٔ کلیدها — قابلِ تغییر با HLP_BACKUP_KEY_DIR (نصب‌کننده ⇒ secrets/) */
export function keyDir() {
  return path.resolve(process.env.HLP_BACKUP_KEY_DIR || path.join(config.dataDir, 'backup-keys'));
}

function which(cmd) {
  const dirs = String(process.env.PATH || '').split(path.delimiter);
  for (const d of dirs) {
    const p = path.join(d, cmd);
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch { /* بعدی */ }
  }
  return null;
}

/**
 * کدام روش؟ HLP_BACKUP_CIPHER=aes|age آن را قفل می‌کند (آزمون هر دو را می‌سنجد)؛
 * وگرنه age اگر هست، و اگر نه AES داخلی.
 */
export function cipherMethod() {
  const forced = String(process.env.HLP_BACKUP_CIPHER || '').toLowerCase();
  if (forced === 'aes' || forced === 'age') return forced;
  return which('age') && which('age-keygen') ? 'age' : 'aes';
}

function exec(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: opts.timeout || 10 * 60_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err });
    });
  });
}

async function writeSecret(file, content) {
  await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  try { await fsp.chmod(path.dirname(file), 0o700); } catch { /* ویندوز */ }
  await fsp.writeFile(file, content, { encoding: 'utf8', mode: 0o600 });
  try { await fsp.chmod(file, 0o600); } catch { /* ویندوز */ }
}

/** کلیدِ AES — ۳۲ بایت، hex، یک بار ساخته می‌شود */
async function aesKey() {
  const file = path.join(keyDir(), 'backup.aes.key');
  try {
    const hex = (await fsp.readFile(file, 'utf8')).trim();
    if (/^[0-9a-f]{64}$/i.test(hex)) return Buffer.from(hex, 'hex');
  } catch { /* هنوز نیست */ }
  const key = crypto.randomBytes(32);
  await writeSecret(file, key.toString('hex') + '\n');
  return key;
}

/** هویتِ age — فایلِ identity (خصوصی) و recipient (عمومی) */
async function ageIdentity() {
  const file = path.join(keyDir(), 'backup.age.key');
  let text = null;
  try { text = await fsp.readFile(file, 'utf8'); } catch { /* هنوز نیست */ }
  if (!text) {
    const r = await exec(which('age-keygen'), []);
    if (!r.ok || !/AGE-SECRET-KEY-1/.test(r.stdout)) {
      throw new Error(`age-keygen کار نکرد: ${r.stderr.trim() || r.error?.message || 'بی‌جواب'}`);
    }
    text = r.stdout;
    await writeSecret(file, text);
  }
  const recipient = (text.match(/public key:\s*(age1[0-9a-z]+)/i) || [])[1] || null;
  if (!recipient) throw new Error('recipientِ age در فایلِ کلید پیدا نشد');
  return { file, recipient };
}

/** وضعیت برای صفحهٔ پشتیبان‌ها: روش، محلِ کلید، و این‌که کلید هست یا نه */
export function encryptionInfo() {
  const method = cipherMethod();
  const dir = keyDir();
  const file = path.join(dir, method === 'age' ? 'backup.age.key' : 'backup.aes.key');
  let mode = null;
  try { mode = fs.statSync(file).mode & 0o777; } catch { /* نیست */ }
  return {
    method,
    label: method === 'age' ? 'age (X25519)' : 'AES-256-GCM (داخلی)',
    keyFile: file,
    keyExists: mode != null,
    keyPermsOk: mode == null ? null : process.platform === 'win32' ? true : mode === 0o600,
    extension: method === 'age' ? '.age' : '.enc',
  };
}

/** کلید را (اگر نبود) می‌سازد — تا صفحهٔ پشتیبان‌ها «آماده» را نشان دهد */
export async function ensureKey() {
  if (cipherMethod() === 'age') await ageIdentity();
  else await aesKey();
  return encryptionInfo();
}

/**
 * یک فایل را رمز می‌کند. خروجی: مسیرِ فایلِ رمزشده.
 * @param {string} src
 * @param {string} [dst] پیش‌فرض: همان مسیر + پسوندِ روش
 */
export async function encryptFile(src, dst = null) {
  const method = cipherMethod();
  const out = dst || `${src}${method === 'age' ? '.age' : '.enc'}`;
  await fsp.mkdir(path.dirname(out), { recursive: true });
  await fsp.rm(out, { force: true });

  if (method === 'age') {
    const { recipient } = await ageIdentity();
    const r = await exec(which('age'), ['-r', recipient, '-o', out, src]);
    if (!r.ok) throw new Error(`age رمز نکرد: ${r.stderr.trim() || r.error?.message}`);
    return out;
  }

  const key = await aesKey();
  const nonce = crypto.randomBytes(NONCE);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  await new Promise((resolve, reject) => {
    const w = fs.createWriteStream(out);
    w.on('error', reject);
    w.on('close', resolve);
    w.write(Buffer.concat([MAGIC, nonce]));
    const r = fs.createReadStream(src);
    r.on('error', reject);
    cipher.on('error', reject);
    // برچسبِ GCM فقط بعد از پایانِ رمزنگاری معلوم است، پس خودمان تهِ فایل می‌گذاریمش
    r.pipe(cipher).pipe(w, { end: false });
    cipher.on('end', () => w.end(cipher.getAuthTag()));
  });
  return out;
}

/**
 * فایلِ رمزشده را باز می‌کند. برچسبِ GCM اگر نخواند ⇒ خطا (فایلِ دست‌خورده
 * هرگز بی‌صدا «باز» نمی‌شود).
 */
export async function decryptFile(src, dst) {
  await fsp.mkdir(path.dirname(dst), { recursive: true });
  await fsp.rm(dst, { force: true });

  if (src.endsWith('.age')) {
    const { file } = await ageIdentity();
    const r = await exec(which('age'), ['-d', '-i', file, '-o', dst, src]);
    if (!r.ok) throw new Error(`age باز نکرد: ${r.stderr.trim() || r.error?.message}`);
    return dst;
  }

  const key = await aesKey();
  const st = await fsp.stat(src);
  if (st.size < MAGIC.length + NONCE + TAG) throw new Error('فایلِ رمزشده کوتاه‌تر از حدِ ممکن است');
  const handle = await fsp.open(src, 'r');
  try {
    const head = Buffer.alloc(MAGIC.length + NONCE);
    await handle.read(head, 0, head.length, 0);
    if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('این فایل با قالبِ پشتیبانِ پنل رمز نشده');
    const nonce = head.subarray(MAGIC.length);
    const tag = Buffer.alloc(TAG);
    await handle.read(tag, 0, TAG, st.size - TAG);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    await new Promise((resolve, reject) => {
      const r = fs.createReadStream(src, { start: head.length, end: st.size - TAG - 1 });
      const w = fs.createWriteStream(dst);
      r.on('error', reject);
      decipher.on('error', reject);
      w.on('error', reject);
      w.on('close', resolve);
      r.pipe(decipher).pipe(w);
    });
  } finally {
    await handle.close();
  }
  return dst;
}

export const ENCRYPTED_EXT = ['.age', '.enc'];
export const isEncryptedName = (name) => ENCRYPTED_EXT.some((e) => String(name).endsWith(e));
