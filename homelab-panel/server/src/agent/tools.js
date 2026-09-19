// ---------------------------------------------------------------------------
//  ابزارهای دستیار — چشم‌ها و دست‌های ایجنت روی همین سرور
//
//  دو دسته، و مرزشان قانونِ طلاییِ پرامپت است:
//
//    read     فقط می‌خواند؛ مدل هر وقت لازم داشت خودش صدا می‌زند.
//    confirm  چیزی را عوض می‌کند؛ مدل فقط **پیشنهاد** می‌دهد (agent_actions)
//             و اجرا فقط با تأییدِ آدم از پنل است — و در Audit Log می‌نشیند.
//
//  ⛔ ابزارِ `confirm` هیچ‌وقت از داخلِ حلقهٔ مدل اجرا نمی‌شود؛ `runTool`
//     برایش فقط یک پیشنهاد می‌سازد. اجرا تنها از `executeAction` است که
//     routes/agent.js پس از تأیید صدا می‌زند.
//  ⛔ هیچ ابزاری دستورِ دلخواه اجرا نمی‌کند؛ هر کدام یک تابعِ مشخصِ خودِ پنل
//     را با آرگومان‌های سنجیده صدا می‌زند.
//  ⛔ خروجی پیش از رفتن به مدل از redact.js رد می‌شود و کوتاه می‌شود.
// ---------------------------------------------------------------------------
import { db, logEvent } from '../db.js';
import { config } from '../config.js';
import { versionInfo } from '../version.js';
import { redactDeep } from './redact.js';
import { searchKnowledge } from './kb.js';
import { getStations } from '../state.js';

const MAX_RESULT_CHARS = 6000;

/** یک متن یا شیء را برای مدل کوتاه می‌کند */
export function clip(value, max = MAX_RESULT_CHARS) {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return s.length > max ? s.slice(0, max) + `\n…[${s.length - max} نویسهٔ دیگر کوتاه شد]` : s;
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && o[k] !== undefined).map((k) => [k, o[k]]));
const str = (v, max = 120) => String(v ?? '').trim().slice(0, max);
const int = (v, def, min, max) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

// ── خواندنی‌ها ─────────────────────────────────────────────────────────────

async function getMetrics() {
  const { getLatest, collect } = await import('../metrics/index.js');
  const { readHost } = await import('../metrics/system.js');
  const m = getLatest() || (await collect());
  const host = readHost();
  return {
    at: m?.at || Date.now(),
    cpuPercent: m?.cpu?.usage ?? null,
    cores: m?.cpu?.cores?.length ?? null,
    memory: m?.memory ? { percent: m.memory.usage, usedBytes: m.memory.used, totalBytes: m.memory.total } : null,
    disk: m?.disk ? { percent: m.disk.usage, disks: (m.disk.disks || []).map((d) => pick(d, ['mount', 'total', 'used', 'usage'])) } : null,
    temperatureC: m?.temperature?.supported ? m.temperature.max : null,
    network: m?.network ? pick(m.network, ['rxBytesPerSec', 'txBytesPerSec']) : null,
    host: pick(host, ['hostname', 'platform', 'arch', 'uptimeSeconds']),
    panelVersion: versionInfo.version,
  };
}

async function listSites() {
  const { listSites } = await import('../sites/registry.js');
  const rows = await listSites({ withSize: false });
  return rows.map((s) => pick(s, ['slug', 'name', 'kind', 'port', 'domains', 'enabled', 'autostart', 'online', 'onlineVia', 'httpStatus', 'managed', 'errorCount', 'publicUrls']));
}

async function readLogs({ site = '', level = '', limit = 40, sinceMinutes = 0 } = {}) {
  const lim = int(limit, 40, 1, 200);
  const since = int(sinceMinutes, 0, 0, 60 * 24 * 30);
  const where = [];
  const args = [];
  if (level && ['error', 'warn', 'info'].includes(level)) { where.push('e.level = ?'); args.push(level); }
  if (since) { where.push('e.created_at >= ?'); args.push(Date.now() - since * 60e3); }
  if (site) { where.push('s.slug = ?'); args.push(str(site, 80)); }
  const rows = db.prepare(`SELECT e.level, e.source, e.message, e.created_at, s.name AS site_name
      FROM events e LEFT JOIN sites s ON s.id = e.site_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.created_at DESC LIMIT ?`).all(...args, lim);
  const out = { events: rows.map((r) => ({ at: r.created_at, level: r.level, source: r.source, site: r.site_name || null, message: String(r.message).slice(0, 300) })) };
  if (site) {
    const { tailLog } = await import('../sites/process.js');
    out.siteLogTail = tailLog(str(site, 80), Math.min(lim, 60)).map((l) => String(l).slice(0, 300));
  }
  return out;
}

async function listContainers() {
  const { listContainers } = await import('../system/docker.js');
  const r = await listContainers({ all: true });
  if (!r.ok) return { available: false, reason: r.error || 'docker_failed', detail: r.detail || null };
  return { available: true, containers: r.items.map((c) => pick(c, ['name', 'image', 'state', 'status', 'ports', 'project'])) };
}

async function listBackups() {
  const { listBackups } = await import('../backup/index.js');
  return { backups: listBackups().slice(0, 20).map((b) => pick(b, ['file', 'sizeBytes', 'createdAt', 'reason', 'note'])) };
}

async function checkUptime() {
  const { monitorSummary } = await import('../control/monitor.js');
  const { listAlerts } = await import('../control/alerts.js');
  const { publicState } = await import('../tunnel.js');
  const m = monitorSummary();
  return {
    byKind: m.byKind,
    monitors: (m.monitors || []).slice(0, 60).map((x) => pick(x, ['kind', 'label', 'target', 'status', 'status_code', 'latency_ms', 'checked_at', 'project_name'])),
    openAlerts: listAlerts({ status: 'open', limit: 30 }).map((a) => pick(a, ['id', 'kind', 'severity', 'title', 'detail', 'count', 'first_at', 'last_at', 'project_name'])),
    tunnel: pick(publicState(), ['status', 'url', 'error']),
  };
}

async function getAuditLog({ limit = 30, q = '' } = {}) {
  const { listAudit } = await import('../control/audit.js');
  const r = listAudit({ limit: int(limit, 30, 1, 200), q: q ? str(q, 60) : null });
  return { total: r.total, rows: r.rows.map((x) => pick(x, ['at', 'actor', 'action', 'entity', 'entity_id', 'result', 'ip'])) };
}

async function diskUsage() {
  const { readDisks } = await import('../metrics/system.js');
  const { diskFree, storageRoot, storageOverview } = await import('../control/storage.js');
  const { listProjects } = await import('../control/models.js');
  const { listBackups } = await import('../backup/index.js');
  const disks = await readDisks();
  let storage = null;
  try {
    const ov = await storageOverview(listProjects());
    storage = { root: ov.root, disk: ov.disk, totalBytes: ov.total,
      biggest: [...ov.items].sort((a, b) => b.bytes - a.bytes).slice(0, 8).map((i) => pick(i, ['name', 'slug', 'bytes', 'backupsBytes', 'logsBytes'])) };
  } catch { storage = { root: storageRoot(), disk: await diskFree() }; }
  const backups = listBackups();
  return {
    disks: (disks?.disks || []).map((d) => pick(d, ['mount', 'total', 'used', 'free', 'usage'])),
    storage,
    panelBackups: { count: backups.length, bytes: backups.reduce((s, b) => s + (b.sizeBytes || 0), 0) },
  };
}

async function listStations() {
  const st = getStations();
  if (!st) return { enabled: false, stations: [] };
  return { enabled: true, stations: st.list().map((s) => pick(s, ['code', 'name', 'liveAt', 'liveConnections', 'diskBytes', 'inboxCount', 'lastActivity'])) };
}

async function tunnelStatus() {
  const { publicState, domainOverview } = await import('../tunnel.js');
  let domains = null;
  try { domains = await domainOverview(); } catch { /* بی دامنه */ }
  return { tunnel: pick(publicState(), ['status', 'url', 'mode', 'error', 'since']), domains: domains ? pick(domains, ['mode', 'main', 'items']) : null };
}

async function updateStatus() {
  const { updateStatus } = await import('../update/github.js');
  let s = null;
  try { s = updateStatus(); } catch { s = null; }
  return { current: versionInfo.version, ...(s ? pick(s, ['latest', 'available', 'channel', 'checkedAt', 'state', 'error']) : {}) };
}

async function accountServerStatus() {
  const { probeAccountServer } = await import('../api/account-proxy.js');
  const { cloudStatus, cloudRaw } = await import('../stations/cloud.js');
  const probe = await probeAccountServer().catch((e) => ({ up: false, error: e.message }));
  const link = cloudStatus();
  const out = { server: pick(probe, ['enabled', 'up', 'version', 'error', 'hint']), bridge: pick(link, ['linked', 'auto', 'local']) };
  if (probe?.up && link.linked) {
    try { out.stats = await cloudRaw('GET', '/api/admin/stats'); } catch (e) { out.statsError = e.message; }
    try { out.expiring = (await cloudRaw('GET', '/api/admin/subscriptions/expiring', { query: { days: 7 } })).expiring?.slice(0, 20); } catch { /* اختیاری */ }
  }
  return out;
}

async function recentAlerts({ status = 'open', limit = 30 } = {}) {
  const { listAlerts } = await import('../control/alerts.js');
  return { alerts: listAlerts({ status: ['open', 'ack', 'resolved', 'all'].includes(status) ? status : 'open', limit: int(limit, 30, 1, 200) })
    .map((a) => pick(a, ['id', 'kind', 'severity', 'title', 'detail', 'status', 'count', 'first_at', 'last_at', 'project_name', 'server_name'])) };
}

// ── تغییردهنده‌ها (فقط پس از تأیید) ──────────────────────────────────────────

async function siteBySlug(slug) {
  const { getSiteBySlug } = await import('../sites/registry.js');
  const site = getSiteBySlug(str(slug, 80));
  if (!site) throw Object.assign(new Error(`سایتی با نامِ «${slug}» نیست`), { code: 'not_found' });
  return site;
}

export const TOOLS = [
  { name: 'get_metrics', kind: 'read', description: 'وضعیتِ همین لحظهٔ سرور: پردازنده، حافظه، دیسک، دما، شبکه، نسخهٔ پنل و مدتِ روشن بودن.', schema: { type: 'object', properties: {} }, run: getMetrics },
  { name: 'list_sites', kind: 'read', description: 'فهرستِ سایت‌ها و برنامه‌های روی این سرور با وضعیتِ روشن/خاموش، پورت، دامنه و شمارِ خطاها.', schema: { type: 'object', properties: {} }, run: listSites },
  { name: 'read_logs', kind: 'read', description: 'رویدادها و خطاهای ثبت‌شده. با site (نامِ کوتاهِ سایت) لاگِ خودِ همان سایت هم می‌آید.',
    schema: { type: 'object', properties: { site: { type: 'string', description: 'slugِ سایت (اختیاری)' }, level: { type: 'string', enum: ['error', 'warn', 'info'] }, limit: { type: 'integer', minimum: 1, maximum: 200 }, sinceMinutes: { type: 'integer', description: 'فقط این‌قدر دقیقهٔ اخیر' } } }, run: readLogs },
  { name: 'list_containers', kind: 'read', description: 'کانتینرهای Docker (اگر Docker نصب باشد).', schema: { type: 'object', properties: {} }, run: listContainers },
  { name: 'list_backups', kind: 'read', description: 'پشتیبان‌های دیتابیسِ پنل: فایل، اندازه، زمان، دلیل.', schema: { type: 'object', properties: {} }, run: listBackups },
  { name: 'check_uptime', kind: 'read', description: 'پایش: کدام سرویس/سایت بالاست یا افتاده، هشدارهای باز، و وضعیتِ تونلِ اینترنت.', schema: { type: 'object', properties: {} }, run: checkUptime },
  { name: 'get_audit_log', kind: 'read', description: 'دفترِ رخدادها: چه کسی چه کاری کِی کرد (ورودها، تغییرها).', schema: { type: 'object', properties: { limit: { type: 'integer' }, q: { type: 'string' } } }, run: getAuditLog },
  { name: 'disk_usage', kind: 'read', description: 'دیسک‌ها، فضای آزاد، بزرگ‌ترین پوشه‌های پروژه‌ها و حجمِ پشتیبان‌ها.', schema: { type: 'object', properties: {} }, run: diskUsage },
  { name: 'list_stations', kind: 'read', description: 'پمپ‌بنزین‌های وصل به این سرور: آخرین تپش، اتصال‌های زنده، حجم.', schema: { type: 'object', properties: {} }, run: listStations },
  { name: 'tunnel_status', kind: 'read', description: 'تونلِ اینترنت (Cloudflare) و دامنه‌هایی که به این سرور می‌رسند.', schema: { type: 'object', properties: {} }, run: tunnelStatus },
  { name: 'update_status', kind: 'read', description: 'نسخهٔ فعلیِ پنل و این‌که به‌روزرسانی هست یا نه.', schema: { type: 'object', properties: {} }, run: updateStatus },
  { name: 'account_server_status', kind: 'read', description: 'سرورِ حساب (ثبت‌نام و اشتراکِ برنامه‌ها): بالاست؟ آمار، اشتراک‌های رو به پایان.', schema: { type: 'object', properties: {} }, run: accountServerStatus },
  { name: 'recent_alerts', kind: 'read', description: 'هشدارهای پایش (باز، تأییدشده یا حل‌شده).', schema: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'ack', 'resolved', 'all'] }, limit: { type: 'integer' } } }, run: recentAlerts },
  { name: 'search_app_docs', kind: 'read', description: 'جست‌وجو در مستنداتِ برنامه‌ها (پمپ یعقوبی و …): «چطور فلان کار را بکنم»، میانبرها، پرسش‌های پرتکرار.',
    schema: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, app: { type: 'string', description: 'pump یا shop (اختیاری)' } } },
    run: ({ query, app = '' }) => ({ results: searchKnowledge(str(query, 300), { limit: 5, app: str(app, 20) }) }) },

  // ── نیازمندِ تأیید ──
  { name: 'restart_site', kind: 'confirm', description: 'ری‌استارتِ یک سایت/برنامهٔ روی این سرور. فقط پیشنهاد؛ اجرا با تأییدِ مدیر.',
    schema: { type: 'object', required: ['slug'], properties: { slug: { type: 'string' } } },
    summary: ({ slug }) => `ری‌استارتِ سایتِ «${slug}»`,
    run: async ({ slug }) => { const { restartSite } = await import('../sites/process.js'); return restartSite(await siteBySlug(slug)); } },
  { name: 'start_site', kind: 'confirm', description: 'روشن کردنِ سایتی که خاموش است.',
    schema: { type: 'object', required: ['slug'], properties: { slug: { type: 'string' } } },
    summary: ({ slug }) => `روشن کردنِ سایتِ «${slug}»`,
    run: async ({ slug }) => { const { startSite } = await import('../sites/process.js'); return startSite(await siteBySlug(slug)); } },
  { name: 'stop_site', kind: 'confirm', description: 'خاموش کردنِ یک سایت.',
    schema: { type: 'object', required: ['slug'], properties: { slug: { type: 'string' } } },
    summary: ({ slug }) => `خاموش کردنِ سایتِ «${slug}»`,
    run: async ({ slug }) => { const { stopSite } = await import('../sites/process.js'); return stopSite(await siteBySlug(slug)); } },
  { name: 'run_backup', kind: 'confirm', description: 'گرفتنِ یک پشتیبانِ تازه از دیتابیسِ پنل.',
    schema: { type: 'object', properties: { note: { type: 'string' } } },
    summary: ({ note }) => `گرفتنِ پشتیبانِ تازه${note ? ` (${str(note, 60)})` : ''}`,
    run: async ({ note }) => { const { createBackup } = await import('../backup/index.js'); return createBackup({ reason: 'manual', note: note ? str(note, 200) : 'به پیشنهادِ دستیار' }); } },
  { name: 'clear_site_log', kind: 'confirm', description: 'پاک کردنِ لاگِ یک سایت (وقتی خیلی بزرگ شده).',
    schema: { type: 'object', required: ['slug'], properties: { slug: { type: 'string' } } },
    summary: ({ slug }) => `پاک کردنِ لاگِ سایتِ «${slug}»`,
    run: async ({ slug }) => { const { clearLog } = await import('../sites/process.js'); await siteBySlug(slug); clearLog(str(slug, 80)); return { ok: true }; } },
  { name: 'repair_tunnel', kind: 'confirm', description: 'تعمیر و راه‌اندازیِ دوبارهٔ تونلِ اینترنت وقتی افتاده.',
    schema: { type: 'object', properties: {} },
    summary: () => 'تعمیرِ تونلِ اینترنت',
    run: async () => { const { repairTunnel } = await import('../tunnel.js'); return repairTunnel(); } },
  { name: 'resolve_alert', kind: 'confirm', description: 'بستنِ یک هشدارِ پایش که دیگر موضوعیت ندارد.',
    schema: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
    summary: ({ id }) => `بستنِ هشدارِ شمارهٔ ${id}`,
    run: async ({ id }) => { const { resolveAlert } = await import('../control/alerts.js'); return resolveAlert(int(id, 0, 1, 1e9)); } },
  { name: 'run_checks', kind: 'confirm', description: 'اجرای همین حالای همهٔ بررسی‌های پایش (سایت‌ها، سرورها، دامنه‌ها).',
    schema: { type: 'object', properties: {} },
    summary: () => 'اجرای بررسی‌های پایش',
    run: async () => { const { tick } = await import('../control/monitor.js'); await tick(); return { ok: true }; } },
];

export const toolByName = (name) => TOOLS.find((t) => t.name === name) || null;

/** طرحِ ابزارها به شکلی که Ollama می‌فهمد */
export function toolSchemas() {
  return TOOLS.map((t) => ({
    type: 'function',
    function: { name: t.name, description: `${t.kind === 'confirm' ? '[نیازمندِ تأییدِ مدیر] ' : ''}${t.description}`, parameters: t.schema },
  }));
}

/** آرگومان‌ها را با طرح می‌سنجد — مدل هر چیزی می‌فرستد */
export function checkArgs(tool, args) {
  const a = args && typeof args === 'object' ? args : {};
  for (const req of tool.schema.required || []) {
    if (a[req] === undefined || a[req] === null || a[req] === '') return { ok: false, error: `آرگومانِ «${req}» لازم است` };
  }
  const clean = {};
  for (const [k, def] of Object.entries(tool.schema.properties || {})) {
    if (a[k] === undefined) continue;
    if (def.type === 'integer') clean[k] = int(a[k], undefined, def.minimum ?? -1e12, def.maximum ?? 1e12);
    else if (def.enum) { if (def.enum.includes(a[k])) clean[k] = a[k]; }
    else clean[k] = str(a[k], 300);
  }
  return { ok: true, args: clean };
}

/**
 * اجرای یک ابزارِ فقط‌خواندنی برای مدل. ابزارِ تغییردهنده اجرا **نمی‌شود**؛
 * پیشنهادش ساخته می‌شود و همان به مدل گفته می‌شود.
 */
export async function runTool(name, args, { conversationId = null, requestedBy = 'agent', onProposal } = {}) {
  const tool = toolByName(name);
  if (!tool) return { ok: false, error: `ابزاری به نامِ «${name}» نیست` };
  const v = checkArgs(tool, args);
  if (!v.ok) return { ok: false, error: v.error };
  if (tool.kind === 'confirm') {
    const { createAction } = await import('./memory.js');
    const action = createAction({ conversationId, tool: tool.name, args: v.args, summary: tool.summary(v.args), requestedBy });
    onProposal?.(action);
    return { ok: true, proposal: { id: action.id, summary: action.summary }, note: 'این کار تغییردهنده است و فقط پس از تأییدِ مدیر از پنل اجرا می‌شود. به کاربر بگو پیشنهاد ثبت شد و منتظرِ تأیید است.' };
  }
  try {
    const out = await tool.run(v.args);
    return { ok: true, result: redactDeep(out) };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/** اجرای واقعیِ یک اقدامِ تأییدشده — تنها راه */
export async function executeAction(action, { decidedBy = 'admin' } = {}) {
  const tool = toolByName(action.tool);
  if (!tool || tool.kind !== 'confirm') throw Object.assign(new Error('این اقدام اجراشدنی نیست'), { code: 'bad_action' });
  const v = checkArgs(tool, action.args);
  if (!v.ok) throw Object.assign(new Error(v.error), { code: 'bad_args' });
  const { audit } = await import('../control/audit.js');
  try {
    const result = await tool.run(v.args);
    audit({ actor: decidedBy, action: `agent.${tool.name}`, entity: 'agent_action', entityId: String(action.id), detail: v.args, result: 'ok' });
    logEvent('info', 'agent', `اقدامِ «${action.summary}» با تأییدِ ${decidedBy} اجرا شد`);
    return redactDeep(result ?? { ok: true });
  } catch (e) {
    audit({ actor: decidedBy, action: `agent.${tool.name}`, entity: 'agent_action', entityId: String(action.id), detail: v.args, result: 'failed' });
    throw e;
  }
}

export const agentConfig = () => config.agent || {};
