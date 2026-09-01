// دامنه‌ها: وضعیت DNS، گواهی SSL، تاریخ انقضا، سایت متصل و آنلاین/آفلاین
import { Router } from 'express';
import { requireAuth, requireWriteRole } from '../auth.js';
import { q, db, logEvent } from '../db.js';
import { checkDomain } from '../lib/domain-check.js';
import { normalizeDomain } from '../sites/registry.js';
import { syncTunnelRoutes } from '../tunnel.js';
import { apiHostFor } from '../platform/domain.js';

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

/** دامنهٔ اصلیِ هر سایت را با جدول دامنه‌ها هم‌خط نگه می‌دارد */
function refreshPrimaryDomain(siteId) {
  if (!siteId) return;
  const site = q('SELECT id, domain FROM sites WHERE id = ?').get(Number(siteId));
  if (!site) return;
  const own = q('SELECT name FROM domains WHERE site_id = ? ORDER BY name COLLATE NOCASE')
    .all(site.id)
    .map((r) => r.name);
  const next = own.includes(site.domain) ? site.domain : (own[0] ?? null);
  if (next !== site.domain) {
    q('UPDATE sites SET domain = ?, updated_at = ? WHERE id = ?').run(next, Date.now(), site.id);
  }
}

router.post('/', (req, res) => {
  const name = normalizeDomain(req.body?.name);
  if (!name) return res.status(400).json({ error: 'invalid_domain' });
  const exists = q('SELECT id FROM domains WHERE name = ?').get(name);
  if (exists) return res.status(409).json({ error: 'already_exists' });
  const siteId = req.body?.siteId ? Number(req.body.siteId) : null;
  q('INSERT INTO domains(name, site_id, note, created_at) VALUES(?, ?, ?, ?)').run(
    name,
    siteId,
    req.body?.note || null,
    Date.now()
  );
  refreshPrimaryDomain(siteId);
  const apiHost = apiHostFor(name);
  logEvent(
    'info',
    'panel',
    apiHost ? `دامنهٔ ${name} اضافه شد — آدرسِ API: https://${apiHost}` : `دامنهٔ ${name} اضافه شد`
  );
  syncTunnelRoutes().catch(() => {});
  res.json({ ok: true, domain: rowToApi(q(oneQuery).get(name)) });
});

/**
 * تغییر دامنه: هم می‌شود سایتِ مقصد را عوض کرد (همین دامنه، سایتِ دیگر)،
 * هم خودِ نامِ دامنه را. بعدش مسیرهای تونل هم خودکار بازنویسی می‌شود.
 */
router.put('/:id', (req, res) => {
  const row = q('SELECT * FROM domains WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'not_found' });

  let name = row.name;
  if ('name' in (req.body || {})) {
    const next = normalizeDomain(req.body.name);
    if (!next) return res.status(400).json({ error: 'invalid_domain' });
    if (next !== row.name) {
      const clash = q('SELECT id FROM domains WHERE name = ? AND id <> ?').get(next, row.id);
      if (clash) return res.status(409).json({ error: 'already_exists' });
      name = next;
    }
  }

  const siteId =
    'siteId' in (req.body || {})
      ? req.body.siteId
        ? Number(req.body.siteId)
        : null
      : row.site_id;

  q('UPDATE domains SET name = ?, site_id = ?, note = ? WHERE id = ?').run(
    name,
    siteId,
    req.body?.note ?? row.note,
    row.id
  );

  // اگر دامنه از سایتی به سایت دیگر رفت، هر دو طرف باید بروز شوند
  refreshPrimaryDomain(row.site_id);
  refreshPrimaryDomain(siteId);

  if (name !== row.name || siteId !== row.site_id) {
    const to = siteId ? q('SELECT name FROM sites WHERE id = ?').get(siteId)?.name : null;
    logEvent(
      'info',
      'panel',
      to ? `دامنهٔ ${name} از این پس به سایت «${to}» می‌رود` : `دامنهٔ ${name} به هیچ سایتی وصل نیست`,
      siteId
    );
    syncTunnelRoutes().catch(() => {});
  }

  res.json({ ok: true, domain: rowToApi(q(oneQuery).get(name)) });
});

router.delete('/:id', (req, res) => {
  const row = q('SELECT * FROM domains WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'not_found' });
  q('DELETE FROM domains WHERE id = ?').run(row.id);
  refreshPrimaryDomain(row.site_id);
  logEvent('warn', 'panel', `دامنهٔ ${row.name} حذف شد`);
  syncTunnelRoutes().catch(() => {});
  res.json({ ok: true });
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
