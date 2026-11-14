// ---------------------------------------------------------------------------
//  «عوض شدنِ نشانی» روی همین نصب (۱.۵۰.۹۵، گامِ ۳) — لایهٔ «عوض کردنِ مسیر»
//
//  ⛔ هیچ راهِ دومی ساخته نشد: همان کدِ امروزِ «آدرس اینترنتی» (`src/tunnel.js`) —
//     • تونلِ نام‌دار با گواهیِ ورودِ Cloudflare: `syncTunnelRoutes` (‎cloudflared tunnel route dns --overwrite-dns‎ + ingress)،
//       (۱.۵۰.۹۹: نام‌های سرورِ حسابِ آمده دیگر «زیردامنهٔ دستی» نمی‌شوند — ردیفِ ‎app_hostnames‎ ِ همان برنامه در گامِ start).
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
  namedConfig, routedHostnames, syncTunnelRoutes, removeHostname, DEFAULT_TUNNEL_NAME, ingressSnapshot, restoreIngress,
} from '../tunnel.js';
import { accountHostList } from '../account/public-urls.js';
import { ownerOf, dropMovedHostnames } from '../app-hosts.js';

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

/** نام‌های میزبانِ سرورِ حسابِ همین نصب — (۱.۵۰.۹۹) نامِ اصلی اول، با نام‌های افزوده (‎app_hostnames‎) و ‎api.<دامنه>‎ ِ خودکار */
export function accountHostnames() {
  try { return accountHostList().map((h) => h.hostname); } catch { return []; }
}

/**
 * مقصد: نام‌ها را به تونلِ همین سرور می‌آورد. ‎{ ok, ...routeInfo, applied, failures, guarded, port }‎
 *
 * ⛔ (۱.۵۰.۹۹) **همه یا هیچ**: همهٔ نام‌های برنامه (نه فقط اصلی) در یک نوشتنِ ingress و یک راه‌اندازیِ تونل. نامی که این‌جا
 *    مالِ برنامهٔ دیگری است، نامی که در ingress نمی‌نشیند، نوشتنِ ناموفقِ ingress یا DNS ِ ناموفقِ **هر** کدام ⇒ ‎config.yml‎ و
 *    تنظیم‌های مسیر برمی‌گردند (تونلِ روشن هنوز پیکربندیِ قبلی را دارد) و ‎{ ok:false, atomic: true }‎ — گامِ «route» ِ
 *    جابه‌جایی شکست می‌خورد و کار برمی‌گردد (مبدأ با ‎--overwrite-dns‎ همهٔ نام‌ها را پس می‌گیرد). تونلِ توکنی/سریع/بی تونل:
 *    چیزی نوشته نمی‌شود ⇒ گامِ دستیِ دقیق برای **همهٔ** نام‌ها (`route-plan.js`).
 *    نام‌های سرورِ حساب پیش‌تر در گامِ «start» ردیفِ همین برنامه شدند (`registerMovedHostnames`) ⇒ همه در ingress‌اند.
 */
export async function claimRoutes({ hostnames = [], port = null, app = null } = {}) {
  const info = routeInfo();
  const hosts = uniq(hostnames);
  const out = { ok: true, ...info, applied: [], failures: [], guarded: [], port };
  if (!hosts.length) return out;

  //  یک نام، یک صاحب: مالِ برنامهٔ دیگرِ همین سرور ⇒ هیچ نامی گرفته نمی‌شود
  if (app) {
    const clash = hosts.map((h) => ({ h, o: ownerOf(h) })).filter(({ o }) => o && o.app !== app && o.source !== 'manual');
    if (clash.length) {
      return { ...out, ok: false, atomic: true, failures: clash.map(({ h, o }) => ({ hostname: h, detail: `hostname_taken: ${o.label}` })) };
    }
  }
  if (!info.auto) return out;

  const snap = ingressSnapshot();
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
  const missing = hosts.filter((x) => !listed.has(x));
  let r = { ok: false, failures: [] };
  if (!missing.length) {
    try { r = await syncTunnelRoutes({ restart: true, strict: { verify: hosts } }); } catch (e) { r = { ok: false, ingressError: String(e?.message || e).slice(0, 200) }; }
  }
  const failed = missing.length
    ? missing.map((h) => ({ hostname: h, detail: 'not_in_ingress' }))
    : r.ingressError ? hosts.map((h) => ({ hostname: h, detail: `ingress_write_failed: ${r.ingressError}` }))
      : (r.verifyFailed || []);
  if (failed.length) {
    await restoreIngress(snap, { restart: Boolean(r.restarted) }).catch(() => {});
    const failedSet = new Set(failed.map((f) => f.hostname));
    out.ok = false;
    out.atomic = true;
    out.failures = hosts.map((h) => ({ hostname: h, detail: failedSet.has(h) ? failed.find((f) => f.hostname === h).detail : 'rolled_back' }));
    logEvent('warn', 'fleet', `مسیرِ ${hosts.length} نام به تونلِ همین سرور نیامد (${failed.map((f) => f.hostname).join('، ')}) — همه برگشت، هیچ نامی جدا نرفت`);
    return out;
  }
  out.applied = hosts.slice();
  out.dnsUnavailable = r.dnsUnavailable || null;
  logEvent('info', 'fleet', `مسیرِ هر ${out.applied.length} نام با هم به تونلِ همین سرور آمد`);
  return out;
}

/**
 * مبدأ (یا مقصدی که برمی‌گردد): نام‌ها از ingress ِ همین سرور بیرون می‌روند (ردیفِ برنامه پیشتر خاموش شده).
 * ⛔ هیچ رکوردِ DNS ای پاک نمی‌شود — DNS را مقصد با ‎--overwrite-dns‎ می‌گیرد.
 */
export async function releaseRoutes({ hostnames = [], moveId = null } = {}) {
  const info = routeInfo();
  const hosts = uniq(hostnames);
  //  (۱.۵۰.۹۹) نام‌هایی که همین کار برای سرورِ حساب این‌جا ثبت کرد (برگشتِ مقصد) — ردیفشان می‌رود
  if (moveId) dropMovedHostnames(moveId);
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
    //  (۱.۵۰.۹۹) نام‌های رفته «ناشناسِ داخلِ فایل» نمی‌شوند (absorb) — واقعاً از ingress ِ این‌جا بیرون می‌روند
    const forget = hosts.filter((h) => !listed.has(h));
    try { await syncTunnelRoutes({ restart: true, strict: { verify: [], forget } }); } catch { /* تونل نیست */ }
  }
  return { mode: info.mode, released: hosts };
}

/** پورتِ عمومیِ همین نصب (همان که ‎api.‎ و ‎admin.‎ رویش‌اند) */
export const publicPort = () => config.siteSync.port || config.port;
