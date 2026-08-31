// ---------------------------------------------------------------------------
//  دادهٔ یک پروژه — بیرون کشیدن و برگرداندن
//
//  هر بکاپ، علاوه بر فایل‌ها، ردیف‌های دیتابیسِ همان پروژه را هم می‌برد:
//  IPها، پورت‌ها، Endpointها، دامنه‌ها، مسیرها، کاربران، فروشگاه‌ها،
//  اشتراک‌ها، انتشارها و پیکربندی‌ها.
//
//  موقعِ برگرداندن، project_id به‌زور روی پروژهٔ مقصد نوشته می‌شود؛ پس هیچ
//  ردیفی نمی‌تواند به پروژهٔ دیگری سرک بکشد — حتی اگر فایلِ بکاپ دست‌کاری شده باشد.
// ---------------------------------------------------------------------------
import { db } from '../db.js';

/** جدول‌هایی که دادهٔ پروژه در آن‌هاست، به ترتیبِ وابستگی */
export const PROJECT_TABLES = [
  { table: 'cc_ips', order: 'id' },
  { table: 'cc_ports', order: 'id' },
  { table: 'cc_endpoints', order: 'id' },
  { table: 'cc_shops', order: 'id' },
  { table: 'cc_app_users', order: 'id' },
  { table: 'cc_subscriptions', order: 'id' },
  { table: 'cc_releases', order: 'id' },
  { table: 'cc_configs', order: 'id' },
  { table: 'cc_routes', order: 'id' },
  { table: 'cc_tunnels', order: 'id' },
  { table: 'domains', order: 'id' },
];

function columnsOf(table) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);
}

/** همهٔ ردیف‌های یک پروژه — نه یک ردیفِ بیشتر */
export function exportProjectData(project) {
  const out = { project_id: project.project_id, slug: project.slug, exported_at: Date.now(), tables: {} };
  for (const { table, order } of PROJECT_TABLES) {
    try {
      out.tables[table] = db.prepare(`SELECT * FROM ${table} WHERE project_id = ? ORDER BY ${order}`).all(project.id);
    } catch {
      out.tables[table] = [];
    }
  }
  // مسیرهای تونل از راهِ خودِ تونل‌های همین پروژه
  const tunnelIds = (out.tables.cc_tunnels || []).map((t) => t.id);
  out.tables.cc_tunnel_routes = tunnelIds.length
    ? db
        .prepare(`SELECT * FROM cc_tunnel_routes WHERE tunnel_id IN (${tunnelIds.map(() => '?').join(',')})`)
        .all(...tunnelIds)
    : [];

  // رازها فقط با نام و نوع — مقدارشان با کلیدِ همین سرور رمز شده و
  // بردنش به سرورِ دیگر بی‌فایده است. آدم می‌داند چه چیزی باید دوباره وارد کند.
  out.secrets = db
    .prepare('SELECT name, kind, scope, hint, note FROM cc_secrets WHERE project_id = ?')
    .all(project.id);

  out.counts = Object.fromEntries(Object.entries(out.tables).map(([k, v]) => [k, v.length]));
  return out;
}

/**
 * ردیف‌ها را برمی‌گرداند. جدول‌های خودِ پروژه اول خالی و بعد پر می‌شوند تا
 * چیزی دوتایی نشود. شناسه‌های داخلی از نو ساخته می‌شوند.
 */
export function importProjectData(project, data, { replace = true } = {}) {
  if (!data?.tables) throw new Error('no_tables');
  const report = {};

  const apply = db.prepare('SELECT 1'); // فقط برای اطمینان از باز بودنِ دیتابیس
  apply.get();

  db.exec('BEGIN IMMEDIATE');
  try {
    if (replace) {
      for (const { table } of [...PROJECT_TABLES].reverse()) {
        try {
          db.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(project.id);
        } catch { /* جدول شاید نباشد */ }
      }
    }

    // نگاشتِ شناسهٔ قدیم → جدید، برای وابستگی‌های داخلی
    const idMap = { cc_shops: new Map(), cc_app_users: new Map(), cc_tunnels: new Map(), domains: new Map() };

    for (const { table } of PROJECT_TABLES) {
      const rows = data.tables[table] || [];
      const cols = new Set(columnsOf(table));
      let inserted = 0;

      for (const row of rows) {
        const payload = {};
        for (const [key, value] of Object.entries(row)) {
          if (key === 'id' || !cols.has(key)) continue;
          payload[key] = value;
        }
        payload.project_id = project.id; // ← مرزِ پروژه، بی‌چون‌وچرا

        // وابستگی‌ها به شناسه‌های تازه اشاره کنند
        if (cols.has('shop_id') && row.shop_id != null) payload.shop_id = idMap.cc_shops.get(row.shop_id) ?? null;
        if (cols.has('user_id') && row.user_id != null) payload.user_id = idMap.cc_app_users.get(row.user_id) ?? null;
        if (cols.has('tunnel_id') && row.tunnel_id != null) payload.tunnel_id = idMap.cc_tunnels.get(row.tunnel_id) ?? null;
        if (cols.has('domain_id') && row.domain_id != null) payload.domain_id = idMap.domains.get(row.domain_id) ?? null;

        const keys = Object.keys(payload);
        if (!keys.length) continue;
        try {
          const info = db
            .prepare(`INSERT OR IGNORE INTO ${table}(${keys.join(', ')}) VALUES(${keys.map(() => '?').join(', ')})`)
            .run(...keys.map((k) => normalize(payload[k])));
          if (info.changes) {
            inserted++;
            if (idMap[table]) idMap[table].set(row.id, Number(info.lastInsertRowid));
          }
        } catch {
          /* یک ردیفِ خراب نباید کلِ بازگردانی را بخواباند */
        }
      }
      report[table] = inserted;
    }

    // مسیرهای تونل بعد از خودِ تونل‌ها
    let routes = 0;
    for (const row of data.tables.cc_tunnel_routes || []) {
      const tunnelId = idMap.cc_tunnels.get(row.tunnel_id);
      if (!tunnelId) continue;
      try {
        db.prepare(
          'INSERT OR IGNORE INTO cc_tunnel_routes(tunnel_id, hostname, service, project_id, created_at) VALUES(?,?,?,?,?)'
        ).run(tunnelId, row.hostname, row.service, project.id, row.created_at || Date.now());
        routes++;
      } catch { /* تکراری */ }
    }
    report.cc_tunnel_routes = routes;

    db.exec('COMMIT');
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch { /* از قبل برگشته */ }
    throw e;
  }

  return report;
}

function normalize(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}
