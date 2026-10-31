// ---------------------------------------------------------------------------
//  ۴.۳ — کاربران و نقش‌های مرکزی (جدا از کارکنانِ دکان)
//
//   • مدیرانِ سرورِ حساب (مالک · ارشد · مدیر · مالی · فقط‌خواندن، #597): فهرست، جست‌وجو و پالایش؛ ساختن (بی نقشِ
//     پیش‌فرض — «فقط‌خواندن» پیشنهاد می‌شود)، تعلیق/برگرداندن، عوض کردنِ نقش (هرگز روی مالک یا حسابِ خودِ پل)، نشست‌ها
//     و بستنشان. نوشتن فقط مالکِ پنل + رمزِ پنل + دلیل + تأیید + کلیدِ یکتایی — سرور می‌سنجد، نه این صفحه.
//   • کاربرانِ پنل: همان مدیریتِ یگانهٔ ‎/api/auth/users‎ (`PanelUsers`)، **فقط** وقتی سرورِ پنل حفاظتِ مالک را دارد
//     (فیلدِ `owner` ِ #108/#114)؛ وگرنه فقط‌خواندنی و صادقانه «پشتیبانی نمی‌شود».
//   • نشست‌های خودم (پنل) با بستن؛ نشست‌های دیگرانِ پنل در سرورِ پنل API ندارد ⇒ گفته می‌شود.
//   • جدولِ نقش‌ها: نقش‌های پرامپت ⇄ آن‌چه امروز واقعاً هست.
// ---------------------------------------------------------------------------
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { History, KeyRound, LogOut, Plus, ShieldCheck, UserCog, Users } from 'lucide-react';

import { api } from '../../../api';
import { useApp } from '../../../app-context';
import { Card } from '../../../components/ui';
import { Cell, Notice, Row, Table } from '../../../control/ui';
import PanelUsers from '../../control/PanelUsers';
import { useLoad, type Load } from '../shared';
import { Problem, SourceLine } from '../ShopConsole';
import { SHELL_API, type ModuleProps } from './contract';
import { NotSupported, SensitiveDialog, StateEmpty, StateLoading, errText, fmtTime, type SensitiveSubmit } from './parts';
import { useTx, type Tx } from './text';

type AdminRole = 'superadmin' | 'admin' | 'finance' | 'viewer';
type Admin = { id: string; username: string; name: string; role: AdminRole; status: 'active' | 'disabled'; isOwner: boolean; bridge: boolean; createdAt: number | null };
type AdminsResp =
  | { available: true; admins: Admin[]; roles: AdminRole[]; sessionsSupported: boolean; panelOwner: boolean; source: string; fetchedAt: number }
  | { available: false; reason: string; message?: string; fetchedAt: number };
type Sessions =
  | { available: true; sessions: { id: string; issuedAt: number; expiresAt: number; current?: boolean }[]; serverTime: number | null; fetchedAt: number }
  | { available: false; reason: string; capability?: string; needs?: string; message?: string };

const ROLES: AdminRole[] = ['viewer', 'finance', 'admin', 'superadmin'];

function roleText(tx: Tx, r: string) {
  switch (r) {
    case 'superadmin': return tx('مدیرِ ارشد', 'Super admin', 'لوی مدیر');
    case 'admin': return tx('مدیر', 'Admin', 'مدیر');
    case 'finance': return tx('مالی', 'Finance', 'مالي');
    case 'viewer': return tx('فقط‌خواندن', 'Read-only', 'یوازې لوستل');
    default: return r || '—';
  }
}
function roleEffect(tx: Tx, r: string) {
  switch (r) {
    case 'superadmin': return tx('همه‌چیز، از جمله مدیران، کلیدها، پول و تنظیمات.', 'Everything, including admins, keys, money and settings.', 'هر څه، د مدیرانو، کلیدونو، پیسو او تنظیماتو په ګډون.');
    case 'admin': return tx('کارِ روزانه (پشتیبانی، اشتراک، دکان)؛ نه مدیران، نه کلیدها، نه کارهای «فقط ارشد».', 'Daily work (support, subscriptions, shops); not admins, keys or super-admin-only actions.', 'ورځنی کار؛ مدیران، کلیدونه او د لوی مدیر کارونه نه.');
    case 'finance': return tx('فقط مالی: اشتراک، پرداخت، درخواستِ خرید، «پایانِ اشتراک»؛ نه پشتیبانی، کاربر یا تنظیم.', 'Finance only: subscriptions, payments, purchase requests, “subscription ended”; not support, users or settings.', 'یوازې مالي: ګډون، تادیه، د پېر غوښتنه.');
    default: return tx('فقط دیدن؛ هیچ نوشتنی.', 'View only; no writes.', 'یوازې کتل؛ هېڅ لیکل نه.');
  }
}

/* ───────────────────────── مدیرانِ سرورِ حساب ───────────────────────── */

type Action = { kind: 'create' } | { kind: 'role'; a: Admin } | { kind: 'status'; a: Admin } | { kind: 'revoke'; a: Admin; sessionId?: string };

function SessionsPanel({ a, canWrite, onRevoke }: { a: Admin; canWrite: boolean; onRevoke: (sessionId?: string) => void }) {
  const tx = useTx();
  const load = useLoad<Sessions>(SHELL_API.adminSessions(a.id), [a.id]);
  if (load.error) return <Problem load={load as Load<unknown>} />;
  if (!load.data) return <StateLoading />;
  const d = load.data;
  if (!d.available) {
    return <NotSupported needs={'needs' in d ? d.needs : undefined}>{'message' in d && d.message ? d.message : tx('این نسخهٔ سرورِ حساب فهرستِ نشست‌های مدیر را ندارد — به‌روزش کنید.', 'This account-server version cannot list admin sessions — update it.', 'د حساب سرور دا نسخه د مدیر ناستې نه ښيي.')}</NotSupported>;
  }
  return (
    <div className="mt-2">
      <Table head={[tx('نشست', 'Session', 'ناسته'), tx('از', 'Since', 'له'), tx('تا', 'Until', 'تر'), '']} empty={d.sessions.length === 0}>
        {d.sessions.map((s) => (
          <Row key={s.id}>
            <Cell mono>{s.id}{s.current ? ` (${tx('پل', 'bridge', 'پل')})` : ''}</Cell>
            <Cell>{fmtTime(s.issuedAt)}</Cell>
            <Cell>{fmtTime(s.expiresAt)}</Cell>
            <Cell>{canWrite && <button className="btn btn-sm" onClick={() => onRevoke(s.id)}>{tx('بستن', 'Revoke', 'تړل')}</button>}</Cell>
          </Row>
        ))}
      </Table>
      {canWrite && d.sessions.length > 0 && (
        <button className="btn btn-sm mt-2" onClick={() => onRevoke()}><LogOut size={13} />{tx('بستنِ همهٔ نشست‌ها', 'Revoke all sessions', 'ټولې ناستې وتړئ')}</button>
      )}
      <SourceLine source={`/api/admin/admins/${a.id}/sessions`} data={d} />
    </div>
  );
}

function AccountAdmins({ focus }: { focus: string }) {
  const tx = useTx();
  const load = useLoad<AdminsResp>(SHELL_API.admins);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(focus);
  const [act, setAct] = useState<Action | null>(null);
  const [done, setDone] = useState('');
  //  فرمِ ساختن/نقش
  const [nu, setNu] = useState({ username: '', name: '', role: 'viewer' as AdminRole, adminPassword: '' });
  const [newRole, setNewRole] = useState<AdminRole>('viewer');

  const d = load.data;
  const admins = d && d.available && Array.isArray(d.admins) ? d.admins : [];
  const rows = useMemo(() => admins.filter((a) => (!role || a.role === role) && (!status || a.status === status)
    && (!q.trim() || `${a.username} ${a.name} ${a.id}`.toLowerCase().includes(q.trim().toLowerCase()))), [admins, q, role, status]);

  if (load.error) return <Card title={tx('مدیرانِ سرورِ حساب', 'Account-server admins', 'د حساب سرور مدیران')} icon={<ShieldCheck size={15} />}><Problem load={load as Load<unknown>} /></Card>;
  if (!d) return <Card title={tx('مدیرانِ سرورِ حساب', 'Account-server admins', 'د حساب سرور مدیران')} icon={<ShieldCheck size={15} />}><StateLoading /></Card>;
  if (!d.available) {
    return (
      <Card title={tx('مدیرانِ سرورِ حساب', 'Account-server admins', 'د حساب سرور مدیران')} icon={<ShieldCheck size={15} />}>
        <NotSupported>{d.message || d.reason}</NotSupported>
      </Card>
    );
  }
  const canWrite = d.panelOwner === true;
  const gen = () => {
    const b = new Uint8Array(18);
    globalThis.crypto.getRandomValues(b);
    setNu((x) => ({ ...x, adminPassword: btoa(String.fromCharCode(...b)).replace(/[+/=]/g, '').slice(0, 20) + '!7' }));
  };

  const send = async (x: SensitiveSubmit) => {
    if (!act) return;
    if (act.kind === 'create') {
      const out = await api<{ admin: { username: string; role: string } }>(SHELL_API.admins, { method: 'POST', body: { ...nu, ...x, confirm: true } });
      setDone(tx('ساخته شد و سرورِ حساب تأیید کرد: {u} ({r})', 'Created and confirmed by the account server: {u} ({r})', 'جوړ شو او د حساب سرور تایید کړ: {u} ({r})', { u: out.admin.username, r: roleText(tx, out.admin.role) }));
      setNu({ username: '', name: '', role: 'viewer', adminPassword: '' });
    } else if (act.kind === 'role') {
      await api(SHELL_API.adminUpdate(act.a.id), { method: 'POST', body: { role: newRole, ...x, confirm: true } });
      setDone(tx('نقشِ {u} عوض شد — تأییدشده از سرورِ حساب', 'Role of {u} changed — confirmed by the account server', 'د {u} رول بدل شو — تایید شوی', { u: act.a.username }));
    } else if (act.kind === 'status') {
      const next = act.a.status === 'active' ? 'disabled' : 'active';
      await api(SHELL_API.adminUpdate(act.a.id), { method: 'POST', body: { status: next, ...x, confirm: true } });
      setDone(tx('وضعیتِ {u} عوض شد — تأییدشده از سرورِ حساب', 'Status of {u} changed — confirmed by the account server', 'د {u} حالت بدل شو — تایید شوی', { u: act.a.username }));
    } else if (act.kind === 'revoke') {
      const out = await api<{ revoked: number }>(SHELL_API.adminSessionsRevoke(act.a.id), { method: 'POST', body: { ...(act.sessionId ? { sessionId: act.sessionId } : {}), ...x, confirm: true } });
      setDone(tx('{n} نشست بسته شد — تأییدشده از سرورِ حساب', '{n} session(s) revoked — confirmed by the account server', '{n} ناستې وتړل شوې — تایید شوی', { n: out.revoked }));
    }
    setAct(null);
    await load.reload();
  };

  const locked = (a: Admin) => a.isOwner || a.bridge;
  return (
    <Card title={tx('مدیرانِ سرورِ حساب', 'Account-server admins', 'د حساب سرور مدیران')} icon={<ShieldCheck size={15} />}
          action={canWrite ? <button className="btn btn-sm btn-primary" onClick={() => { setDone(''); setAct({ kind: 'create' }); }}><Plus size={13} />{tx('مدیرِ تازه', 'New admin', 'نوی مدیر')}</button> : undefined}>
      {!canWrite && <Notice>{tx('فقط مالکِ پنل مدیر می‌سازد یا نقش و وضعیت را عوض می‌کند — شما فقط می‌بینید (سرور هم همین را می‌سنجد).', 'Only the panel owner can create admins or change roles/status — you can view (the server enforces this too).', 'یوازې د پینل مالک مدیر جوړوي یا رول بدلوي — تاسو یوازې کتلی شئ.')}</Notice>}
      {done && <Notice tone="good">{done}</Notice>}
      <div className="mb-3 flex flex-wrap gap-2">
        <input className="input w-full sm:w-60" placeholder={tx('نام، نامِ کاربری یا شناسه', 'Name, username or id', 'نوم، کارن نوم یا پېژند')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input w-auto" value={role} onChange={(e) => setRole(e.target.value)} aria-label={tx('نقش', 'Role', 'رول')}>
          <option value="">{tx('همهٔ نقش‌ها', 'All roles', 'ټول رولونه')}</option>
          {ROLES.map((r) => <option key={r} value={r}>{roleText(tx, r)}</option>)}
        </select>
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={tx('وضعیت', 'Status', 'حالت')}>
          <option value="">{tx('هر وضعیت', 'Any status', 'هر حالت')}</option>
          <option value="active">{tx('فعال', 'Active', 'فعال')}</option>
          <option value="disabled">{tx('تعلیق', 'Suspended', 'ځنډول شوی')}</option>
        </select>
      </div>
      <Table head={[tx('نامِ کاربری', 'Username', 'کارن نوم'), tx('نقش', 'Role', 'رول'), tx('وضعیت', 'Status', 'حالت'), tx('ساخته', 'Created', 'جوړ شوی'), '']} empty={rows.length === 0}>
        {rows.map((a) => (
          <Row key={a.id}>
            <Cell>
              <span className="font-mono" dir="ltr">{a.username}</span>{a.name && a.name !== a.username ? <span className="text-ink-muted"> · {a.name}</span> : null}
              {a.isOwner && <span className="chip mr-1 ml-1">{tx('مالکِ اصلی', 'Owner', 'اصلي مالک')}</span>}
              {a.bridge && <span className="chip mr-1 ml-1">{tx('حسابِ پل', 'Bridge account', 'د پل حساب')}</span>}
            </Cell>
            <Cell>{roleText(tx, a.role)}</Cell>
            <Cell style={a.status === 'active' ? undefined : { color: 'var(--status-warning)' }}>{a.status === 'active' ? tx('فعال', 'Active', 'فعال') : tx('تعلیق', 'Suspended', 'ځنډول شوی')}</Cell>
            <Cell>{fmtTime(a.createdAt)}</Cell>
            <Cell>
              <div className="flex flex-wrap gap-1">
                {d.sessionsSupported !== false && (
                  <button className="btn btn-sm" onClick={() => setOpen(open === a.id ? '' : a.id)}><KeyRound size={12} />{tx('نشست‌ها', 'Sessions', 'ناستې')}</button>
                )}
                {canWrite && !locked(a) && (
                  <>
                    <button className="btn btn-sm" onClick={() => { setDone(''); setNewRole(a.role); setAct({ kind: 'role', a }); }}><UserCog size={12} />{tx('نقش', 'Role', 'رول')}</button>
                    <button className="btn btn-sm" onClick={() => { setDone(''); setAct({ kind: 'status', a }); }}>
                      {a.status === 'active' ? tx('تعلیق', 'Suspend', 'ځنډول') : tx('برگرداندن', 'Restore', 'بېرته')}
                    </button>
                  </>
                )}
                {locked(a) && <span className="text-[11px] text-ink-muted">{a.isOwner ? tx('مالک دست نمی‌خورد', 'Owner is protected', 'مالک خوندي دی') : tx('پل با این حساب وارد می‌شود', 'The bridge signs in with it', 'پل پرې ننوځي')}</span>}
              </div>
            </Cell>
          </Row>
        ))}
      </Table>
      {open && admins.some((a) => a.id === open) && (
        <div className="mt-3 rounded-xl border border-line p-3">
          <p className="text-xs font-semibold">{tx('نشست‌های {u}', 'Sessions of {u}', 'د {u} ناستې', { u: admins.find((a) => a.id === open)!.username })}</p>
          <SessionsPanel a={admins.find((a) => a.id === open)!} canWrite={canWrite && !admins.find((a) => a.id === open)!.bridge}
                         onRevoke={(sessionId) => { setDone(''); setAct({ kind: 'revoke', a: admins.find((x) => x.id === open)!, sessionId }); }} />
        </div>
      )}
      {!d.sessionsSupported && (
        <p className="mt-2 text-[11px] text-ink-muted">{tx('فهرستِ نشست‌ها روی این نسخهٔ سرورِ حساب نیست (توانایی admin-sessions.v1)؛ تعلیقِ مدیر همهٔ نشست‌هایش را می‌بندد.', 'This account-server version has no session list (admin-sessions.v1); suspending an admin ends all their sessions.', 'د ناستو لېست نشته؛ د مدیر ځنډول یې ټولې ناستې تړي.')}</p>
      )}
      <SourceLine source={d.source} data={d} at={load.at} />
      <p className="mt-1 text-[11px] text-ink-muted">{tx('سابقهٔ سرورِ حساب این کارها را به نامِ حسابِ ارشدِ پل می‌نویسد (کلیدِ سرویس عمداً به مدیران راه ندارد)؛ آدمِ واقعی و دلیل در دفترِ پنل است.', 'The account server records these under the bridge’s super-admin account (the service key is deliberately denied access to admins); the real person and reason are in the panel audit log.', 'د حساب سرور دا کارونه د پل د حساب په نوم لیکي؛ اصلي کس او لامل د پینل په دفتر کې دي.')}</p>

      {act?.kind === 'create' && (
        <SensitiveDialog title={tx('مدیرِ تازهٔ سرورِ حساب', 'New account-server admin', 'د حساب سرور نوی مدیر')} needPassword onClose={() => setAct(null)}
                         disabled={!/^[a-z0-9._-]{3,40}$/.test(nu.username) || nu.adminPassword.length < 10}
                         effect={<>{roleText(tx, nu.role)}: {roleEffect(tx, nu.role)}</>} onSubmit={send} danger={nu.role === 'superadmin'}>
          <label className="block text-xs">{tx('نامِ کاربری (حروفِ کوچکِ انگلیسی، رقم، . _ -)', 'Username (lowercase letters, digits, . _ -)', 'کارن نوم')}
            <input className="input mt-1 w-full font-mono" dir="ltr" value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value.toLowerCase() })} autoComplete="off" />
          </label>
          <label className="block text-xs">{tx('نام', 'Name', 'نوم')}
            <input className="input mt-1 w-full" value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} />
          </label>
          <label className="block text-xs">{tx('نقش (کمینهٔ دسترسی: «فقط‌خواندن»)', 'Role (least privilege: read-only)', 'رول (لږ لاسرسی)')}
            <select className="input mt-1 w-full" value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value as AdminRole })}>
              {ROLES.map((r) => <option key={r} value={r}>{roleText(tx, r)}</option>)}
            </select>
          </label>
          <label className="block text-xs">{tx('رمزِ حسابِ تازه (دستِ‌کم ۱۰ نویسه؛ سرورِ حساب قوّتش را هم می‌سنجد)', 'New account password (≥10 chars; the account server checks strength too)', 'د نوي حساب پټنوم (لږ تر لږه ۱۰ توري)')}
            <span className="mt-1 flex gap-1">
              <input className="input w-full font-mono" dir="ltr" type="text" autoComplete="new-password" value={nu.adminPassword} onChange={(e) => setNu({ ...nu, adminPassword: e.target.value })} />
              <button type="button" className="btn btn-sm" onClick={gen}>{tx('ساختنِ تصادفی', 'Generate', 'جوړول')}</button>
            </span>
            <span className="mt-1 block text-[11px] text-ink-muted">{tx('این رمز فقط همین‌جا دیده می‌شود و جایی ذخیره یا ثبت نمی‌شود — همین حالا به صاحبش بدهید.', 'This password is shown only here and is never stored or logged — hand it over now.', 'دا پټنوم یوازې دلته ښودل کېږي.')}</span>
          </label>
        </SensitiveDialog>
      )}
      {act?.kind === 'role' && (
        <SensitiveDialog title={tx('نقشِ {u}', 'Role of {u}', 'د {u} رول', { u: act.a.username })} needPassword onClose={() => setAct(null)} disabled={newRole === act.a.role}
                         effect={<>{roleText(tx, act.a.role)} ⇒ {roleText(tx, newRole)}: {roleEffect(tx, newRole)}</>} onSubmit={send} danger={newRole === 'superadmin'}>
          <select className="input w-full" value={newRole} onChange={(e) => setNewRole(e.target.value as AdminRole)} aria-label={tx('نقشِ تازه', 'New role', 'نوی رول')}>
            {ROLES.map((r) => <option key={r} value={r}>{roleText(tx, r)}</option>)}
          </select>
        </SensitiveDialog>
      )}
      {act?.kind === 'status' && (
        <SensitiveDialog title={act.a.status === 'active' ? tx('تعلیقِ {u}', 'Suspend {u}', '{u} ځنډول', { u: act.a.username }) : tx('برگرداندنِ {u}', 'Restore {u}', '{u} بېرته', { u: act.a.username })}
                         needPassword danger={act.a.status === 'active'} onClose={() => setAct(null)} onSubmit={send}
                         effect={act.a.status === 'active'
                           ? tx('ورودش بسته می‌شود و همهٔ نشست‌هایش همان دم بسته می‌شوند. هیچ داده‌ای پاک نمی‌شود و برگشت‌پذیر است.', 'Sign-in is blocked and all sessions end at once. No data is deleted; reversible.', 'ننوتل یې بندېږي او ټولې ناستې یې تړل کېږي. هېڅ معلومات نه ړنګېږي.')
                           : tx('دوباره می‌تواند وارد شود (با همان نقش).', 'They can sign in again (same role).', 'بیا ننوتلی شي.')} />
      )}
      {act?.kind === 'revoke' && (
        <SensitiveDialog title={act.sessionId ? tx('بستنِ یک نشستِ {u}', 'Revoke one session of {u}', 'د {u} یوه ناسته تړل', { u: act.a.username }) : tx('بستنِ همهٔ نشست‌های {u}', 'Revoke all sessions of {u}', 'د {u} ټولې ناستې تړل', { u: act.a.username })}
                         needPassword onClose={() => setAct(null)} onSubmit={send}
                         effect={tx('آن دستگاه(ها) همان دم بیرون می‌افتند و باید دوباره وارد شوند. حساب تعلیق نمی‌شود.', 'The device(s) are signed out at once and must sign in again. The account is not suspended.', 'هغه وسیلې سمدستي وځي. حساب نه ځنډول کېږي.')} />
      )}
    </Card>
  );
}

/* ───────────────────────── کاربرانِ پنل ───────────────────────── */

type PanelUser = { id: number; username: string; role: string; disabled: boolean; owner?: boolean; last_login?: number | null };

function PanelUsersSection() {
  const tx = useTx();
  const load = useLoad<{ users?: PanelUser[] }>('/api/auth/users');
  const users = Array.isArray(load.data?.users) ? load.data!.users! : [];
  //  ⛔ مدیریت فقط با حفاظتِ مالک در **سرورِ پنل** (#108/#114 ⇒ فیلدِ `owner`)؛ وگرنه تنزل/بستنِ مالک از این‌جا ممکن بود
  const protectedByServer = users.some((u) => typeof u.owner === 'boolean');
  return (
    <Card title={tx('کاربرانِ پنل', 'Panel users', 'د پینل کاروونکي')} icon={<Users size={15} />}>
      {load.error ? <Problem load={load as Load<unknown>} /> : !load.data ? <StateLoading /> : protectedByServer ? (
        <PanelUsers />
      ) : (
        <>
          <NotSupported needs="owner protection — PR #108 / #114">
            {tx('مدیریتِ کاربرانِ پنل از این‌جا وقتی باز می‌شود که سرورِ پنل حفاظتِ مالک را داشته باشد (مالک تنزل، تعلیق یا حذف نشود). تا آن روز فقط فهرست دیده می‌شود.',
              'Managing panel users here opens once the panel server has owner protection (the owner can never be demoted, suspended or deleted). Until then this list is read-only.',
              'د پینل کاروونکو مدیریت هغه وخت پرانیستل کېږي چې سرور د مالک ساتنه ولري.')}
          </NotSupported>
          <Table head={[tx('نامِ کاربری', 'Username', 'کارن نوم'), tx('نقش', 'Role', 'رول'), tx('وضعیت', 'Status', 'حالت')]} empty={users.length === 0}>
            {users.map((u) => (
              <Row key={u.id}>
                <Cell mono>{u.username}</Cell>
                <Cell>{u.role}</Cell>
                <Cell>{u.disabled ? tx('بسته', 'Disabled', 'بند') : tx('فعال', 'Active', 'فعال')}</Cell>
              </Row>
            ))}
          </Table>
          <SourceLine source="/api/auth/users" at={load.at} />
        </>
      )}
    </Card>
  );
}

type MySession = { id: string; created_at?: number; last_seen_at?: number | null; user_agent?: string; ip?: string; current?: boolean };

function MySessions() {
  const tx = useTx();
  const load = useLoad<{ sessions?: MySession[] }>('/api/auth/sessions');
  const [err, setErr] = useState('');
  const rows = Array.isArray(load.data?.sessions) ? load.data!.sessions! : [];
  const revoke = async (id: string) => {
    setErr('');
    try { await api(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }); await load.reload(); } catch (e) { setErr(errText(e)); }
  };
  return (
    <Card title={tx('نشست‌های من در پنل', 'My panel sessions', 'په پینل کې زما ناستې')} icon={<KeyRound size={15} />}>
      {load.error ? <Problem load={load as Load<unknown>} /> : !load.data ? <StateLoading /> : (
        <>
          {err && <Notice tone="bad">{err}</Notice>}
          <Table head={[tx('دستگاه', 'Device', 'وسیله'), 'IP', tx('آخرین بار', 'Last seen', 'وروستی ځل'), '']} empty={rows.length === 0}>
            {rows.map((s) => (
              <Row key={s.id}>
                <Cell><span className="block max-w-[18rem] truncate" dir="ltr">{s.user_agent || '—'}</span></Cell>
                <Cell mono>{s.ip || '—'}</Cell>
                <Cell>{fmtTime(s.last_seen_at || s.created_at)}</Cell>
                <Cell>{s.current ? tx('همین دستگاه', 'This device', 'همدا وسیله') : <button className="btn btn-sm" onClick={() => revoke(s.id)}>{tx('بستن', 'Revoke', 'تړل')}</button>}</Cell>
              </Row>
            ))}
          </Table>
          <p className="mt-2 text-[11px] text-ink-muted">{tx('نشست‌های کاربرانِ دیگرِ پنل در سرورِ پنل API ندارد؛ بستنِ یک کاربر همهٔ نشست‌هایش را می‌بندد.', 'The panel server has no API for other users’ sessions; disabling a user ends all their sessions.', 'د نورو کاروونکو ناستو لپاره API نشته.')}</p>
          <SourceLine source="/api/auth/sessions" at={load.at} />
        </>
      )}
    </Card>
  );
}

/* ───────────────────────── نقش‌ها و دفتر ───────────────────────── */

function RolesMatrix() {
  const tx = useTx();
  const rows: [string, string, string][] = [
    [tx('مالک', 'Owner', 'مالک'), tx('قدیمی‌ترین مدیرِ فعالِ پنل — هرگز تنزل/تعلیق/حذف نمی‌شود', 'Oldest active panel admin — never demoted/suspended/deleted', 'تر ټولو زوړ فعال مدیر'), tx('`is_owner` (یکی) — همان قاعده', '`is_owner` (one) — same rule', '`is_owner`')],
    [tx('مدیرِ سیستم', 'System admin', 'د سیستم مدیر'), 'admin', 'superadmin'],
    [tx('پشتیبانی / فنی', 'Support / technical', 'ملاتړ / تخنیکي'), 'operator', 'admin'],
    [tx('مالی', 'Finance', 'مالي'), tx('— (در پنل نیست)', '— (not in the panel)', '— (په پینل کې نشته)'), 'finance'],
    [tx('محدود / فقط‌خواندن', 'Limited / read-only', 'محدود / یوازې لوستل'), 'viewer', 'viewer'],
  ];
  return (
    <Card title={tx('نقش‌ها', 'Roles', 'رولونه')} icon={<ShieldCheck size={15} />}>
      <Table head={[tx('نقشِ پرامپت', 'Prompt role', 'د پرامپټ رول'), tx('پنل', 'Panel', 'پینل'), tx('سرورِ حساب', 'Account server', 'د حساب سرور')]}>
        {rows.map((r) => (<Row key={r[0]}><Cell>{r[0]}</Cell><Cell mono>{r[1]}</Cell><Cell mono>{r[2]}</Cell></Row>))}
      </Table>
      <p className="mt-2 text-[11px] text-ink-muted">{tx('مرزِ هر نقش در سرور سنجیده می‌شود (پنل: control/roles.js؛ سرورِ حساب: lib/admin-roles.js) — پنهان شدنِ دکمه امنیت نیست.', 'Each role’s boundary is enforced on the server (panel: control/roles.js; account server: lib/admin-roles.js) — hiding a button is not security.', 'د هر رول پوله په سرور کې کتل کېږي.')}</p>
    </Card>
  );
}

type AuditRow = { id: number; actor?: string; action?: string; entity_id?: string; detail?: string; result?: string; at?: number };

function RecentAudit() {
  const tx = useTx();
  const load = useLoad<{ rows?: AuditRow[] }>('/api/control/audit?q=account.admin&limit=20');
  const rows = Array.isArray(load.data?.rows) ? load.data!.rows! : [];
  return (
    <Card title={tx('دفترِ کارهای مدیران', 'Admin changes log', 'د مدیرانو د بدلونونو دفتر')} icon={<History size={15} />}>
      {load.error ? <Problem load={load as Load<unknown>} /> : !load.data ? <StateLoading /> : rows.length === 0 ? (
        <StateEmpty>{tx('هنوز کاری ثبت نشده', 'Nothing recorded yet', 'تر اوسه هیڅ نه دي ثبت شوي')}</StateEmpty>
      ) : (
        <Table head={[tx('کی', 'When', 'کله'), tx('چه کسی', 'Who', 'څوک'), tx('چه کاری', 'What', 'څه'), tx('روی', 'Target', 'پر'), tx('نتیجه', 'Result', 'پایله')]}>
          {rows.map((r) => (
            <Row key={r.id}>
              <Cell>{fmtTime(r.at)}</Cell><Cell>{r.actor || '—'}</Cell><Cell mono>{r.action}</Cell><Cell mono>{r.entity_id || '—'}</Cell><Cell>{r.result || '—'}</Cell>
            </Row>
          ))}
        </Table>
      )}
      <p className="mt-2 text-[11px]"><Link className="underline" to="/shop?tab=audit">{tx('همهٔ دفترِ رخداد', 'Full audit log', 'بشپړ دفتر')}</Link> · <Link className="underline" to="/logs?tab=audit">{tx('دفترِ پنل (کاربرانِ پنل)', 'Panel log (panel users)', 'د پینل دفتر')}</Link></p>
      <SourceLine source="/api/control/audit?q=account.admin" at={load.at} />
    </Card>
  );
}

export default function UsersModule({ params }: ModuleProps) {
  const { can } = useApp();
  const tx = useTx();
  if (!can('admin')) {
    return <Notice tone="bad">{tx('کاربران و نقش‌ها فقط برای مدیرِ پنل است.', 'Users & roles is for panel admins only.', 'یوازې د پینل مدیر لپاره.')}</Notice>;
  }
  return (
    <div className="space-y-4">
      <AccountAdmins focus={params.get('admin') || ''} />
      <PanelUsersSection />
      <MySessions />
      <div className="grid gap-4 lg:grid-cols-2">
        <RolesMatrix />
        <RecentAudit />
      </div>
    </div>
  );
}
