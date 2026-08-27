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

/** پاسخِ /api/v1/billing/plans — دقیقاً شکلی که برنامه می‌خواند */
export function plansPayload() {
  const cfg = readTohidSettings();
  const rows = listPlans();

  return {
    currency: cfg.currency,
    plans: rows.map((p) => {
      const days = Math.round(daysToMs(p.amount, p.unit) / DAY);
      const perDay = !p.negotiable && days > 0 && p.price > 0
        ? Math.round((p.price / days) * 10) / 10
        : null;
      return {
        code: p.code,
        title: p.title,
        amount: p.amount,
        unit: p.unit,
        price: p.price,
        negotiable: Boolean(p.negotiable),
        badge: p.badge || '',
        features: p.features,
        approxDays: days,
        pricePerDay: perDay,
        whatsappUrl: waUrl(cfg.whatsapp, `${cfg.purchaseMessage} (${p.title})`),
      };
    }),
    whatsapp: { number: cfg.whatsapp || '', url: waUrl(cfg.whatsapp, cfg.purchaseMessage) },
  };
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
