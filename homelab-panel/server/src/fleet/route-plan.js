// ---------------------------------------------------------------------------
//  «عوض شدنِ نشانی» — قراردادِ خالص (۱.۵۰.۹۵، گامِ ۳ ِ docs/MULTI-SERVER-fa.md)
//
//  پس از روشن شدنِ برنامه روی مقصد، هر نامِ میزبانِ آن برنامه (دامنه‌های سایت؛ ‎api.‎ ِ سرورِ حساب) باید به همان
//  سرور برسد. ورودی: آن‌چه مقصد هنگامِ «گرفتنِ مسیر» گزارش کرد (`claim`) و حالِ تونلِ دو طرف (`routeInfo` ِ هر کدام).
//  خروجی: یک گام برای هر نام — یا ‎auto‎ (پنلِ مقصد خودش انجام داد) یا گامِ **دستیِ دقیق** برای صفحه:
//    • ‎auto‎             مقصد تونلِ نام‌دار با گواهیِ ورودِ Cloudflare دارد ⇒ همان کدِ امروزِ پنل
//                         (`syncTunnelRoutes` ⇐ ‎cloudflared tunnel route dns --overwrite-dns <تونل> <نام>‎) انجام داد.
//    • ‎cname‎            تونلِ نام‌دار ولی نشد (گواهیِ حسابِ دیگر/خطا) ⇒ «در Cloudflare، CNAME ِ X را به تونلِ Y ببرید»
//    • ‎public-hostname‎  تونلِ توکنی (پیکربندی در داشبوردِ Cloudflare) ⇒ «Public Hostname ِ X ⇐ ‎http://127.0.0.1:<پورت>‎ در
//                         تونلِ مقصد، و برداشتنش از تونلِ مبدأ»
//    • ‎a-record‎         مقصد تونل ندارد (VPS با Caddy) ⇒ «رکوردِ A ِ X ⇐ IP ِ مقصد» — ⛔ پنل امروز رکوردِ DNS نمی‌نویسد؛
//                         خودکار شدنش کلیدِ API ِ Cloudflare ِ صاحب‌کار را می‌خواهد.
//    • ‎no-hostname‎      برنامه نامِ ثابت ندارد (تونلِ سریعِ trycloudflare) ⇒ نشانیِ تازه همان است که مقصد داد.
//  ⛔ این فایل هیچ چیزی از پنل import نمی‌کند — آزمون (test/app-placement.mjs) همین قرارداد را با ورودیِ ساختگی می‌سنجد.
// ---------------------------------------------------------------------------

export const ROUTE_MODES = Object.freeze(['named', 'token', 'quick', 'none']);

/**
 * @param {{ hostnames: string[], from: { name, route? }, to: { name, route? }, claim?: { applied?: string[], failures?: {hostname, detail}[], port?: number, quickUrl?: string|null } }} o
 * @returns {{ steps: object[], manual: number, auto: boolean }}
 */
export function planRoute({ hostnames = [], from = {}, to = {}, claim = null }) {
  const applied = new Set(claim?.applied || []);
  const failures = new Map((claim?.failures || []).map((f) => [f.hostname, f.detail || null]));
  const mode = ROUTE_MODES.includes(to.route?.mode) ? to.route.mode : 'none';
  const tunnel = to.route?.tunnelName || null;
  const steps = [];
  for (const hostname of [...new Set(hostnames.filter(Boolean))]) {
    if (applied.has(hostname)) {
      steps.push({ hostname, how: 'auto', done: true, tunnel, server: to.name || null });
      continue;
    }
    const detail = failures.get(hostname) || null;
    if (mode === 'named') {
      steps.push({
        hostname, how: 'cname', done: false, tunnel: tunnel || 'control-center', server: to.name || null, detail,
        command: `cloudflared tunnel route dns --overwrite-dns ${tunnel || 'control-center'} ${hostname}`,
      });
    } else if (mode === 'token') {
      steps.push({
        hostname, how: 'public-hostname', done: false, tunnel, server: to.name || null, port: claim?.port ?? null,
        fromServer: from.name || null, fromTunnel: from.route?.tunnelName || null, detail,
      });
    } else {
      steps.push({ hostname, how: 'a-record', done: false, server: to.name || null, detail });
    }
  }
  if (!steps.length) steps.push({ hostname: null, how: 'no-hostname', done: true, url: claim?.quickUrl || null, server: to.name || null });
  const manual = steps.filter((s) => !s.done).length;
  return { steps, manual, auto: manual === 0 };
}
