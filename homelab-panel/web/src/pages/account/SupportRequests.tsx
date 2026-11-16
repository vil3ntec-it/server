// ---------------------------------------------------------------------------
//  🛟 «از پشتیبانی بخواه» در صندوقِ پشتیبانی (۱.۵۲.۰) — کارتِ مشکل و «درستش کن» ِ یک‌کلیکی
//
//  خواستهٔ صاحب سامانه: «برنامه میگه سفارشِ آنلاین برای این دکان غیرفعال است… روی اون می‌زنه، پشتیبانی میاد و من با یک کلیک
//  برم و برای اون فعال کنم — مثلِ برنامه‌های حرفه‌ای.» برنامهٔ دکان درخواستِ ساخت‌یافته (کد + واقعیت‌های مجاز) را با یک لمس در
//  **همان** رشتهٔ پشتیبانی می‌فرستد؛ این‌جا همان رشته باز است و کنارش کارتِ مشکل: چه شده، حالِ زندهٔ پرچم/اشتراک، و دکمهٔ همان کار.
//
//  ⛔ هیچ منطقی این‌جا نیست — همان درهای پلِ ‎/api/account-admin/console/support-requests‎ (‎support-requests.v1‎ ِ سرورِ حساب).
//  ⛔ پول (تمدید، سقفِ دستگاه) همیشه پنجرهٔ تأیید با عدد دارد؛ پرچم «فقط همین دکان» را می‌گوید؛ هر نوشتن کلیدِ یکتایی دارد.
//  ⛔ جزئیاتِ خصوصیِ خطای همگام‌سازی فقط با اجازهٔ دسترسیِ پشتیبانیِ خودِ دکان (کارتِ «دسترسیِ پشتیبانی» در پروندهٔ دکان).
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { CheckCircle2, LifeBuoy, Wrench } from 'lucide-react';

import { api } from '../../api';
import { Badge, ConfirmDialog, Modal, Skeleton, toast } from '../../components/ui';
import { ActionButton, Notice as InlineNotice, Select } from '../../control/ui';
import { CloudProblem, fa, moment, useLoad } from './shared';

export const SR_BASE = '/api/account-admin/console/support-requests';

export type SrFix = { action: string; result: string; by: string; at: number | null; before: Record<string, unknown>; after: Record<string, unknown> };
export type SupportRequest = {
  id: string; threadId: string; shopId: string; shopName: string; who: string; code: string; problem: string; param: string;
  title: string; fix: string; needsShop: boolean; lang: string; context: Record<string, string | number>;
  status: 'open' | 'resolved'; threadStatus: string; unreadAdmin: number;
  createdAt: number | null; updatedAt: number | null; resolvedAt: number | null; resolvedBy: string; fixes: SrFix[];
};
type ListResp = { available: boolean; requests?: SupportRequest[]; open?: number; unread?: number; message?: string };
type LiveState = { flag?: { key?: string; effective?: boolean; explicit?: boolean | null; hold?: boolean };
  subscription?: { status?: string; phase?: string; plan?: string; endsAt?: number; daysLeft?: number; maxDevices?: number } };
type DetailResp = { available: boolean; request?: SupportRequest; state?: LiveState };
type SyncErr = { available: boolean; restricted: boolean; weekCount: number; errors: { id: string; appVersion: string; message: string; at: number | null; stack?: string; logTail?: string; device?: string }[] };

/** نامِ خواندنیِ هر کدِ پایه — برای پالایه و برچسب */
export const PROBLEM_LABEL: Record<string, string> = {
  flag_off: 'بخشِ خاموش', plan_required: 'بیرون از اشتراک', subscription_expired: 'اشتراکِ تمام‌شده', device_limit: 'سقفِ دستگاه',
  sync_no_shop: 'همگام‌سازی: دکان پیدا نشد', sync_refused: 'همگام‌سازی: تغییرِ نپذیرفته', email_code_not_arriving: 'کدِ ایمیل نمی‌رسد', other: 'دیگر',
};
const FACT_LABEL: Record<string, string> = {
  appVersion: 'نسخهٔ برنامه', platform: 'سکو', screen: 'صفحه', syncError: 'گرهٔ همگام‌سازی', rejected: 'تغییرِ نپذیرفته', devices: 'دستگاه‌ها', maxDevices: 'سقفِ دستگاه',
};
const PLATFORM_LABEL: Record<string, string> = { android: 'گوشیِ اندروید', desktop: 'کامپیوتر', ios: 'آیفون', web: 'وب' };
const AGES = [{ value: '', label: 'هر سنی' }, { value: '1', label: 'کهنه‌تر از ۱ ساعت' }, { value: '24', label: 'کهنه‌تر از ۱ روز' }, { value: '72', label: 'کهنه‌تر از ۳ روز' }];

/** کلیدِ یکتایی برای یک پنجرهٔ تأیید — ⚠️ ‎crypto.randomUUID‎ روی http ِ شبکهٔ خانه نیست؛ ‎getRandomValues‎ هست. */
function newKey(): string {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return `pnl-${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'نشد');

/** صفِ درخواست‌ها — زنده با همان موضوعِ ‎support‎ (پیامِ درخواست همان پیامِ رشته است) */
export function useSupportRequests(f: { status: string; problem: string; minAge: string }) {
  const qs = new URLSearchParams({ status: f.status || 'open' });
  if (f.problem) qs.set('problem', f.problem);
  if (f.minAge) qs.set('minAgeHours', f.minAge);
  return useLoad<ListResp>(`${SR_BASE}?${qs}`, [f.status, f.problem, f.minAge], 'support');
}

/** نشانِ کوچکِ «درخواست» روی ردیفِ گفت‌وگو */
export function RequestBadge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 text-[10.5px] font-bold" style={{ background: 'color-mix(in srgb, var(--status-warning) 16%, transparent)', color: 'var(--status-warning)' }} data-sr-badge>
      <LifeBuoy className="h-3 w-3" /> {n > 1 ? fa(n) : 'درخواست'}
    </span>
  );
}

/** پالایه‌های صفِ درخواست‌ها */
export function RequestFilters({ value, onChange }: { value: { status: string; problem: string; minAge: string }; onChange: (v: { status: string; problem: string; minAge: string }) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line p-3" data-sr="filters">
      <div className="w-28"><Select value={value.status} onChange={(status) => onChange({ ...value, status })}
        options={[{ value: 'open', label: 'باز' }, { value: 'resolved', label: 'حل‌شده' }, { value: 'all', label: 'همه' }]} /></div>
      <div className="w-40"><Select value={value.problem} onChange={(problem) => onChange({ ...value, problem })} placeholder="هر مشکلی"
        options={[{ value: '', label: 'هر مشکلی' }, ...Object.entries(PROBLEM_LABEL).map(([v, label]) => ({ value: v, label }))]} /></div>
      <div className="w-36"><Select value={value.minAge} onChange={(minAge) => onChange({ ...value, minAge })} options={AGES} /></div>
    </div>
  );
}

/** ردیفِ یک درخواست در صف (تازه‌ترین بالا) */
export function RequestRow({ r, active, onPick }: { r: SupportRequest; active: boolean; onPick: () => void }) {
  return (
    <button type="button" onClick={onPick} data-request={r.id}
      className={`flex w-full flex-col gap-1 border-b border-line px-3 py-2.5 text-right transition ${active ? '' : 'hover:bg-surface-raised'}`}
      style={active ? { background: 'var(--accent-soft)' } : undefined}>
      <span className="flex items-center gap-2">
        <LifeBuoy className="h-4 w-4 shrink-0 text-ink-muted" />
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">{r.title}</span>
        {r.unreadAdmin ? <span className="min-w-[22px] rounded-full bg-red-600 px-1.5 text-center text-[11px] font-extrabold text-white">{fa(r.unreadAdmin)}</span> : null}
      </span>
      <span className="flex items-center gap-2 text-[11.5px] text-ink-muted">
        <span className="truncate">{r.shopName || r.who || '—'}</span>
        <span>·</span><span>{moment(r.createdAt || 0)}</span>
        {r.status === 'resolved' ? <Badge tone="good">حل شد</Badge> : r.fixes.length ? <Badge tone="info">درست شد</Badge> : null}
      </span>
    </button>
  );
}

function stateLine(r: SupportRequest, s: LiveState | undefined): string | null {
  if (r.fix === 'enable_flag' && s?.flag) {
    if (s.flag.hold) return 'اکنون: با «غیرفعال کردنِ سرویس» بسته است — اول همان حالت را از پروندهٔ دکان بردارید';
    return s.flag.effective ? 'اکنون: برای همین دکان روشن است' : 'اکنون: برای همین دکان خاموش است';
  }
  if ((r.fix === 'grant_subscription' || r.fix === 'raise_device_limit') && s?.subscription) {
    const sub = s.subscription;
    if (!sub.status || sub.status === 'none') return 'اکنون: اشتراکی ندارد';
    const st = sub.status === 'active' ? `فعال، ${fa(sub.daysLeft ?? 0)} روزِ مانده` : sub.status === 'expired' ? 'تمام شده' : sub.status === 'suspended' ? 'معلق' : sub.status;
    return `اکنون: اشتراک ${st}${sub.maxDevices ? ` · سقفِ ${fa(sub.maxDevices)} دستگاه` : ''}`;
  }
  return null;
}

const FIX_LABEL: Record<string, string> = {
  enable_flag: 'روشن کن برای همین دکان', grant_subscription: 'تمدیدِ اشتراک…', raise_device_limit: 'دستگاهِ بیشتر…',
  resend_email_code: 'کد را دوباره بفرست', show_sync_error: 'آخرین خطای همگام‌سازی',
};
const FIX_PATH: Record<string, string> = {
  enable_flag: 'enable-flag', grant_subscription: 'grant-subscription', raise_device_limit: 'raise-device-limit', resend_email_code: 'resend-email-code',
};
const RESULT_LABEL: Record<string, string> = { done: 'انجام شد', unchanged: 'از پیش همین بود', failed: 'نشد' };

/**
 *  کارتِ مشکل کنارِ گفت‌وگو: سرخط، دکان، واقعیت‌ها، حالِ زنده، دکمهٔ «درستش کن» و «حل شد». `onChanged` ⇒ صف و رشته تازه شوند
 *  (پاسخِ خودکارِ سرورِ حساب همان دم در گفت‌وگو می‌نشیند).
 */
export function ProblemCard({ request, onChanged }: { request: SupportRequest; onChanged: () => Promise<void> | void }) {
  const det = useLoad<DetailResp>(`${SR_BASE}/${encodeURIComponent(request.id)}`, [request.id], 'support');
  const r = det.data?.request && det.data.request.id ? det.data.request : request;
  const [confirm, setConfirm] = useState<null | 'enable_flag' | 'resolve'>(null);
  const [money, setMoney] = useState<null | 'grant_subscription' | 'raise_device_limit'>(null);
  const [days, setDays] = useState('30');
  const [devices, setDevices] = useState('');
  const [sync, setSync] = useState<SyncErr | null>(null);
  const [keys] = useState(() => ({ flag: newKey(), grant: newKey(), dev: newKey(), mail: newKey(), resolve: newKey() }));
  const open = r.status === 'open';
  const done = (a: string) => r.fixes.find((f) => f.action === a);
  const line = stateLine(r, det.data?.state);
  const sub = det.data?.state?.subscription;

  async function run(action: string, body: Record<string, unknown>, key: string) {
    try {
      const out = await api<{ already?: boolean; fix?: SrFix; replied?: boolean; pushed?: number }>(
        `${SR_BASE}/${encodeURIComponent(r.id)}/fix/${FIX_PATH[action]}`, { body: { shopId: r.shopId, idempotencyKey: key, ...body } });
      const res = out.fix?.result || 'done';
      toast(out.already ? 'همین کار پیش‌تر انجام شده بود' : res === 'unchanged' ? 'از پیش همین بود — چیزی عوض نشد'
        : `انجام شد${out.replied ? ' · پاسخِ خودکار در گفت‌وگو رفت' : ''}${out.pushed ? ` · خبر به ${fa(out.pushed)} دستگاهِ دکان` : ''}`);
      await det.reload();
      await onChanged();
    } catch (e) { toast(errMsg(e), 'bad'); }
  }
  async function resolve() {
    try {
      await api(`${SR_BASE}/${encodeURIComponent(r.id)}/resolve`, { body: { shopId: r.shopId, idempotencyKey: keys.resolve } });
      toast('حل شد');
      await det.reload();
      await onChanged();
    } catch (e) { toast(errMsg(e), 'bad'); }
  }
  async function loadSync() {
    try {
      setSync(await api<SyncErr>(`${SR_BASE}/${encodeURIComponent(r.id)}/sync-error?shopId=${encodeURIComponent(r.shopId)}`));
    } catch (e) { toast(errMsg(e), 'bad'); }
  }

  const facts = Object.entries(r.context || {}).filter(([k]) => FACT_LABEL[k]);
  return (
    <div className="m-3 rounded-2xl border p-3" style={{ borderColor: 'color-mix(in srgb, var(--status-warning) 40%, transparent)', background: 'color-mix(in srgb, var(--status-warning) 7%, var(--surface-1, transparent))' }} dir="rtl" data-problem-card={r.id}>
      <div className="flex items-start gap-2">
        <Wrench className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-extrabold text-ink">{r.title}</p>
          <p className="text-[11.5px] text-ink-muted">{PROBLEM_LABEL[r.problem] || r.problem}{r.shopName ? ` · ${r.shopName}` : ''} · {moment(r.createdAt || 0)}</p>
        </div>
        {r.status === 'resolved' ? <Badge tone="good">حل شد</Badge> : <Badge tone="warn">باز</Badge>}
      </div>
      {det.error && <div className="mt-2"><CloudProblem code={det.code} message={det.error} onRetry={det.reload} /></div>}
      {det.busy && !det.data ? <div className="mt-2"><Skeleton rows={2} /></div> : null}
      {line && <p className="mt-2 text-[12px] font-semibold text-ink" data-sr="state">{line}</p>}
      {facts.length > 0 && (
        <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[11.5px]">
          {facts.map(([k, v]) => (
            <span key={k} className="contents"><dt className="text-ink-muted">{FACT_LABEL[k]}</dt>
              <dd className="text-ink" dir="ltr">{k === 'platform' ? PLATFORM_LABEL[String(v)] || String(v) : typeof v === 'number' ? fa(v) : String(v)}</dd></span>
          ))}
        </dl>
      )}

      <div className="mt-3 flex flex-col gap-2">
        {open && r.fix === 'enable_flag' && !(det.data?.state?.flag?.effective && det.data.state.flag.explicit === true) && (
          <button className="btn btn-primary btn-sm justify-center" disabled={det.data?.state?.flag?.hold === true} onClick={() => setConfirm('enable_flag')} data-fix="enable_flag">
            {FIX_LABEL.enable_flag}
          </button>
        )}
        {open && (r.fix === 'grant_subscription' || r.fix === 'raise_device_limit') && (
          <button className="btn btn-primary btn-sm justify-center" onClick={() => { setDevices(String((sub?.maxDevices || 1) + 1)); setMoney(r.fix as 'grant_subscription' | 'raise_device_limit'); }} data-fix={r.fix}>
            {FIX_LABEL[r.fix]}
          </button>
        )}
        {open && r.fix === 'resend_email_code' && (
          <ActionButton className="btn btn-primary btn-sm justify-center" busyLabel="…" onClick={() => run('resend_email_code', {}, keys.mail)}>{FIX_LABEL.resend_email_code}</ActionButton>
        )}
        {r.fix === 'show_sync_error' && (
          <ActionButton className="btn btn-sm justify-center" busyLabel="…" onClick={loadSync}>{FIX_LABEL.show_sync_error}</ActionButton>
        )}
        {open && <button className="btn btn-sm justify-center" onClick={() => setConfirm('resolve')} data-sr="resolve"><CheckCircle2 className="h-3.5 w-3.5" /> حل شد</button>}
      </div>

      {r.fixes.length > 0 && (
        <ul className="mt-3 space-y-1 text-[11.5px] text-ink-muted" data-sr="fixes">
          {r.fixes.map((f) => (
            <li key={f.action}>✔ {FIX_LABEL[f.action] || f.action} — {RESULT_LABEL[f.result] || f.result} · {f.by || '—'} · {moment(f.at || 0)}</li>
          ))}
        </ul>
      )}
      {done('enable_flag') && open && <p className="mt-1 text-[11px] text-ink-muted">پاسخِ خودکار به مشتری رفت؛ اگر کارش راه افتاد «حل شد» را بزنید.</p>}

      {sync && (
        <div className="mt-3 rounded-xl border border-line bg-surface p-2 text-[11.5px]" data-sr="sync">
          <p className="font-bold text-ink">خطاهای ۷ روزِ اخیر: {fa(sync.weekCount)}</p>
          {sync.errors.length === 0 ? <p className="text-ink-muted">خطایی گزارش نشده.</p> : sync.errors.map((e) => (
            <div key={e.id} className="mt-1 border-t border-line pt-1">
              <p className="text-ink">{e.message || '—'}</p>
              <p className="text-ink-muted">{moment(e.at || 0)}{e.appVersion ? ` · نسخهٔ ${e.appVersion}` : ''}</p>
              {e.stack ? <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-[10.5px]" dir="ltr">{e.stack}</pre> : null}
            </div>
          ))}
          {sync.restricted && <p className="mt-1 text-ink-muted">جزئیاتِ خصوصی (Stack، لاگ، دستگاه) فقط با اجازهٔ دسترسیِ پشتیبانیِ خودِ دکان — کارتِ «دسترسیِ پشتیبانی» در پروندهٔ دکان.</p>}
        </div>
      )}

      <ConfirmDialog
        open={confirm === 'enable_flag'}
        title="روشن کردن برای همین دکان"
        message={`«${r.title}» — فقط برای «${r.shopName || r.shopId}» روشن می‌شود (دکان‌های دیگر و «همه» دست نمی‌خورند). در سابقه با پیش و پس می‌نشیند و به مشتری پاسخِ خودکار می‌رود.`}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => { setConfirm(null); await run('enable_flag', { resolve: true }, keys.flag); }}
      />
      <ConfirmDialog
        open={confirm === 'resolve'}
        title="حل شد"
        message="درخواست از صفِ «باز» بیرون می‌رود؛ گفت‌وگو باز می‌ماند و مشتری هر وقت بخواهد دوباره می‌نویسد."
        onCancel={() => setConfirm(null)}
        onConfirm={async () => { setConfirm(null); await resolve(); }}
      />
      {money && (
        <Modal open onClose={() => setMoney(null)} title={money === 'grant_subscription' ? 'تمدیدِ اشتراک' : 'سقفِ دستگاهِ اشتراک'}
          footer={<>
            <button className="btn" onClick={() => setMoney(null)}>انصراف</button>
            <ActionButton className="btn btn-primary" busyLabel="…" onClick={async () => {
              const m = money;
              setMoney(null);
              if (m === 'grant_subscription') await run(m, { confirm: true, days: Number(days), resolve: true }, keys.grant);
              else await run(m, { confirm: true, devices: Number(devices), resolve: true }, keys.dev);
            }} disabled={money === 'grant_subscription' ? !(Number(days) >= 1 && Number(days) <= 366) : !(Number(devices) >= 2 && Number(devices) <= 100)}>
              تأیید و انجام
            </ActionButton>
          </>}>
          <InlineNotice tone="warn">این کار پول و اشتراکِ «{r.shopName || r.shopId}» را عوض می‌کند — یک بار برای همین درخواست، با سابقه.</InlineNotice>
          {line && <p className="my-2 text-[12px] text-ink">{line}</p>}
          {money === 'grant_subscription' ? (
            <><label className="label">چند روز</label>
              <input className="input w-full" dir="ltr" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, '').slice(0, 3))} data-sr="days" /></>
          ) : (
            <><label className="label">سقفِ تازهٔ دستگاه</label>
              <input className="input w-full" dir="ltr" inputMode="numeric" value={devices} onChange={(e) => setDevices(e.target.value.replace(/\D/g, '').slice(0, 3))} data-sr="devices" /></>
          )}
        </Modal>
      )}
    </div>
  );
}

/** ستونِ درخواست‌ها (به‌جای فهرستِ گفت‌وگوها) */
export function RequestsColumn({ list, current, onPick }: {
  list: ReturnType<typeof useSupportRequests>; current: string; onPick: (r: SupportRequest) => void;
}) {
  const rows = list.data?.requests || [];
  if (list.data && list.data.available === false) {
    return <div className="p-4"><InlineNotice tone="info">{list.data.message || 'سرورِ حساب هنوز «از پشتیبانی بخواه» را ندارد — به‌روزش کنید.'}</InlineNotice></div>;
  }
  if (list.busy && !list.data) return <div className="p-3"><Skeleton rows={5} /></div>;
  if (!rows.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-ink-muted">
        <LifeBuoy className="h-6 w-6" /><p className="text-sm">درخواستی نیست</p>
      </div>
    );
  }
  return <>{rows.map((r) => <RequestRow key={r.id} r={r} active={r.threadId === current} onPick={() => onPick(r)} />)}</>;
}
