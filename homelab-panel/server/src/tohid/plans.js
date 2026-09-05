// ---------------------------------------------------------------------------
//  قیمت‌نامه — همان چیزی که برنامه در صفحهٔ «خرید اشتراک» نشان می‌دهد
// ---------------------------------------------------------------------------
import { db } from '../db.js';
import { readTohidSettings } from './settings.js';
import { PAID, daysToMs } from './subscriptions.js';

const DAY = 24 * 60 * 60 * 1000;

const parse = (raw, fallback) => {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : fallback;
  } catch { return fallback; }
};

export function listPlans({ includeInactive = false } = {}) {
  const rows = db.prepare(
    `SELECT * FROM th_plans ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY sort, id`,
  ).all();
  return rows.map((r) => ({ ...r, features: parse(r.features, PAID.slice()) }));
}

function waUrl(number, message) {
  const digits = String(number || '').replace(/\D/g, '');
  if (!digits) return '';
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/**
 * تخفیفِ یک پلن، همین حالا.
 *
 * ── چرا قیمتِ اصلی دست نمی‌خورد ────────────────────────────────────
 * تخفیف کنارِ قیمت می‌نشیند، نه به‌جایش. پس وقتی مهلتش تمام شد، قیمتِ
 * خودش برمی‌گردد و کسی لازم نیست عددِ قبلی را به یاد داشته باشد.
 * برنامه هم می‌تواند هر دو را نشان بدهد: خط‌خورده و تازه.
 *
 * دو راه هست و اگر هر دو پر باشند، «قیمتِ تخفیفی» می‌چربد — عددِ صریح
 * از درصد روشن‌تر است و اشتباهِ گِردکردن ندارد.
 */
export function discountOf(row, at = Date.now()) {
  const price = Number(row.price) || 0;
  const until = row.discount_until === null || row.discount_until === undefined
    ? null : Number(row.discount_until);
  const expired = until !== null && until < at;
  const percent = Number(row.discount_percent) || 0;
  const fixed = row.discount_price === null || row.discount_price === undefined
    ? null : Number(row.discount_price);

  const none = { price, finalPrice: price, discounted: false, percent: 0, savings: 0, label: '', until };
  if (expired || (percent <= 0 && fixed === null)) return none;

  const finalPrice = fixed !== null
    ? Math.max(0, fixed)
    : Math.max(0, Math.round((price * (100 - percent)) / 100));

  //  اگر «تخفیف» گران‌تر یا مساوی درآمد، تخفیفی در کار نیست
  if (finalPrice >= price) return none;

  return {
    price,
    finalPrice,
    discounted: true,
    //  درصدِ واقعی، حتی وقتی مدیر قیمتِ ثابت گذاشته — برای نشانِ «٪۲۰»
    percent: price > 0 ? Math.round(((price - finalPrice) * 100) / price) : 0,
    savings: price - finalPrice,
    label: row.discount_label || '',
    until,
  };
}

/**
 * پاسخِ قیمت‌نامه — همان شکلی که برنامه و سایت می‌خوانند.
 *
 * `price` چیزی است که باید پرداخت شود و `fullPrice` قیمتِ پیش از تخفیف.
 * این‌طور نسخه‌های قدیمِ برنامه — که تخفیف را نمی‌شناسند — هم عددِ درست
 * را نشان می‌دهند، نه قیمتِ گران‌ترِ بی‌تخفیف.
 */
export function plansPayload() {
  const cfg = readTohidSettings();
  const rows = listPlans();
  const at = Date.now();

  return {
    currency: cfg.currency,
    trialDays: Number(cfg.trialDays || 0) || 0,
    plans: rows.map((p) => {
      const d = discountOf(p, at);
      const days = Math.round(daysToMs(p.amount, p.unit) / DAY);
      const perDay = !p.negotiable && days > 0 && d.finalPrice > 0
        ? Math.round((d.finalPrice / days) * 10) / 10
        : null;
      return {
        code: p.code,
        title: p.title,
        amount: p.amount,
        unit: p.unit,
        price: d.finalPrice,
        fullPrice: d.price,
        discount: d.discounted
          ? { percent: d.percent, savings: d.savings, label: d.label, until: d.until }
          : null,
        negotiable: Boolean(p.negotiable),
        badge: p.badge || '',
        features: p.features,
        active: Boolean(p.active),
        days,
        approxDays: days,
        pricePerDay: perDay,
        whatsappUrl: waUrl(cfg.whatsapp, `${cfg.purchaseMessage} (${p.title})`),
      };
    }),
    whatsapp: {
      number: cfg.whatsapp || '',
      message: cfg.purchaseMessage || '',
      url: waUrl(cfg.whatsapp, cfg.purchaseMessage),
    },
  };
}

/**
 * گذاشتن یا برداشتنِ تخفیف.
 *
 * `percent = 0` و `price = null` یعنی برداشتنش — قیمت به همان عددِ اصلی
 * برمی‌گردد.
 */
export function setDiscount(code, { percent = 0, price = null, label = '', until = null } = {}) {
  const plan = planByCode(code);
  if (!plan) { const e = new Error('پلن پیدا نشد'); e.code = 'not_found'; throw e; }

  const pct = Math.max(0, Math.min(95, Math.round(Number(percent) || 0)));
  const fixed = price === null || price === undefined || price === ''
    ? null : Math.max(0, Number(price));
  if (fixed !== null && fixed >= Number(plan.price)) {
    const e = new Error('قیمت با تخفیف باید کمتر از قیمت اصلی باشد');
    e.code = 'bad_discount';
    throw e;
  }
  const end = until === null || until === undefined || until === '' ? null : Number(until);
  if (end !== null && end <= Date.now()) {
    const e = new Error('مهلت تخفیف باید در آینده باشد');
    e.code = 'bad_until';
    throw e;
  }

  db.prepare(`
    UPDATE th_plans SET discount_percent = ?, discount_price = ?, discount_label = ?, discount_until = ?
     WHERE code = ?
  `).run(pct, fixed, String(label || ''), end, code);

  return planByCode(code);
}

export function clearDiscount(code) {
  db.prepare(`
    UPDATE th_plans SET discount_percent = 0, discount_price = NULL,
           discount_label = NULL, discount_until = NULL
     WHERE code = ?
  `).run(code);
  return planByCode(code);
}

export function upsertPlan(plan) {
  const code = String(plan.code || '').trim();
  if (!code) throw Object.assign(new Error('کد پلن لازم است'), { code: 'code_required' });
  const features = JSON.stringify(
    Array.isArray(plan.features) ? plan.features.filter((f) => PAID.includes(f)) : PAID.slice(),
  );
  const existing = db.prepare('SELECT id FROM th_plans WHERE code = ?').get(code);

  if (existing) {
    db.prepare(`
      UPDATE th_plans SET title = ?, amount = ?, unit = ?, price = ?, negotiable = ?,
        badge = ?, features = ?, max_devices = ?, sort = ?, active = ? WHERE code = ?
    `).run(
      String(plan.title || code), Number(plan.amount) || 1, String(plan.unit || 'month'),
      Number(plan.price) || 0, plan.negotiable ? 1 : 0, String(plan.badge || ''),
      features, Number(plan.maxDevices) || 1, Number(plan.sort) || 0,
      plan.active === false ? 0 : 1, code,
    );
  } else {
    db.prepare(`
      INSERT INTO th_plans (code, title, amount, unit, price, negotiable, badge, features, max_devices, sort, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      code, String(plan.title || code), Number(plan.amount) || 1, String(plan.unit || 'month'),
      Number(plan.price) || 0, plan.negotiable ? 1 : 0, String(plan.badge || ''),
      features, Number(plan.maxDevices) || 1, Number(plan.sort) || 0, plan.active === false ? 0 : 1,
    );
  }
  return db.prepare('SELECT * FROM th_plans WHERE code = ?').get(code);
}

export function deletePlan(code) {
  db.prepare('DELETE FROM th_plans WHERE code = ?').run(String(code));
  return { ok: true };
}

export function planByCode(code) {
  const row = db.prepare('SELECT * FROM th_plans WHERE code = ?').get(String(code));
  return row ? { ...row, features: parse(row.features, PAID.slice()) } : null;
}
