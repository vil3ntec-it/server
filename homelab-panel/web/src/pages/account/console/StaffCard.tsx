// ---------------------------------------------------------------------------
//  👥 کارکنان، مجوزها و دستگاه‌های یک دکان — در پروندهٔ دکان (۱.۵۰.۷۵، ممیزی §۳-۴)
//
//  ⛔ همه از `GET /console/shops/:id/staff` ⇐ ‎/api/admin/shops/:id/staff-perms‎ ِ سرورِ حساب؛ هیچ مجوزی این‌جا حساب
//     نمی‌شود — «مؤثر» همان است که سرورِ حساب با هستهٔ مجوز (perm-core) ساخته. نیامده ⇒ «—».
//  ⛔ «از کار انداختنِ دستگاه»: فقط admin (مرز در سرور است؛ دکمه فقط برای درخواستِ بی‌نتیجه نزدن پنهان می‌شود) +
//     دلیل + تأیید + یک کلیدِ یکتایی برای همین پنجره (`SensitiveDialog`). «تأییدشده از سرورِ حساب» فقط پس از پاسخ؛
//     مهلتِ پل ⇒ «نتیجه معلوم نیست» و فهرست دوباره خوانده می‌شود.
//  ⛔ برگرداندنِ دستگاه (۱.۵۰.۷۷): فقط وقتی سرورِ حساب `staff-perms.v1` را اعلام کرده (`canEnable`) — همان پنجرهٔ حساس؛
//     سرورِ کهنه ⇒ همان «پشتیبانی نمی‌شود» با نامِ درِ لازم، نه دکمهٔ بی‌عمل.
//  ⛔ صفحه‌بندی: سرورِ تازه `page` می‌دهد (هر دو فهرست با همان limit/offset) ⇒ «قبلی/بعدی»؛ سرورِ کهنه ⇒ همان یک‌جا، و اگر
//     پل بیش از ۵۰۰ تا را نشان نداد (`truncated`) گفته می‌شود.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { Users } from 'lucide-react';

import { api } from '../../../api';
import { Loading } from '../../../components/ui';
import { useApp } from '../../../app-context';
import { Cell, Notice, Row, Table } from '../../../control/ui';
import { useLoad, type Load } from '../shared';
import { Problem, SourceLine } from '../ShopConsole';
import { shown } from '../consoleData';
import { NotSupported, SensitiveDialog, StateEmpty, fmtTime } from './parts';
import { useTx, type Tx } from './text';

type Perm = { mode?: 'allow' | 'approve' | 'deny'; caps?: Record<string, number> };
type PermMap = Record<string, Perm>;
type Member = { id: string; userId: string; name: string; role: string; status: string; layer: PermMap; effective: PermMap; customRole?: { id: string; name: string } };
type Device = {
  id: string; name: string; platform: string; status: string; createdAt: number | null; lastSeenAt: number | null; disabledAt: number | null;
  blockedAttempts: number | null; lastBlockedAt: number | null; member: { userId: string; role: string; name: string };
};
type Page = { limit: number; offset: number; membersTotal: number | null; devicesTotal: number | null; nextOffset: number | null };
type Staff = {
  available: boolean; fetchedAt: number; shop: { id: string; name: string };
  catalog: { key: string; edit: string; approvable: boolean; display: boolean }[];
  roles: Record<string, PermMap>; members: Member[]; devices: Device[]; notSupported: string[];
  page?: Page | null; truncated?: boolean; canEnable?: boolean;
};

export const staffApi = (shopId: string) => `/api/account-admin/console/shops/${encodeURIComponent(shopId)}/staff`;

function roleLabel(tx: Tx, r: string) {
  switch (r) {
    case 'owner': return tx('صاحبِ دکان', 'Owner', 'د هټۍ خاوند');
    case 'manager': return tx('مدیر', 'Manager', 'مدیر');
    case 'staff': return tx('شاگرد', 'Staff', 'شاګرد');
    case 'cashier': return tx('صندوق‌دار', 'Cashier', 'صندوق‌دار');
    case 'storekeeper': return tx('انباردار', 'Storekeeper', 'ګودام‌دار');
    case 'picker': return tx('جمع‌آور', 'Picker', 'راټولوونکی');
    case 'accountant': return tx('حسابدار', 'Accountant', 'حساب‌دار');
    default: return r || '—';
  }
}
function modeLabel(tx: Tx, m?: string) {
  if (m === 'allow') return tx('مجاز', 'Allowed', 'اجازه');
  if (m === 'approve') return tx('نیازمندِ تأیید', 'Needs approval', 'تایید ته اړتیا');
  if (m === 'deny') return tx('ممنوع', 'Denied', 'منع');
  return '—';
}
const capsText = (c?: Record<string, number>) => (c && Object.keys(c).length ? ` (${Object.entries(c).map(([k, v]) => `${k} ${shown(v)}`).join('، ')})` : '');

function PermList({ map, tx }: { map: PermMap; tx: Tx }) {
  const rows = Object.entries(map || {});
  if (!rows.length) return <span className="text-ink-muted">—</span>;
  return (
    <ul className="space-y-0.5 text-[11px]">
      {rows.map(([k, p]) => <li key={k}><code dir="ltr">{k}</code>: {modeLabel(tx, p.mode)}{capsText(p.caps)}</li>)}
    </ul>
  );
}

/** «۱–۵۰ / ۲۳۰» — جمعِ نیامده ⇒ «—» */
function span(from: number, count: number, total: number | null) {
  return count ? `${shown(from + 1)}–${shown(from + count)} / ${total === null ? '—' : shown(total)}` : `0 / ${total === null ? '—' : shown(total)}`;
}

export default function StaffCard({ shopId }: { shopId: string }) {
  const tx = useTx();
  const { can } = useApp();
  const [offset, setOffset] = useState(0);
  const load = useLoad<Staff>(`${staffApi(shopId)}${offset ? `?offset=${offset}` : ''}`, [shopId, offset]);
  const [target, setTarget] = useState<{ device: Device; act: 'disable' | 'enable' } | null>(null);
  const [done, setDone] = useState<{ name: string; act: 'disable' | 'enable'; sessions: number | null } | null>(null);
  const d = load.data;
  const page = d?.page || null;
  const goto = (o: number) => { setDone(null); setOffset(Math.max(0, o)); };
  const members = Array.isArray(d?.members) ? d!.members : [];
  const devices = Array.isArray(d?.devices) ? d!.devices : [];
  const roleLayers = Object.entries(d?.roles || {}).filter(([, l]) => Object.keys(l || {}).length > 0);

  return (
    <div data-card="shop-staff" className="space-y-3">
      <h3 className="flex items-center gap-1 text-xs font-semibold"><Users size={13} />{tx('کارکنان، مجوزها و دستگاه‌ها', 'Staff, permissions & devices', 'کارکوونکي، اجازې او وسایل')}</h3>
      {load.error ? (
        <>
          <Problem load={load as Load<unknown>} shopId={shopId}
                   grantWhat={tx('اجازه‌ها و دستگاه‌های کارکنانِ این دکان', 'This shop’s staff permissions and devices', 'د دې هټۍ د کارکوونکو اجازې او وسایل')} />
          {offset > 0 && <button className="btn btn-sm" onClick={() => goto(0)}>{tx('صفحهٔ نخست', 'First page', 'لومړی مخ')}</button>}
        </>
      ) : !d ? <Loading /> : (
        <>
          {page && (
            <div data-staff-page className="flex flex-wrap items-center gap-2 text-xs">
              <span>{tx('اعضا {m} · دستگاه‌ها {d}', 'Members {m} · devices {d}', 'غړي {m} · وسایل {d}',
                { m: span(page.offset, members.length, page.membersTotal), d: span(page.offset, devices.length, page.devicesTotal) })}</span>
              <button className="btn btn-sm" data-page="prev" disabled={page.offset <= 0 || load.busy} onClick={() => goto(page.offset - page.limit)}>
                {tx('قبلی', 'Previous', 'مخکنی')}
              </button>
              <button className="btn btn-sm" data-page="next" disabled={page.nextOffset === null || load.busy} onClick={() => goto(page.nextOffset ?? offset)}>
                {tx('بعدی', 'Next', 'بل')}
              </button>
            </div>
          )}
          {d.truncated && (
            <Notice tone="warn">{tx('سرورِ حساب صفحه‌بندی ندارد؛ فقط ۵۰۰ عضو/دستگاهِ نخست نشان داده می‌شود.',
              'The account server has no paging; only the first 500 members/devices are shown.', 'د حساب سرور مخ‌بندي نه لري؛ یوازې لومړي ۵۰۰ غړي/وسایل ښودل کېږي.')}</Notice>
          )}
          <Table head={[tx('نام', 'Name', 'نوم'), tx('نقش', 'Role', 'رول'), tx('وضعیت', 'Status', 'حالت'),
            tx('لایهٔ خودش', 'Own layer', 'خپله طبقه'), tx('مجوزِ مؤثر', 'Effective', 'اغېزمنه اجازه')]} empty={members.length === 0}>
            {members.map((m) => (
              <Row key={m.id || m.userId}>
                <Cell>{m.name || '—'} <code dir="ltr" className="text-[10px] text-ink-muted">{m.userId}</code></Cell>
                <Cell>{roleLabel(tx, m.role)}{m.customRole ? ` · ${m.customRole.name}` : ''}</Cell>
                <Cell mono>{m.status || '—'}</Cell>
                <Cell><PermList map={m.layer} tx={tx} /></Cell>
                <Cell>
                  {m.role === 'owner' ? tx('همه‌کاره (قفل‌نشدنی)', 'Everything (cannot be restricted)', 'هر څه (نه بندېږي)') : (
                    <details><summary className="cursor-pointer text-[11px]">{tx('{n} مجوز', '{n} permissions', '{n} اجازې', { n: shown(Object.keys(m.effective || {}).length) })}</summary>
                      <PermList map={m.effective} tx={tx} /></details>
                  )}
                </Cell>
              </Row>
            ))}
          </Table>
          {roleLayers.length > 0 && (
            <div className="text-xs">
              <p className="mb-1 font-semibold">{tx('تغییرِ نقش‌ها در همین دکان', 'Role changes in this shop', 'په دې هټۍ کې د رولونو بدلون')}</p>
              {roleLayers.map(([r, l]) => <div key={r} className="mb-1"><span className="font-medium">{roleLabel(tx, r)}</span>: <PermList map={l} tx={tx} /></div>)}
            </div>
          )}

          <p className="text-xs font-semibold">{tx('دستگاه‌های اعضا', 'Members’ devices', 'د غړو وسایل')}</p>
          {devices.length === 0 ? <StateEmpty>{tx('دستگاهی ثبت نشده است', 'No devices registered', 'هېڅ وسیله نه ده ثبت شوې')}</StateEmpty> : (
            <Table head={[tx('دستگاه', 'Device', 'وسیله'), tx('عضو', 'Member', 'غړی'), tx('سکو', 'Platform', 'پلاتفورم'), tx('وضعیت', 'Status', 'حالت'),
              tx('آخرین دیدن', 'Last seen', 'وروستی لید'), tx('تلاشِ ردشده', 'Blocked attempts', 'رد شوې هڅې'), '']}>
              {devices.map((v) => (
                <Row key={v.id}>
                  <Cell>{v.name || '—'} <code dir="ltr" className="text-[10px] text-ink-muted">{v.id}</code></Cell>
                  <Cell>{v.member.name || '—'} · {roleLabel(tx, v.member.role)}</Cell>
                  <Cell mono>{v.platform || '—'}</Cell>
                  <Cell>{v.disabledAt
                    ? <span style={{ color: 'var(--status-critical)' }}>{tx('از کار افتاده', 'Disabled', 'بند شوې')} · {fmtTime(v.disabledAt)}</span>
                    : (v.status || '—')}</Cell>
                  <Cell>{fmtTime(v.lastSeenAt)}</Cell>
                  <Cell>{v.blockedAttempts === null ? '—' : shown(v.blockedAttempts)}{v.lastBlockedAt ? ` · ${fmtTime(v.lastBlockedAt)}` : ''}</Cell>
                  <Cell>{can('admin') && !v.disabledAt && (
                    <button className="btn btn-sm btn-danger" data-device={v.id} onClick={() => { setDone(null); setTarget({ device: v, act: 'disable' }); }}>
                      {tx('از کار انداختن', 'Disable', 'بندول')}
                    </button>
                  )}{can('admin') && v.disabledAt && d.canEnable && (
                    <button className="btn btn-sm" data-enable={v.id} onClick={() => { setDone(null); setTarget({ device: v, act: 'enable' }); }}>
                      {tx('برگرداندن', 'Re-enable', 'بیا فعالول')}
                    </button>
                  )}</Cell>
                </Row>
              ))}
            </Table>
          )}
          {done && (
            <Notice tone="good">
              {done.act === 'enable'
                ? tx('تأییدشده از سرورِ حساب: دستگاهِ «{d}» برگشت', 'Confirmed by the account server: device “{d}” was re-enabled', 'د حساب سرور تایید: «{d}» وسیله بیا فعاله شوه', { d: done.name })
                : tx('تأییدشده از سرورِ حساب: دستگاهِ «{d}» از کار افتاد', 'Confirmed by the account server: device “{d}” was disabled', 'د حساب سرور تایید: «{d}» وسیله بنده شوه', { d: done.name })}
              {done.sessions !== null ? ` · ${tx('{n} نشست باطل شد', '{n} sessions revoked', '{n} ناستې باطلې شوې', { n: shown(done.sessions) })}` : ''}
            </Notice>
          )}
          {!d.canEnable && (
            <NotSupported needs="POST /api/admin/shops/:id/staff-perms/devices/:did/enable">
              {tx('برگرداندنِ دستگاهِ از کار افتاده از پنل ممکن نیست — این نسخهٔ سرورِ حساب آن را فقط به صاحبِ دکان (در برنامهٔ دکان) می‌دهد.',
                'Re-enabling a disabled device is not possible from the panel — this account-server version allows it only for the shop owner (in the shop app).',
                'بنده شوې وسیله له پینل څخه بیا نه فعالېږي — د حساب سرور دا نسخه یې یوازې د هټۍ خاوند ته (د هټۍ په اپ کې) اجازه ورکوي.')}
            </NotSupported>
          )}
          <SourceLine source="/api/admin/shops/:id/staff-perms" data={d} at={load.at} />
        </>
      )}
      {target && target.act === 'disable' && (
        <SensitiveDialog
          danger
          title={tx('از کار انداختنِ دستگاهِ کارمند', 'Disable a staff device', 'د کارکوونکي وسیله بندول')}
          effect={d?.canEnable
            ? tx(
              'دستگاهِ «{d}» ِ «{m}» از کار می‌افتد: همهٔ نشست‌هایش باطل می‌شود و هر درخواستِ بعدی‌اش (همگام‌سازی هم) رد و شمرده می‌شود. داده‌ای پاک نمی‌شود. برگرداندنش با همین پنجره و دلیل ممکن است (یا صاحبِ دکان از برنامهٔ دکان).',
              'Device “{d}” of “{m}” will be disabled: all its sessions are revoked and every later request (sync too) is refused and counted. No data is deleted. It can be re-enabled here with a reason (or by the shop owner in the shop app).',
              'د «{m}» «{d}» وسیله بندېږي: ټولې ناستې یې باطلېږي او هره راتلونکې غوښتنه یې (همغږي هم) ردېږي او شمېرل کېږي. هېڅ معلومات نه ړنګېږي. همدلته د لامل سره بیا فعالېدای شي (یا د هټۍ خاوند د هټۍ په اپ کې).',
              { d: target.device.name || target.device.id, m: target.device.member.name || target.device.member.userId })
            : tx(
              'دستگاهِ «{d}» ِ «{m}» از کار می‌افتد: همهٔ نشست‌هایش باطل می‌شود و هر درخواستِ بعدی‌اش (همگام‌سازی هم) رد و شمرده می‌شود. داده‌ای پاک نمی‌شود. برگرداندنش از پنل ممکن نیست؛ فقط صاحبِ دکان از برنامهٔ دکان.',
              'Device “{d}” of “{m}” will be disabled: all its sessions are revoked and every later request (sync too) is refused and counted. No data is deleted. It cannot be re-enabled from the panel; only the shop owner can, in the shop app.',
              'د «{m}» «{d}» وسیله بندېږي: ټولې ناستې یې باطلېږي او هره راتلونکې غوښتنه یې (همغږي هم) ردېږي او شمېرل کېږي. هېڅ معلومات نه ړنګېږي. له پینل څخه بیا نه فعالېږي؛ یوازې د هټۍ خاوند د هټۍ په اپ کې.',
              { d: target.device.name || target.device.id, m: target.device.member.name || target.device.member.userId })}
          onClose={() => setTarget(null)}
          onUnknown={() => { void load.reload(); }}
          onSubmit={async ({ reason, idempotencyKey }) => {
            const out = await api<{ sessionsRevoked: number | null }>(
              `${staffApi(shopId)}/devices/${encodeURIComponent(target.device.id)}/disable`, { body: { reason, confirm: true, idempotencyKey } });
            setDone({ name: target.device.name || target.device.id, act: 'disable', sessions: out.sessionsRevoked ?? null });
            setTarget(null);
            await load.reload();
          }}
        />
      )}
      {target && target.act === 'enable' && (
        <SensitiveDialog
          title={tx('برگرداندنِ دستگاهِ کارمند', 'Re-enable a staff device', 'د کارکوونکي وسیله بیا فعالول')}
          effect={tx(
            'دستگاهِ «{d}» ِ «{m}» دوباره به کار می‌افتد: باید دوباره وارد شود (نشست‌های باطل‌شده برنمی‌گردند). اگر دکانِ دیگری آن را انداخته باشد، سرورِ حساب رد می‌کند.',
            'Device “{d}” of “{m}” will work again: it must sign in again (revoked sessions do not come back). If another shop disabled it, the account server refuses.',
            'د «{m}» «{d}» وسیله بیا کار کوي: باید بیا ننوځي (باطلې ناستې نه راګرځي). که بلې هټۍ بنده کړې وي، د حساب سرور یې ردوي.',
            { d: target.device.name || target.device.id, m: target.device.member.name || target.device.member.userId },
          )}
          onClose={() => setTarget(null)}
          onUnknown={() => { void load.reload(); }}
          onSubmit={async ({ reason, idempotencyKey }) => {
            await api(`${staffApi(shopId)}/devices/${encodeURIComponent(target.device.id)}/enable`, { body: { reason, confirm: true, idempotencyKey } });
            setDone({ name: target.device.name || target.device.id, act: 'enable', sessions: null });
            setTarget(null);
            await load.reload();
          }}
        />
      )}
    </div>
  );
}
