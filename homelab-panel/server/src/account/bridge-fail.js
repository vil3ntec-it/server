// ---------------------------------------------------------------------------
//  پاسخِ خطای پل (‎stations/cloud.js‎) — **یک** جا برای همهٔ درهای ‎/api/account-admin/*‎ و ‎/api/stations/*‎
//
//  ⛔ کدِ خودِ خطا می‌رود، نه ۵۰۰ ِ گنگ.
//  ⛔ نوشتنِ بی‌پاسخ (مهلتِ پل ⇒ ‎504 outcome_unknown‎، ۱.۵۰.۷۵): ‎outcome: 'unknown'‎ هم می‌رود تا رابط «معلوم نیست؛
//     پیش از تکرار ببینید» بگوید، نه «شکست»؛ و یک ردیف در دفترِ پنل: چه کسی، کدام درِ سرورِ حساب، با چه مهلتی.
//     (`err.audited` ⇒ صداکننده خودش ردیفِ دقیق‌تری نوشته است، مثلِ پشتیبانِ دستی.)
// ---------------------------------------------------------------------------
import { audit } from '../control/audit.js';

export function bridgeFail(res, err) {
  const req = res.req;
  if (err?.outcome === 'unknown' && !err.audited) {
    audit({
      actor: req?.user?.username || 'admin', action: 'account.bridge.outcome_unknown', entity: 'account_server',
      entityId: String(err.path || '').slice(0, 60),
      detail: { method: err.method || req?.method || '', path: String(err.path || ''), timeoutMs: err.timeoutMs || null },
      result: 'unknown',
    });
  }
  return res.status(err?.status || 502).json({
    error: err?.code || 'cloud_error',
    message: err?.message || 'سرورِ حساب جواب نداد',
    ...(err?.outcome === 'unknown' ? { outcome: 'unknown' } : {}),
  });
}
