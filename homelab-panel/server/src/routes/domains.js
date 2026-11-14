// دامنه‌ها: وضعیت DNS، گواهی SSL، تاریخ انقضا، سایت متصل و آنلاین/آفلاین
import { Router } from 'express';
import { requireAuth, requireWriteRole } from '../auth.js';
import { q, logEvent } from '../db.js';
import { checkDomain } from '../lib/domain-check.js';
import { apiHostFor } from '../platform/domain.js';
import { domainOwnerGuard, sendDomainResult } from './app-domains.js';
import { registerDomain, editDomain, deleteDomain } from '../app-hosts.js';

const router = Router();
router.use(requireAuth, requireWriteRole('operator'));

function rowToApi(row) {
  // آدرسی که برنامه‌ها صدا می‌زنند — خودکار از همین دامنه ساخته می‌شود
  const apiHost = apiHostFor(row.name);
  return {
    id: row.id,
    name: row.name,
    apiHost,
    apiUrl: apiHost ? `https://${apiHost}` : null,
    siteId: row.site_id,
    siteName: row.site_name || null,
    sitePort: row.site_port || null,
    note: row.note,
    createdAt: row.created_at,
    checkedAt: row.checked_at,
    dns: row.dns_status ? { status: row.dns_status, records: safeJson(row.dns_records) } : null,
    ssl: row.ssl_status
      ? {
          status: row.ssl_status,
          issuer: row.ssl_issuer,
          expiresAt: row.ssl_expires,
          daysLeft: row.ssl_expires ? Math.floor((row.ssl_expires - Date.now()) / 86400000) : null,
        }
      : null,
    registrationExpiresAt: row.reg_expires,
    registrationDaysLeft: row.reg_expires ? Math.floor((row.reg_expires - Date.now()) / 86400000) : null,
    httpStatus: row.http_status,
    online: row.http_status != null && row.http_status < 500,
  };
}

function safeJson(v) {
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

const SELECT_DOMAINS = `
  SELECT d.*, s.name AS site_name, s.port AS site_port
  FROM domains d LEFT JOIN sites s ON s.id = d.site_id`;
const listQuery = `${SELECT_DOMAINS} ORDER BY d.name COLLATE NOCASE`;
const oneQuery = `${SELECT_DOMAINS} WHERE d.name = ?`;

router.get('/', (req, res) => {
  res.json({ domains: q(listQuery).all().map(rowToApi) });
});

/*
 *  ⛔ (۱.۵۰.۹۹) ثبت، عوض کردنِ نام/سایت و حذفِ دامنه فقط مالک + احرازِ دوباره، با ردیفِ دفتر (‎panel.domains.*‎). هر سه از
 *  همان راهِ اتمیِ ‎app-hosts.js‎: سنجشِ سخت (punycode، بی ستاره…)، «یک نام یک صاحب»، آخرین نامِ برنامهٔ روشن ⇒ ۴۰۹، و نوشتنِ
 *  ناموفقِ مسیرِ تونل ⇒ همه برمی‌گردد (۵۰۲). دامنهٔ ریشه (بی سایت) هم ‎api./admin.‎ ِ خودکار می‌سازد ⇒ همان مرز.
 *  جابه‌جاییِ عمدیِ یک دامنه از سایتی به سایتِ دیگر (‎siteId‎) همین‌جا می‌ماند — کارِ آگاهانهٔ مالک، نه «کندن» ِ بی‌صدا.
 */
const legacyCode = (r) => (r.error === 'invalid_hostname' ? { ...r, error: 'invalid_domain', reason: r.reason } : r);

router.post('/', domainOwnerGuard('panel.domains.add'), async (req, res) => {
  const r = legacyCode(await registerDomain({ name: req.body?.name, siteId: req.body?.siteId || null, note: req.body?.note || null }));
  if (r.ok) {
    const apiHost = apiHostFor(r.name);
    logEvent('info', 'panel', apiHost ? `دامنهٔ ${r.name} اضافه شد — آدرسِ API: https://${apiHost}` : `دامنهٔ ${r.name} اضافه شد`);
    r.domain = rowToApi(q(oneQuery).get(r.name));
  }
  sendDomainResult(req, res, 'panel.domains.add', r, { hostname: String(req.body?.name || ''), extra: { siteId: req.body?.siteId || null } });
});

/**
 * تغییر دامنه: هم می‌شود سایتِ مقصد را عوض کرد (همین دامنه، سایتِ دیگر)،
 * هم خودِ نامِ دامنه را. بعدش مسیرهای تونل هم خودکار بازنویسی می‌شود.
 */
router.put('/:id', domainOwnerGuard('panel.domains.edit'), async (req, res) => {
  const body = req.body || {};
  const r = legacyCode(await editDomain(req.params.id, {
    name: 'name' in body ? body.name : undefined,
    siteId: 'siteId' in body ? body.siteId : undefined,
    note: 'note' in body ? body.note : undefined,
  }));
  if (r.ok) r.domain = rowToApi(q(oneQuery).get(r.name));
  sendDomainResult(req, res, 'panel.domains.edit', r, { hostname: String(body.name || req.params.id), extra: { id: Number(req.params.id), siteId: body.siteId } });
});

router.delete('/:id', domainOwnerGuard('panel.domains.remove'), async (req, res) => {
  const r = await deleteDomain(req.params.id);
  sendDomainResult(req, res, 'panel.domains.remove', r, { hostname: String(req.params.id) });
});

// بررسی واقعی و ذخیرهٔ نتیجه
async function runCheck(row) {
  const result = await checkDomain(row.name, { whois: true });
  q(
    `UPDATE domains SET checked_at = ?, dns_status = ?, dns_records = ?, ssl_status = ?,
       ssl_issuer = ?, ssl_expires = ?, reg_expires = ?, http_status = ? WHERE id = ?`
  ).run(
    result.checkedAt,
    result.dns.status,
    JSON.stringify({ a: result.dns.a, cname: result.dns.cname, ns: result.dns.ns }),
    result.ssl.status,
    result.ssl.issuer,
    result.ssl.expiresAt,
    result.whois.expiresAt,
    result.http?.status ?? null,
    row.id
  );
  return result;
}

router.post('/:id/check', async (req, res) => {
  const row = q('SELECT * FROM domains WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'not_found' });
  try {
    const result = await runCheck(row);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/check-all', async (req, res) => {
  const rows = q('SELECT * FROM domains').all();
  const results = [];
  for (const row of rows) {
    try {
      results.push({ domain: row.name, ...(await runCheck(row)) });
    } catch (e) {
      results.push({ domain: row.name, error: e.message });
    }
  }
  res.json({ ok: true, results, domains: q(listQuery).all().map(rowToApi) });
});

export default router;
