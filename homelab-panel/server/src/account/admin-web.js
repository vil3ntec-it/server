// ---------------------------------------------------------------------------
//  🌐 «پنلِ مدیرِ سرور» — نشانیِ عمومیِ ‎/admin/‎ ِ سرورِ حساب و «باز می‌شود؟» (۱.۵۱.۲)
//
//  گزارشِ صاحب سامانه: «‎api.<دامنه>/admin/‎ برایم باز نمی‌شود.» این‌جا دو کار:
//    ۱) نشانی از **تنظیمِ خودِ پنل** — همان فهرستِ ‎PUBLIC_BASE_URLS‎ ِ سرورِ حساب (`public-urls.js` ⇐ `accountHostList`:
//       نامِ اصلیِ «دامنه‌های هر برنامه» یا ‎api.<دامنه>‎ ِ خودکار). ⛔ هیچ دامنه‌ای این‌جا نوشته نشده؛ نبود ⇒ `no_domain`.
//    ۲) یک ‎GET‎ ِ کوتاه (۶ ثانیه، بی هیچ سرآیند یا کوکیِ ورود، بی دنبال کردنِ تغییرِ مسیر) به همان نشانی از خودِ این
//       کامپیوتر، و یک دلیلِ روشن: DNS، گواهی، تونل، مسیرِ تونل، درِ سرورِ حساب، ۴۰۴… (`classifyAdminWeb`، خالص).
//  ⛔ نشانیِ کاوش فقط همین نشانیِ ساخته‌شده از تنظیم است — هرگز از ورودیِ درخواست (راهِ SSRF نیست).
//  ⛔ نتیجه ۳۰ ثانیه نگه داشته می‌شود و یکی‌یکی (`checkAdminWeb`) — «دوباره بسنج» هر ۵ ثانیه یک بار.
// ---------------------------------------------------------------------------
import { accountHostList } from './public-urls.js';
import { accountApiUrl } from '../api/account-proxy.js';
import { domainOverview, tunnelRunning } from '../tunnel.js';
import { accountStatus } from './supervisor.js';

const HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/**
 * نشانیِ ‎/admin/‎ از فهرستِ نام‌های سرورِ حساب (نامِ اصلی اول) — خالص.
 * @param {{ hostname: string, primary?: boolean, auto?: boolean }[]} list
 */
export function adminWebTarget(list) {
  const rows = (Array.isArray(list) ? list : [])
    .map((h) => ({ host: String(h?.hostname || '').trim().toLowerCase(), auto: h?.auto === true, primary: h?.primary === true }))
    .filter((h) => HOST_RE.test(h.host));
  const main = rows.find((r) => r.primary) || rows[0] || null;
  if (!main) return { host: null, url: null, auto: false, others: [] };
  return {
    host: main.host,
    url: `https://${main.host}/admin/`,
    auto: main.auto,
    others: rows.filter((r) => r.host !== main.host).slice(0, 5).map((r) => `https://${r.host}/admin/`),
  };
}

/** حالِ همین کامپیوتر برای همان نام: تونل، مسیر، DNS، درِ سرورِ حساب. هر کدام نشد ⇒ «نمی‌دانیم» (null). */
export function adminWebLocal(host) {
  let ov = null;
  try { ov = domainOverview(); } catch { ov = null; }
  const item = host && Array.isArray(ov?.items) ? ov.items.find((i) => i.hostname === host) : null;
  let running = null;
  try { running = tunnelRunning(); } catch { running = null; }
  let acct = null;
  try { acct = accountStatus(); } catch { acct = null; }
  return {
    tunnelMode: ov?.mode || null,
    tunnelRunning: running,
    inTunnel: item ? !item.protected : false,
    protectedHost: Boolean(item?.protected),
    dnsRouted: item ? Boolean(item.dnsRouted) : false,
    gateway: Boolean(accountApiUrl()),
    accountManaged: acct ? Boolean(acct.enabled) : null,
    accountRunning: acct ? Boolean(acct.running) : null,
  };
}

const DNS = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_NONAME', 'EAI_NODATA', 'ENODATA', 'ESERVFAIL']);
const REFUSED = new Set(['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'UND_ERR_SOCKET', 'ECONNABORTED']);

/** خطای شبکهٔ ‎fetch‎ ⇒ یکی از dns · tls · timeout · refused · network — خالص. */
export function networkKind(e) {
  if (!e) return 'network';
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return 'timeout';
  const code = String(e.cause?.code || e.code || '');
  if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'ETIMEDOUT') return 'timeout';
  if (DNS.has(code)) return 'dns';
  if (/CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|HOSTNAME_MISMATCH|ALTNAME/i.test(code)) return 'tls';
  if (REFUSED.has(code)) return 'refused';
  return 'network';
}
const safeCode = (e) => {
  const c = String(e?.cause?.code || e?.code || e?.name || '');
  return /^[A-Za-z0-9_]{1,40}$/.test(c) ? c : '';
};

async function readCapped(res, max) {
  if (!res.body?.getReader) return '';
  const reader = res.body.getReader();
  const parts = [];
  let size = 0;
  try {
    while (size < max) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(Buffer.from(value));
      size += value.length;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return Buffer.concat(parts).subarray(0, max).toString('utf8');
}

/**
 * ‎GET‎ ِ نشانی، بی کوکی و بی سرآیندِ ورود؛ تغییرِ مسیر دنبال نمی‌شود (Cloudflare Access همان‌جا دیده می‌شود).
 * ۴۰۴ ⇒ یک ‎GET /api/health‎ ِ همان نام هم (تا «فقط ‎/api‎ می‌رسد» از «هیچ چیز نمی‌رسد» جدا شود).
 */
export async function probeAdminWeb(url, { timeoutMs = 6000, fetchImpl = globalThis.fetch } = {}) {
  const t0 = Date.now();
  const one = async (u, accept) => {
    const res = await fetchImpl(u, {
      method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
      headers: { accept, 'user-agent': 'homelab-panel-reachability/1' },
    });
    const body = await readCapped(res, 16 * 1024);
    return {
      status: res.status,
      type: String(res.headers.get('content-type') || '').slice(0, 80),
      cfRay: Boolean(res.headers.get('cf-ray')),
      location: String(res.headers.get('location') || '').slice(0, 300),
      body,
    };
  };
  try {
    const main = await one(url, 'text/html');
    let health = null;
    if (main.status === 404) {
      try {
        const h = await one(new URL('/api/health', url).href, 'application/json');
        health = { status: h.status, json: /^\s*\{/.test(h.body) };
      } catch (e) {
        health = { status: 0, error: networkKind(e) };
      }
    }
    return { ok: true, ms: Date.now() - t0, ...main, health };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: networkKind(e), errorCode: safeCode(e) };
  }
}

/**
 * دلیلِ روشن از «حالِ همین کامپیوتر» + «پاسخِ کاوش» — خالص (آزمون بی شبکه می‌سنجدش).
 * @returns {{ code: string, tone: 'good'|'warn'|'bad', hints: string[] }}
 */
export function classifyAdminWeb(target, local, probe) {
  const L = local || {};
  const hints = [];
  if (L.tunnelMode === 'quick') hints.push('tunnel_quick');
  if (L.tunnelMode && L.tunnelMode !== 'quick' && L.tunnelRunning === false) hints.push('tunnel_stopped');
  if (L.tunnelMode === 'named' && L.inTunnel && !L.dnsRouted) hints.push('dns_not_routed');
  if (L.protectedHost) hints.push('protected_host');
  if (L.gateway === false) hints.push('gateway_off');
  if (L.accountManaged === true && L.accountRunning === false) hints.push('account_stopped');
  const out = (code, tone) => ({ code, tone, hints: code === 'ok' ? [] : hints.filter((h) => h !== code) });

  if (!target?.url) return out('no_domain', 'bad');
  if (!probe) return out('unchecked', 'warn');
  if (!probe.ok) {
    if (['dns', 'tls', 'timeout', 'refused'].includes(probe.error)) return out(probe.error, 'bad');
    return out('network', 'bad');
  }
  const st = Number(probe.status) || 0;
  const body = String(probe.body || '');
  if (st >= 200 && st < 300) return /text\/html/i.test(probe.type || '') ? out('ok', 'good') : out('wrong_app', 'warn');
  if (st === 530 || /error code:?\s*1033|argo tunnel error|cloudflare tunnel error/i.test(body)) return out('tunnel_down', 'bad');
  if (st >= 500 && /account_server_(down|error|timeout)/.test(body)) return out('account_down', 'bad');
  if (st === 502 || st === 504 || (st >= 520 && st <= 527)) return out('origin_down', 'bad');
  if (st === 404) {
    if (L.gateway === false) return out('gateway_off', 'bad');
    if (L.tunnelMode === 'named' && !L.inTunnel) return out('route_missing', 'bad');
    if (probe.health && probe.health.status === 200) return out('admin_not_forwarded', 'bad');
    if (L.tunnelMode === 'token') return out('route_missing', 'bad');
    if (L.tunnelMode === 'quick') return out('tunnel_quick', 'bad');
    return out('not_found', 'bad');
  }
  if (st >= 300 && st < 400) return /cloudflareaccess\.com/i.test(probe.location || '') ? out('access', 'warn') : out('redirect', 'warn');
  if (st === 401 || st === 403) return out('blocked', 'bad');
  return out('http_error', 'bad');
}

/* ── نتیجهٔ نگه‌داشته، یکی‌یکی ── */
const KEEP_MS = 30_000;
const MIN_GAP_MS = 5_000;
let last = null;
let inflight = null;

/** نشانی و حالِ امروز بی شبکه — برای دکمه و منو */
export function adminWebInfo() {
  let list = [];
  try { list = accountHostList(); } catch { list = []; }
  return adminWebTarget(list);
}

/** «باز می‌شود؟» — نگه‌داشته ۳۰ ثانیه؛ `fresh` ⇒ از نو، ولی نه زودتر از ۵ ثانیه پس از قبلی. */
export async function checkAdminWeb({ fresh = false, probe = probeAdminWeb } = {}) {
  const now = Date.now();
  const target = adminWebInfo();
  const sameUrl = last && last.url === target.url;
  if (sameUrl && now - last.checkedAt < (fresh ? MIN_GAP_MS : KEEP_MS)) return last;
  if (inflight) return inflight;
  inflight = (async () => {
    const local = adminWebLocal(target.host);
    const p = target.url ? await probe(target.url) : null;
    const verdict = classifyAdminWeb(target, local, p);
    last = {
      ...target, ...verdict, local,
      http: p?.ok ? p.status : null,
      error: p && !p.ok ? p.error : null,
      errorCode: p && !p.ok ? p.errorCode || '' : '',
      health: p?.health?.status ?? null,
      ms: p ? p.ms : null,
      checkedAt: Date.now(),
    };
    return last;
  })().finally(() => { inflight = null; });
  return inflight;
}

/** فقط آزمون: فراموش کردنِ نتیجهٔ نگه‌داشته */
export function resetAdminWebCheck() { last = null; inflight = null; }
