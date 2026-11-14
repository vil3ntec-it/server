// ---------------------------------------------------------------------------
//  «دامنه‌های هر برنامه» (۱.۵۰.۹۹) — ‎/api/app-domains‎
//
//  هر برنامهٔ همین نصب (سرورِ حساب، هر سایت، پمپ‌ها — فقط داده) یک نامِ اصلی و هر چند نامِ دیگر. کارِ اصلی در `app-hosts.js`.
//  ⛔ دیدن: فقط مالک (مدیرِ دوم ۴۰۳ ‎owner_only‎). هر تغییر: مالک + احرازِ دوباره (‎reauth_required‎) — همان مرزِ «سرورهای من»،
//     و یک ردیف در دفتر (‎panel.domains.add|remove|primary‎، موفق و ناموفق). کلیدِ محلیِ همین کامپیوتر این در را **ندارد**.
//  ⛔ هیچ رازی در پاسخ نیست: فقط نام‌ها، حالتِ تونل (بی توکن/شناسه) و ‎PUBLIC_BASE_URLS‎ (فقط نشانی).
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { requireAuth, requireRole, requireRecentAuth } from '../auth.js';
import { shellAllowed } from '../lib/shell-owner.js';
import { audit } from '../lib/audit.js';
import {
  listAppHostnames, addAppHostname, removeAppHostname, setPrimaryHostname, accountPublicBaseUrls, routeMode, ownerOf,
  MAX_HOSTNAMES_PER_APP,
} from '../app-hosts.js';
import { parseHostname } from '../lib/hostname.js';

export const DOMAINS_OWNER_MESSAGE = 'افزودن و برداشتنِ دامنهٔ برنامه‌ها و سایت‌ها فقط کارِ مالکِ پنل است.';

/**
 * مالک (یا کلیدِ محلیِ همین کامپیوتر، اگر `local`) + احرازِ دوباره. پس از `requireAuth`/`requireLocalOrAuth`.
 * ⛔ ترتیب: نقش ⇒ **مالک پیش از رمز** ⇒ تازگیِ نشست.
 */
export function domainOwnerGuard(what, { local = false, reauth = true } = {}) {
  const admin = requireRole('admin');
  return (req, res, next) => {
    if (local && req.user?.local) return next();
    if (req.user?.local) return res.status(403).json({ ok: false, error: 'owner_only', message: DOMAINS_OWNER_MESSAGE });
    return admin(req, res, (err) => {
      if (err) return next(err);
      if (!shellAllowed(req.user)) {
        audit(req, 'panel.domains.owner_only', { target: what, ok: false, detail: { path: String(req.originalUrl || '').split('?')[0] } });
        return res.status(403).json({ ok: false, error: 'owner_only', message: DOMAINS_OWNER_MESSAGE });
      }
      return reauth ? requireRecentAuth(req, res, next) : next();
    });
  };
}

/** نتیجهٔ یک کار ⇒ پاسخ + دفتر */
export function sendDomainResult(req, res, action, r, { app = null, hostname = null, extra = {} } = {}) {
  audit(req, action, {
    target: [app, r?.hostname || r?.name || hostname].filter(Boolean).join(' ').slice(0, 300) || null,
    ok: Boolean(r?.ok),
    detail: { ...extra, ...(r?.ok ? {} : { error: r?.error, reason: r?.reason, rolledBack: r?.rolledBack || undefined }), ...(r?.accountRestarted ? { accountRestarted: true } : {}) },
  });
  res.setHeader('Cache-Control', 'no-store');
  if (!r?.ok) {
    const { status, ...body } = r || {};
    return res.status(status || 400).json(body);
  }
  const { status, ...body } = r;
  return res.json(body);
}

const router = Router();
router.use(requireAuth);

router.get('/', domainOwnerGuard('panel.domains', { reauth: false }), (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, apps: listAppHostnames(), route: routeMode(), publicBaseUrls: accountPublicBaseUrls(), maxPerApp: MAX_HOSTNAMES_PER_APP });
});

/** پیش‌نمایشِ یک نام (بی تغییر): شکلِ punycode، دلیلِ رد، و صاحبِ فعلی */
router.post('/check', domainOwnerGuard('panel.domains', { reauth: false }), (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const p = parseHostname(req.body?.hostname);
  if (!p.ok) return res.json({ ok: false, ...p });
  const owner = ownerOf(p.hostname);
  res.json({ ok: true, hostname: p.hostname, display: p.display, idn: p.idn, owner: owner ? { app: owner.app, label: owner.label, source: owner.source } : null });
});

router.post('/', domainOwnerGuard('panel.domains.add'), async (req, res) => {
  const app = String(req.body?.app || '');
  const r = await addAppHostname({ app, hostname: req.body?.hostname, primary: req.body?.primary === true, by: req.user?.username });
  sendDomainResult(req, res, 'panel.domains.add', r, { app, hostname: String(req.body?.hostname || ''), extra: { primary: req.body?.primary === true } });
});

router.delete('/', domainOwnerGuard('panel.domains.remove'), async (req, res) => {
  const app = String(req.body?.app ?? req.query.app ?? '');
  const hostname = String(req.body?.hostname ?? req.query.hostname ?? '');
  const r = await removeAppHostname({ app, hostname });
  sendDomainResult(req, res, 'panel.domains.remove', r, { app, hostname });
});

router.put('/primary', domainOwnerGuard('panel.domains.primary'), async (req, res) => {
  const app = String(req.body?.app || '');
  const r = await setPrimaryHostname({ app, hostname: req.body?.hostname });
  sendDomainResult(req, res, 'panel.domains.primary', r, { app, hostname: String(req.body?.hostname || '') });
});

export default router;
