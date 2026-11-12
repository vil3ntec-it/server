// ---------------------------------------------------------------------------
//  🔐 دسترسیِ پشتیبانی به دادهٔ همین دکان — پروندهٔ دکان (۲-۹، G1؛ ACP-D1 الف و ACP-D2 الف؛ ۱.۵۰.۹۰)
//
//  ⛔ همه از ‎/console/shops/:id/access-grants‎ ⇐ ‎/api/admin/shops/:id/access-grants‎ ِ سرورِ حساب (‎support-access.v1‎). بی آن
//     ⇒ «سرورِ حساب هنوز این را ندارد» — هیچ اجازهٔ ساختگی.
//  ⛔ مدت پیش‌فرض ۶۰ دقیقه، سقفِ ۲۴ ساعت (ACP-D1)؛ تمدید = درخواستِ تازه با دلیلِ تازه. «درخواست» تا پذیرشِ صاحبِ دکان در برنامه‌اش
//     «منتظر» است. «شکستنِ شیشه» (بی رضایت، ACP-D2) فقط برای مالکِ پنل، با رمزِ دوباره و دلیلِ نوشته (۱۰ نویسه به بالا)؛ صاحبِ دکان
//     همان دم خبر می‌گیرد — این را **سرورِ حساب** تأیید می‌کند (`notified`)، نه این صفحه.
//  ⛔ هر کار از `SensitiveDialog` (دلیل + تأیید + یک کلیدِ یکتایی برای همان پنجره). متن‌ها فقط متن‌اند.
//  ۱.۵۰.۹۸ (TEN-04): لنگرِ ‎#support-access‎ — پیامِ «اجازهٔ دسترسیِ پشتیبانی لازم است» (`GrantNeeded`) از هر جای پنل به همین کارت می‌آورد.
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { KeyRound } from 'lucide-react';

import { api } from '../../../api';
import { Card, Loading } from '../../../components/ui';
import { useApp } from '../../../app-context';
import { Cell, Notice, Row, Table } from '../../../control/ui';
import { useLoad, type Load } from '../shared';
import { Problem, SourceLine } from '../ShopConsole';
import { isUnavailable, shown, type Unavailable } from '../consoleData';
import { NotSupported, SensitiveDialog, StateEmpty, fmtTime, type SensitiveSubmit } from './parts';
import { SUPPORT_ACCESS_ANCHOR } from './GrantNeeded';
import { useTx, type Tx } from './text';

type Grant = { id: string; scope: string; consent: string; status: string; reason: string; requestedBy: string; grantedBy: string; startsAt: number | null; expiresAt: number | null; revokedAt: number | null; notifiedAt: number | null; uses: number };
type Doc = { available: true; grants: Grant[]; policy: { defaultMinutes: number; maxMinutes: number; minMinutes: number; scopes: string[] }; owner: boolean; fetchedAt: number };
type Mode = { kind: 'request' } | { kind: 'break' } | { kind: 'revoke'; id: string };

const scopeLabel = (tx: Tx, s: string) => ({
  read_private: tx('دیدنِ دادهٔ خصوصی', 'Read private data', 'خصوصي معلومات لیدل'), export: tx('خروجی', 'Export', 'صادرول'),
  restore: tx('بازگرداندن', 'Restore', 'بېرته راوستل'), view_as: tx('دیدن به‌جای کاربر', 'View as user', 'د کارن په توګه لیدل'),
} as Record<string, string>)[s] || s || '—';
const statusLabel = (tx: Tx, s: string) => ({
  pending: tx('منتظرِ پذیرشِ دکان', 'Awaiting the shop', 'د هټۍ منلو ته منتظر'), active: tx('فعال', 'Active', 'فعال'), expired: tx('گذشته', 'Expired', 'تېر شوی'),
  revoked: tx('لغوشده', 'Revoked', 'لغوه شوی'), denied: tx('ردِ دکان', 'Denied by the shop', 'هټۍ رد کړ'),
} as Record<string, string>)[s] || s || '—';

export default function SupportAccessCard({ shopId }: { shopId: string }) {
  const tx = useTx();
  const { can } = useApp();
  const admin = can('admin');
  const base = `/api/account-admin/console/shops/${encodeURIComponent(shopId)}/access-grants`;
  const load = useLoad<Doc | Unavailable>(base, [shopId]);
  const [mode, setMode] = useState<Mode | null>(null);
  const [minutes, setMinutes] = useState('60');
  const [scope, setScope] = useState('read_private');
  const [password, setPassword] = useState('');
  const [done, setDone] = useState<{ tone: 'good' | 'warn'; text: string } | null>(null);
  const title = tx('دسترسیِ پشتیبانی', 'Support access', 'د ملاتړ لاسرسی');
  const { hash } = useLocation();
  const anchor = useRef<HTMLDivElement>(null);
  const ready = Boolean(load.data || load.error);
  //  آمده از «اجازه لازم است» (‎…#support-access‎) ⇒ همین کارت، پس از رسیدنِ داده (تا جایش جابه‌جا نشود)
  useEffect(() => {
    if (hash !== `#${SUPPORT_ACCESS_ANCHOR}` || !ready) return;
    anchor.current?.scrollIntoView({ block: 'start' });
    anchor.current?.focus({ preventScroll: true });
  }, [hash, ready]);
  const wrap = (body: ReactNode) => (
    <div ref={anchor} id={SUPPORT_ACCESS_ANCHOR} data-card="support-access" data-shop={shopId} tabIndex={-1} className="scroll-mt-4 outline-none">
      <Card title={title} icon={<KeyRound size={15} />}>{body}</Card>
    </div>
  );

  if (load.error) return wrap(<Problem load={load as Load<unknown>} />);
  if (!load.data) return wrap(<Loading />);
  if (isUnavailable(load.data)) {
    return wrap(
      <NotSupported needs={load.data.needs || 'GET|POST /api/admin/shops/:id/access-grants'}>
        <span data-access-old>{tx('سرورِ حساب هنوز اجازهٔ موقتِ پشتیبانی (support-access.v1) را ندارد — تا آن روز این‌جا هیچ اجازه‌ای ساخته یا نشان داده نمی‌شود.',
          'The account server has no temporary support access yet (support-access.v1) — until then nothing is granted or shown here.',
          'د حساب سرور لا د ملاتړ لنډمهاله لاسرسی (support-access.v1) نه لري.')}</span>
      </NotSupported>,
    );
  }
  const d = load.data;
  const max = d.policy?.maxMinutes || 1440;
  const min = d.policy?.minMinutes || 5;
  const m = Number(minutes);
  const minutesOk = Number.isInteger(m) && m >= min && m <= max;
  const grants = Array.isArray(d.grants) ? d.grants : [];

  const submit = async (x: SensitiveSubmit) => {
    if (!mode) return;
    if (mode.kind === 'revoke') {
      await api(`${base}/${encodeURIComponent(mode.id)}/revoke`, { method: 'POST', body: { ...x, confirm: true } });
      setDone({ tone: 'good', text: tx('اجازه لغو شد', 'Access revoked', 'لاسرسی لغوه شو') });
    } else if (mode.kind === 'request') {
      await api(`${base}`, { method: 'POST', body: { ...x, confirm: true, minutes: m, scope } });
      setDone({ tone: 'good', text: tx('درخواست رفت — تا صاحبِ دکان در برنامه‌اش بپذیرد «منتظر» می‌ماند', 'Request sent — it stays pending until the shop owner accepts in their app', 'غوښتنه ولېږل شوه') });
    } else {
      const out = await api<{ notified: boolean }>(`${base}/break-glass`, { method: 'POST', body: { ...x, confirm: true, minutes: m, scope, password } });
      setDone(out.notified
        ? { tone: 'good', text: tx('دسترسیِ اضطراری باز شد و صاحبِ دکان همان دم خبر گرفت', 'Emergency access opened and the shop owner was notified right away', 'بېړنی لاسرسی پرانیستل شو او مالک خبر شو') }
        : { tone: 'warn', text: tx('دسترسیِ اضطراری باز شد، ولی سرورِ حساب نگفت خبر به صاحبِ دکان رسید — خودتان به او بگویید', 'Emergency access opened, but the account server did not confirm the owner was notified — tell them yourself', 'بېړنی لاسرسی پرانیستل شو، خو خبر نه دی تایید شوی') });
    }
    setMode(null); setPassword('');
    await load.reload();
  };

  return wrap(
    <>
      <p className="text-[11px] text-ink-muted">{tx('دیدنِ دادهٔ خصوصیِ دکان فقط با اجازهٔ موقت: پیش‌فرض ۶۰ دقیقه، حداکثر ۲۴ ساعت. هر استفاده در سابقهٔ دکان می‌ماند و صاحبِ دکان می‌بیند.',
        'Private shop data only with temporary access: 60 minutes by default, 24 hours at most. Every use is logged and visible to the shop owner.', 'خصوصي معلومات یوازې په لنډمهاله اجازه: ۶۰ دقیقې، تر ۲۴ ساعتونو.')}</p>
      {done && <Notice tone={done.tone}>{done.text}</Notice>}
      {grants.length === 0 ? <StateEmpty>{tx('اجازه‌ای نیست', 'No grants', 'اجازه نشته')}</StateEmpty> : (
        <Table head={[tx('دامنه', 'Scope', 'ساحه'), tx('رضایت', 'Consent', 'رضایت'), tx('وضعیت', 'Status', 'حالت'), tx('دلیل', 'Reason', 'دلیل'), tx('تا', 'Until', 'تر'), tx('استفاده', 'Uses', 'کارونه'), '']}>
          {grants.map((g) => (
            <Row key={g.id}>
              <Cell>{scopeLabel(tx, g.scope)}</Cell>
              <Cell>{g.consent === 'break_glass' ? tx('شکستنِ شیشه', 'Break-glass', 'بېړنی') : tx('رضایتِ دکان', 'Shop consent', 'د هټۍ رضایت')}{g.consent === 'break_glass' && g.notifiedAt ? ` · ${tx('خبر رفت', 'notified', 'خبر شو')}` : ''}</Cell>
              <Cell>{statusLabel(tx, g.status)}</Cell>
              <Cell>{g.reason || '—'}</Cell>
              <Cell>{fmtTime(g.expiresAt)}</Cell>
              <Cell mono>{shown(g.uses)}</Cell>
              <Cell>{admin && (g.status === 'active' || g.status === 'pending') && <button className="btn btn-sm" onClick={() => { setDone(null); setMode({ kind: 'revoke', id: g.id }); }}>{tx('لغو', 'Revoke', 'لغوه')}</button>}</Cell>
            </Row>
          ))}
        </Table>
      )}
      {admin && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" data-access-new>
          <label>{tx('دامنه', 'Scope', 'ساحه')} <select className="input" value={scope} onChange={(e) => setScope(e.target.value)}>
            {(d.policy?.scopes || ['read_private']).map((s) => <option key={s} value={s}>{scopeLabel(tx, s)}</option>)}
          </select></label>
          <label>{tx('دقیقه', 'Minutes', 'دقیقې')} <input className="input w-20 font-mono" dir="ltr" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-invalid={!minutesOk} /></label>
          {!minutesOk && <span style={{ color: 'var(--status-warning)' }}>{tx('{a} تا {b} دقیقه', '{a} to {b} minutes', '{a} تر {b} دقیقې', { a: shown(min), b: shown(max) })}</span>}
          <button className="btn btn-sm btn-primary" disabled={!minutesOk} onClick={() => { setDone(null); setMode({ kind: 'request' }); }}>{tx('درخواست از صاحبِ دکان…', 'Ask the shop owner…', 'له مالک غوښتنه…')}</button>
          {d.owner && <button className="btn btn-sm btn-danger" disabled={!minutesOk} onClick={() => { setDone(null); setMode({ kind: 'break' }); }}>{tx('شکستنِ شیشه…', 'Break-glass…', 'بېړنی…')}</button>}
        </div>
      )}
      <SourceLine source="/api/admin/shops/:id/access-grants" data={d} at={load.at} />
      {mode && (
        <SensitiveDialog
          title={mode.kind === 'revoke' ? tx('لغوِ اجازه', 'Revoke access', 'لاسرسی لغوه') : mode.kind === 'request' ? tx('درخواستِ دسترسیِ پشتیبانی', 'Request support access', 'د ملاتړ لاسرسي غوښتنه') : tx('شکستنِ شیشه — دسترسی بی رضایتِ دکان', 'Break-glass — access without shop consent', 'بېړنی لاسرسی')}
          danger={mode.kind === 'break'}
          disabled={mode.kind === 'break' && password.length === 0}
          onClose={() => { setMode(null); setPassword(''); }} onSubmit={submit} onUnknown={() => { void load.reload(); }}
          effect={mode.kind === 'revoke'
            ? tx('این اجازه همین حالا بسته می‌شود.', 'This grant closes right now.', 'دا اجازه همدا اوس بندېږي.')
            : mode.kind === 'request'
              ? tx('{s} برای {n} دقیقه — فقط پس از پذیرشِ صاحبِ دکان در برنامه‌اش باز می‌شود.', '{s} for {n} minutes — opens only once the shop owner accepts in their app.', '{s} د {n} دقیقو لپاره.', { s: scopeLabel(tx, scope), n: shown(m) })
              : tx('{s} برای {n} دقیقه، بی رضایتِ دکان. فقط در خرابیِ فوری؛ دلیل (دست‌کم ۱۰ نویسه) به صاحبِ دکان نشان داده می‌شود و او همان دم خبر می‌گیرد.',
                '{s} for {n} minutes without the shop\'s consent. Emergencies only; the reason (10+ characters) is shown to the shop owner, who is notified right away.', '{s} د {n} دقیقو لپاره، بې رضایته.', { s: scopeLabel(tx, scope), n: shown(m) })}>
          {mode.kind === 'break' && (
            <label className="block text-xs">{tx('رمزِ پنلِ خودتان', 'Your panel password', 'ستاسو د پینل پټنوم')}
              <input type="password" className="input mt-1 w-full" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
          )}
        </SensitiveDialog>
      )}
    </>,
  );
}
