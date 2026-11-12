// ---------------------------------------------------------------------------
//  «عوض شدنِ نشانی» روی همین نصب (۱.۵۰.۹۵، گامِ ۳) — لایهٔ «عوض کردنِ مسیر»
//
//  ⛔ هیچ راهِ دومی ساخته نشد: همان کدِ امروزِ «آدرس اینترنتی» (`src/tunnel.js`) —
//     • تونلِ نام‌دار با گواهیِ ورودِ Cloudflare: `syncTunnelRoutes` (‎cloudflared tunnel route dns --overwrite-dns‎ + ingress)،
//       و برای نامی که این سرور خودش نمی‌شناسد `addHostname` (همان «افزودنِ زیردامنه»).
//     • تونلِ توکنی/سریع/بی تونل: پنل امروز مسیرِ Cloudflare را نمی‌نویسد ⇒ هیچ کاری نمی‌شود و گامِ دستی با راهنمای
//       دقیق در صفحه می‌آید (`route-plan.js`). نوشتنِ رکوردِ DNS (A) کلیدِ API ِ Cloudflare ِ صاحب‌کار را می‌خواهد.
//  ⛔ نامی که «پیشتر ساخته شده» (`tunnel_routed_dns`) ممکن است حالا به تونلِ دیگری برود: پیش از گرفتن از فهرست
//     بیرون می‌رود تا ‎--overwrite-dns‎ دوباره بزند؛ و سرورِ قبلی آن را **فقط** وقتی از فهرست برمی‌دارد که دیگر در ingress ِ
//     خودش نیست — وگرنه syncTunnelRoutes ِ بعدیِ آن سرور DNS را پس می‌گرفت.
//  ⛔ دامنهٔ ریشهٔ سایت (مثلاً ‎example.com‎) روی مقصد ‎api.‎/‎admin.‎ ِ خودکار هم می‌سازد — آن‌ها مالِ سرورِ حساب/برنامهٔ مدیرِ
//     سرورِ دیگرند و **ربوده نمی‌شوند** (پیش از هم‌گام‌سازی «ساخته‌شده» علامت می‌خورند).
// ---------------------------------------------------------------------------
import { config, deploy } from '../config.js';
import { getSetting, setSetting, logEvent } from '../db.js';
import { adminHostFor, apiHostFor } from '../platform/domain.js';
import {
  namedConfig, routedHostnames, syncTunnelRoutes, addHostname, removeHostname, apiHostnames, DEFAULT_TUNNEL_NAME,
} from '../tunnel.js';

/** ‎{ mode: named|token|quick|none, tunnelName, auto }‎ — بی هیچ راز (نه توکن، نه شناسهٔ تونل) */
export function routeInfo() {
  const n = namedConfig();
  const mode = n.mode === 'named' || n.mode === 'token' ? n.mode : (deploy.features.tunnel ? 'quick' : 'none');
  return {
    mode,
    tunnelName: mode === 'named' ? (n.tunnelName || DEFAULT_TUNNEL_NAME) : null,
    auto: mode === 'named' && Boolean(n.loggedIn) && Boolean(n.configured),
  };
}

const routedSet = () => new Set(getSetting('tunnel_routed_dns', []) || []);
const uniq = (a) => [...new Set((a || []).map((h) => String(h || '').toLowerCase()).filter(Boolean))];

/** نام‌های میزبانِ سرورِ حسابِ همین نصب (‎api.<دامنه>‎) */
export function accountHostnames() {
  try { return apiHostnames(); } catch { return []; }
}

/**
 * مقصد: نام‌ها را به تونلِ همین سرور می‌آورد. ‎{ ...routeInfo, applied, failures, guarded, port }‎
 * `port`: برای نامی که این سرور در ingress ندارد (‎api.‎ ِ سرورِ حسابِ آمده) — همان پورتِ عمومی.
 */
export async function claimRoutes({ hostnames = [], port = null } = {}) {
  const info = routeInfo();
  const hosts = uniq(hostnames);
  const out = { ...info, applied: [], failures: [], guarded: [], port };
  if (!hosts.length || !info.auto) return out;

  const routed = routedSet();
  for (const h of hosts) routed.delete(h);
  //  ⛔ ‎api./admin.‎ ِ خودکارِ دامنهٔ ریشهٔ همین سایت‌ها نه
  for (const h of hosts) {
    for (const d of [apiHostFor(h), adminHostFor(h)]) {
      if (d && !hosts.includes(d) && !routed.has(d)) { routed.add(d); out.guarded.push(d); }
    }
  }
  setSetting('tunnel_routed_dns', [...routed]);

  const listed = new Set(routedHostnames().map((r) => r.hostname));
  for (const h of hosts.filter((x) => !listed.has(x))) {
    if (!port) { out.failures.push({ hostname: h, detail: 'not_in_ingress' }); continue; }
    try {
      const r = await addHostname({ hostname: h, port });
      if (r.ok) out.applied.push(h);
      else out.failures.push({ hostname: h, detail: `${r.error}${r.detail ? `: ${String(r.detail).slice(-200)}` : ''}` });
    } catch (e) { out.failures.push({ hostname: h, detail: String(e?.message || e).slice(0, 200) }); }
  }
  const toSync = hosts.filter((x) => listed.has(x));
  if (toSync.length) {
    let r = { failures: [{ hostname: '*', detail: 'sync_failed' }] };
    try { r = await syncTunnelRoutes({ restart: true }); } catch (e) { r = { failures: [{ hostname: '*', detail: String(e?.message || e).slice(0, 200) }] }; }
    const failed = new Map((r.failures || []).map((f) => [f.hostname, f.detail]));
    const now = routedSet();
    for (const h of toSync) {
      if (now.has(h) && !failed.has(h) && !failed.has('*')) out.applied.push(h);
      else out.failures.push({ hostname: h, detail: failed.get(h) || failed.get('*') || 'not_routed' });
    }
  }
  logEvent('info', 'fleet', `مسیرِ ${out.applied.length} نام به تونلِ همین سرور آمد${out.failures.length ? ` (${out.failures.length} نام دستی می‌ماند)` : ''}`);
  return out;
}

/**
 * مبدأ (یا مقصدی که برمی‌گردد): نام‌ها از ingress ِ همین سرور بیرون می‌روند (ردیفِ برنامه پیشتر خاموش شده).
 * ⛔ هیچ رکوردِ DNS ای پاک نمی‌شود — DNS را مقصد با ‎--overwrite-dns‎ می‌گیرد.
 */
export async function releaseRoutes({ hostnames = [] } = {}) {
  const info = routeInfo();
  const hosts = uniq(hostnames);
  if (!hosts.length) return { mode: info.mode, released: [] };
  //  نامی که پیشتر با «افزودنِ زیردامنه» این‌جا آمده بود (مثلاً ‎api.‎ ِ سرورِ حساب) ⇒ همان «برداشتنِ زیردامنه»
  const manual = (getSetting('tunnel_hostnames', []) || []).map((x) => x?.hostname).filter(Boolean);
  for (const h of hosts.filter((x) => manual.includes(x))) {
    try { await removeHostname(h); } catch { /* بی‌خیال: بیشتر یعنی تونلی نیست */ }
  }
  const listed = new Set(routedHostnames().map((r) => r.hostname));
  const routed = routedSet();
  let changed = false;
  for (const h of hosts) {
    if (listed.has(h)) { if (!routed.has(h)) { routed.add(h); changed = true; } } //  هنوز در ingress ِ این‌جا: DNS را پس نگیرد
    else if (routed.delete(h)) changed = true;
  }
  if (changed) setSetting('tunnel_routed_dns', [...routed]);
  if (info.mode === 'named') {
    try { await syncTunnelRoutes({ restart: true }); } catch { /* تونل نیست */ }
  }
  return { mode: info.mode, released: hosts };
}

/** پورتِ عمومیِ همین نصب (همان که ‎api.‎ و ‎admin.‎ رویش‌اند) */
export const publicPort = () => config.siteSync.port || config.port;
