// ---------------------------------------------------------------------------
//  کد اشتراک — شش رقم که اشتراک را فعال می‌کند
//
//  ── مشکلی که این حل می‌کند ────────────────────────────────────────────
//  تا امروز برای دادنِ اشتراک به کسی باید حسابش را در پنل پیدا می‌کردید و
//  دستی تمدید می‌زدید. یعنی طرف باید اول ثبت‌نام می‌کرد، بعد به شما خبر
//  می‌داد، و شما هم باید همان لحظه پشتِ پنل بودید.
//
//  حالا: کد می‌سازید و ایمیلِ طرف را می‌نویسید. سرور **خودش** کد را ایمیل
//  می‌کند. طرف هر وقت خواست همان شش رقم را در برنامه یا سایت می‌زند و
//  اشتراکش فعال می‌شود. شما دیگر واسطه نیستید.
//
//  ── چرا کد در دیتابیس نیست ────────────────────────────────────────────
//  فقط HMACش ذخیره می‌شود. پس کسی که به فایلِ دیتابیس دست پیدا کند
//  نمی‌تواند کدها را بردارد و برای خودش اشتراک بسازد.
//
//  ── چرا شش رقم و نه چیزی درازتر ───────────────────────────────────────
//  چون قرار است کسی آن را از روی ایمیل بخواند و در گوشی تایپ کند. سدّ
//  امنیتی‌اش تعدادِ رقم نیست: هر کد یک بار مصرف است، مهلت دارد، و مسیرِ
//  خرج کردنش محدودِ نرخ است — پس حدس زدنِ شش رقم عملاً ناممکن می‌ماند.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import { db, getSetting, setSetting } from '../db.js';
import { sendMail } from './smtp.js';
import { mailSettings, mailConfigured } from './settings.js';
import { planByCode } from './plans.js';
import { grantSubscription, daysToMs } from './subscriptions.js';

const DAY = 24 * 60 * 60 * 1000;
const DIGITS = 6;

/** رازِ HMACِ کدها — جدا از رازِ توکن‌ها، یک بار ساخته و نگه داشته می‌شود */
function pepper() {
  let s = getSetting('tohid_vip_pepper', null);
  if (!s) {
    s = crypto.randomBytes(32).toString('hex');
    setSetting('tohid_vip_pepper', s);
  }
  return s;
}

const newId = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
const normalize = (raw) => String(raw ?? '').replace(/\D/g, '');
const hashCode = (raw) =>
  crypto.createHmac('sha256', pepper()).update(normalize(raw)).digest('hex');

function randomCode() {
  //  رقم اول صفر نباشد تا کد کوتاه به نظر نرسد
  let s = String(crypto.randomInt(1, 10));
  for (let i = 1; i < DIGITS; i++) s += String(crypto.randomInt(10));
  return s;
}

const fail = (message, code) => {
  const e = new Error(message);
  e.code = code;
  return e;
};

/** ردیفِ دیتابیس → چیزی که برنامهٔ مدیریت می‌بیند. کدِ خام هرگز اینجا نیست. */
function shape(row) {
  if (!row) return null;
  return {
    id: row.code_id,
    hint: row.code_hint,
    plan: row.plan,
    days: row.days === null ? null : Number(row.days),
    note: row.note || '',
    email: row.email || '',
    emailStatus: row.email_status,
    emailError: row.email_error || '',
    emailSentAt: row.email_sent_at || null,
    accountId: row.account_id || '',
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at || null,
    usedAt: row.used_at || null,
    usedBy: row.used_by || '',
  };
}

/**
 * ساختِ کد.
 *
 * `days` اگر نیامده باشد از مدتِ پلن حساب می‌شود — پس مدیر می‌تواند فقط
 * بگوید «شش ماهه» و لازم نباشد ۱۸۰ را خودش بشمارد.
 *
 * کدِ خام فقط همین یک بار برمی‌گردد؛ بعد از آن حتی سرور هم نمی‌تواند
 * نشانش بدهد.
 */
export function createVipCode({
  plan = 'custom', days = null, note = '', email = '',
  accountId = null, expiresInDays = 30, createdBy = '',
} = {}) {
  let finalDays = days === null || days === undefined || days === '' ? null : Number(days);
  if (!finalDays) {
    const p = planByCode(plan);
    if (p) finalDays = Math.round(daysToMs(p.amount, p.unit) / DAY);
  }
  if (!finalDays || finalDays < 1) finalDays = 30;

  const now = Date.now();
  const expiresAt = Number(expiresInDays) > 0 ? now + Number(expiresInDays) * DAY : null;

  for (let attempt = 0; attempt < 12; attempt++) {
    const code = randomCode();
    const codeHash = hashCode(code);
    const clash = db.prepare('SELECT 1 AS x FROM th_vip_codes WHERE code_hash = ?').get(codeHash);
    if (clash) continue;

    const codeId = newId('vip');
    db.prepare(`
      INSERT INTO th_vip_codes
        (code_id, code_hash, code_hint, plan, days, note, email, email_status,
         account_id, created_by, created_at, expires_at, status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'active')
    `).run(
      codeId, codeHash, code.slice(-2), String(plan), finalDays, String(note || ''),
      String(email || '').trim().toLowerCase(), email ? 'queued' : 'none',
      accountId || null, String(createdBy || ''), now, expiresAt,
    );

    return { code, row: shape(rowById(codeId)) };
  }
  throw fail('ساخت کد یکتا ممکن نشد، دوباره تلاش کنید', 'code_generation_failed');
}

const rowById = (codeId) =>
  db.prepare('SELECT * FROM th_vip_codes WHERE code_id = ?').get(codeId) || null;

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/**
 * فرستادنِ کد به ایمیلِ گیرنده.
 *
 * نتیجه — رفت یا نرفت و اگر نرفت چرا — در همان ردیف می‌نشیند. بدونِ این،
 * مدیر «ساخته شد» می‌دید و نمی‌فهمید ایمیل اصلاً بیرون نرفته.
 */
export async function mailVipCode(codeId, code, { appName = 'توحید' } = {}) {
  const row = rowById(codeId);
  if (!row) throw fail('کد پیدا نشد', 'not_found');
  if (!row.email) return shape(row);

  if (!mailConfigured()) {
    db.prepare(`UPDATE th_vip_codes SET email_status='failed', email_error=? WHERE code_id=?`)
      .run('ایمیل سرور تنظیم نشده است', codeId);
    return shape(rowById(codeId));
  }

  const days = Number(row.days) || 30;
  const planTitle = planByCode(row.plan)?.title || row.plan;
  const until = row.expires_at
    ? new Date(row.expires_at).toLocaleDateString('fa-IR')
    : null;

  const text = [
    'سلام،',
    '',
    `یک اشتراک ${planTitle} (${days} روز) برای شما فعال شده است.`,
    '',
    `کد شما: ${code}`,
    '',
    'برنامه را باز کنید، به بخش اشتراک بروید و همین کد را وارد کنید.',
    until ? `این کد تا ${until} معتبر است.` : '',
    row.note ? `\n${row.note}` : '',
  ].filter(Boolean).join('\n');

  const html = `<div dir="rtl" style="background:#f8fafc;padding:28px 12px;font-family:Tahoma,Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:18px;
              border:1px solid #e2e8f0;padding:28px 24px;color:#0f172a">
    <h1 style="margin:0 0 12px;font-size:20px">اشتراک شما آماده است</h1>
    <p style="margin:0 0 8px;font-size:15px;line-height:2;color:#334155">
      یک اشتراک <b>${escapeHtml(planTitle)}</b> به مدت <b>${days} روز</b> برای شما در نظر گرفته شده.
      این کد را در برنامه یا سایت وارد کنید:
    </p>
    <div style="margin:24px 0;text-align:center">
      <div style="display:inline-block;font-size:34px;letter-spacing:10px;font-weight:700;
                  color:#0f172a;background:#f1f5f9;border-radius:14px;padding:16px 26px;
                  font-family:monospace">${code}</div>
    </div>
    <div style="font-size:14px;line-height:2;color:#475569">
      <b>چطور استفاده کنم؟</b><br>
      برنامه را باز کنید ← بخش اشتراک ← «کد اشتراک دارم» ← همین شش رقم را بزنید.
      ${row.note ? `<br><br>${escapeHtml(row.note)}` : ''}
    </div>
    <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;line-height:2">
      ${until ? `این کد یک بار مصرف است و تا ${until} کار می‌کند.` : 'این کد یک بار مصرف است.'}
    </p>
  </div>
</div>`;

  try {
    await sendMail(mailSettings(), {
      to: row.email,
      subject: `کد اشتراک ${appName}`,
      text,
      html,
    });
    db.prepare(`UPDATE th_vip_codes SET email_status='sent', email_sent_at=?, email_error='' WHERE code_id=?`)
      .run(Date.now(), codeId);
  } catch (e) {
    db.prepare(`UPDATE th_vip_codes SET email_status='failed', email_error=? WHERE code_id=?`)
      .run(String(e.message || e).slice(0, 400), codeId);
  }
  return shape(rowById(codeId));
}

export function listVipCodes({ status = '', limit = 100 } = {}) {
  const rows = status
    ? db.prepare('SELECT * FROM th_vip_codes WHERE status = ? ORDER BY created_at DESC LIMIT ?')
      .all(String(status), Number(limit) || 100)
    : db.prepare('SELECT * FROM th_vip_codes ORDER BY created_at DESC LIMIT ?')
      .all(Number(limit) || 100);
  return rows.map(shape);
}

export function revokeVipCode(codeId) {
  const row = rowById(codeId);
  if (!row || row.status !== 'active') {
    throw fail('کد پیدا نشد یا از قبل خرج شده است', 'not_found');
  }
  db.prepare(`UPDATE th_vip_codes SET status='revoked' WHERE code_id=?`).run(codeId);
  return shape(rowById(codeId));
}

/** چند کدِ زنده — برای صفحهٔ خانهٔ برنامهٔ مدیریت */
export function activeVipCount() {
  return db.prepare(`SELECT COUNT(*) AS n FROM th_vip_codes WHERE status='active'`).get().n;
}

/**
 * خرج کردنِ کد — اشتراک را روی حسابِ همین کاربر می‌نشاند.
 *
 * SQLite تک‌نویسنده است و این تابع همگام اجرا می‌شود، پس دو نفر همزمان
 * نمی‌توانند یک کد را خرج کنند: تغییرِ وضعیت پیش از صدور اشتراک انجام
 * می‌شود و دومی «قبلاً استفاده شده» می‌گیرد.
 */
export function redeemVipCode(rawCode, { accountId, actor = '' } = {}) {
  const clean = normalize(rawCode);
  if (clean.length !== DIGITS) throw fail('کد باید شش رقم باشد', 'bad_code');
  if (!accountId) throw fail('اول وارد حساب شوید', 'unauthorized');

  const row = db.prepare('SELECT * FROM th_vip_codes WHERE code_hash = ?').get(hashCode(clean));
  if (!row) throw fail('این کد معتبر نیست', 'bad_code');
  if (row.status === 'used') throw fail('این کد قبلاً استفاده شده است', 'code_used');
  if (row.status !== 'active') throw fail('این کد دیگر کار نمی‌کند', 'code_inactive');
  if (row.expires_at && Number(row.expires_at) < Date.now()) {
    db.prepare(`UPDATE th_vip_codes SET status='expired' WHERE code_id=?`).run(row.code_id);
    throw fail('مهلت این کد تمام شده است', 'code_expired');
  }
  if (row.account_id && row.account_id !== accountId) {
    throw fail('این کد برای حساب دیگری صادر شده است', 'code_other_account');
  }

  //  اول کد را می‌بندیم، بعد اشتراک می‌دهیم. اگر ترتیب برعکس بود و صدورِ
  //  اشتراک نیمه‌کاره می‌ماند، کد هم خرج شده بود هم اشتراکی نداده بود.
  db.prepare(`UPDATE th_vip_codes SET status='used', used_at=?, used_by=? WHERE code_id=?`)
    .run(Date.now(), accountId, row.code_id);

  try {
    const days = Number(row.days) || 30;
    const p = planByCode(row.plan);
    const sub = grantSubscription({
      accountId,
      planCode: row.plan,
      planTitle: p?.title || row.plan,
      //  کد روزشمار است، نه ماه‌شمار: مدیر ممکن است «۴۵ روز» داده باشد
      amount: days,
      unit: 'day',
      maxDevices: p?.max_devices || 1,
      note: row.note || `کد اشتراک ${row.code_hint}`,
      actor: actor || row.created_by || 'vip-code',
    });
    return { subscription: sub, plan: row.plan, days };
  } catch (e) {
    //  صدور نشد — کد را برمی‌گردانیم تا هدر نرود
    db.prepare(`UPDATE th_vip_codes SET status='active', used_at=NULL, used_by='' WHERE code_id=?`)
      .run(row.code_id);
    throw e;
  }
}
