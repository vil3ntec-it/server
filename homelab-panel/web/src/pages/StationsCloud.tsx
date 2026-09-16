// ---------------------------------------------------------------------------
//  💳 حساب‌ها و اشتراکِ پمپ — از سرورِ ابر
//
//  خواستهٔ صاحب ریپو: «بخشِ پمپ‌بنزین تو برنامهٔ سرور هیچی نداره که اشتراک
//  بدم به اپ و ببینم افراد رو، اشتراک‌هاشون و غیره. بخشِ فروشگاه خیلی
//  تکمیل است، شبیه همون باشه.»
//
//  ⚠️ این‌جا هیچ دفترِ اشتراکی ساخته نمی‌شود. اشتراکِ پمپ روی ابر زندگی
//  می‌کند — همان‌جا که برنامهٔ کامپیوتر مجوزش را می‌گیرد و کدِ شش‌رقمی
//  خرج می‌شود. اگر این‌جا هم دفتری می‌بود، روزی یکی می‌گفت «فعال» و آن
//  یکی «تمام شده».
//
//  پس این صفحه فقط یک پنجره است: می‌پرسد و نشان می‌دهد.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { CreditCard, Fuel, HardDriveDownload, KeyRound, Users } from 'lucide-react';

import { api } from '../api';
import { Card, CopyButton, Field, Loading, Modal, toast } from '../components/ui';
import { useApp } from '../app-context';
import { ActionButton, Cell, KV, Notice, Row, Select, Stat, Table, Tabs } from '../control/ui';

type Status = { base: string; linked: boolean; vault: boolean; updatedAt: number | null };

type PumpUser = {
  id: string; name: string; email: string | null; phone: string | null;
  station_id: string; station_name: string; station_code: string;
  role: string; sub_status: string | null; sub_ends_at: number | null;
};

type Sub = {
  id?: string; station_id?: string; station_name?: string; station_code?: string;
  tenantId?: string; tenantName?: string;
  plan: string; status: string;
  starts_at?: number; ends_at?: number; endsAt?: number;
};

const ROLE_FA: Record<string, string> = { owner: 'صاحب پمپ', manager: 'مدیر', staff: 'کارمند' };
const SUB_FA: Record<string, string> = {
  active: 'فعال', trial: 'آزمایشی', expired: 'تمام شده',
  suspended: 'معلق', cancelled: 'لغو شده', pending: 'در انتظار',
};

const day = 86_400_000;
const fmtDate = (ms?: number | null) =>
  ms ? new Date(Number(ms)).toLocaleDateString('fa-AF', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '—';

type CloudStats = { stations: number; active_stations: number; active_subs: number; open_codes: number; files: number };

type CloudStation = {
  id: string; code: string; name: string; status: string; created_at: number;
  owner_name: string | null; owner_email: string | null; owner_phone: string | null;
  home_url: string | null; home_seen_at: number | null;
  members: number; files: number;
  plan: string | null; sub_status: string | null; ends_at: number | null;
};

type VipCode = {
  id: string; code_hint?: string; plan: string; days: number | null; status: string;
  created_at: number; expires_at: number | null; used_at?: number | null;
  tenant_id?: string | null; note?: string | null; max_devices?: number;
};

type PumpPlan = { code: string; title: string; amount: number; unit: string; price?: number; badge?: string };

type StationDetail = {
  station: { id: string; code: string; name: string; homeUrl: string; homeSeenAt: number | null; hasReadKey: boolean; status: string };
  accessCode: string;
  owner: { id: string; name: string; email: string | null; phone: string | null } | null;
  members: { id: string; user_id: string; role: string; status: string; name?: string; email?: string | null; phone?: string | null }[];
  entitlement: { source: string; features: string[]; subscription?: { plan?: string; status?: string; endsAt?: number | null } };
  files: { path: string; rev: number; size: number; updatedAt: number }[];
};

const STATUS_FA: Record<string, string> = { active: 'فعال', revoked: 'باطل', used: 'خرج شده', expired: 'منقضی', exhausted: 'پر شده' };
const fa = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('fa-AF'));
const fmtBytes = (n: number) => {
  if (!n) return '۰';
  const u = ['B', 'KB', 'MB', 'GB']; let v = n; let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
};

export default function StationsCloud() {
  const [status, setStatus] = useState<Status | null>(null);
  const [users, setUsers] = useState<PumpUser[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [expiring, setExpiring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const { role } = useApp();
  const canWrite = role === 'admin' || role === 'operator';

  //  ── تب‌ها، مثلِ بخشِ فروشگاه: نمای کلی · افراد · اشتراک‌ها · کدها · پمپ‌ها ──
  const [tab, setTab] = useState('overview');
  const [stats, setStats] = useState<CloudStats | null>(null);
  const [cloudStations, setCloudStations] = useState<CloudStation[]>([]);
  const [codes, setCodes] = useState<VipCode[]>([]);
  const [plans, setPlans] = useState<PumpPlan[]>([]);
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState<StationDetail | null>(null);
  const [grantFor, setGrantFor] = useState<CloudStation | null>(null);
  const [codeFor, setCodeFor] = useState<CloudStation | null | 'any'>(null);
  const [madeCode, setMadeCode] = useState<{ code: string; plan: string; days: number | null } | null>(null);

  const loadMore = useCallback(async () => {
    try {
      const [st, cs, vc, pl] = await Promise.all([
        api<{ stats: CloudStats }>('/api/stations-admin/cloud/stats'),
        api<{ stations: CloudStation[] }>(`/api/stations-admin/cloud/stations?limit=200${q ? `&q=${encodeURIComponent(q)}` : ''}`),
        api<{ codes: VipCode[] }>('/api/stations-admin/cloud/vipCodes?limit=100'),
        api<{ plans: PumpPlan[] }>('/api/stations-admin/cloud/pumpPlans'),
      ]);
      setStats(st.stats || null);
      setCloudStations(cs.stations || []);
      setCodes(vc.codes || []);
      setPlans(pl.plans || []);
    } catch { /* هر کدام نبود، کارتش خالی می‌ماند */ }
  }, [q]);

  async function openStation(id: string) {
    try { setDetail(await api<StationDetail>(`/api/stations-admin/cloud/station/${encodeURIComponent(id)}`)); }
    catch (e) { toast(e instanceof Error ? e.message : 'نشد', 'bad'); }
  }

  async function revoke(id: string) {
    try {
      await api(`/api/stations-admin/cloud/vip-codes/${encodeURIComponent(id)}/revoke`, { method: 'POST' });
      toast('کد باطل شد');
      await loadMore();
    } catch (e) { toast(e instanceof Error ? e.message : 'نشد', 'bad'); }
  }

  const loadStatus = useCallback(async () => {
    try { setStatus(await api<Status>('/api/stations-admin/cloud/status')); } catch { /* پنل نباید بیفتد */ }
  }, []);

  const loadData = useCallback(async (wantExpiring: boolean) => {
    try {
      const [u, s] = await Promise.all([
        api<{ users: PumpUser[] }>('/api/stations-admin/cloud/users?limit=100'),
        api<{ subscriptions: Sub[] }>(
          wantExpiring ? '/api/stations-admin/cloud/expiring' : '/api/stations-admin/cloud/subscriptions?limit=100'
        ),
      ]);
      setUsers(u.users || []);
      setSubs(s.subscriptions || []);
    } catch {
      //  وصل نیستیم یا نشست تمام شده — کارت خودش می‌گوید، خطا لازم نیست
      setUsers([]); setSubs([]);
    }
  }, []);

  //  آینهٔ ابر در پوشهٔ داده — «حساب‌ها از سرور به فولدرِ خودِ سرور ثبت می‌شه؟»
  const [mirror, setMirror] = useState<MirrorInfo | null>(null);
  const loadMirror = useCallback(async () => {
    try { setMirror(await api<MirrorInfo>('/api/stations-admin/cloud/mirror')); } catch { /* اختیاری */ }
  }, []);
  useEffect(() => { loadMirror(); }, [loadMirror]);
  async function mirrorNow() {
    setBusy(true);
    try {
      await api('/api/stations-admin/cloud/mirror', { method: 'POST' });
      await loadMirror();
      toast('آینهٔ ابر در پوشهٔ داده تازه شد');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'نشد', 'bad');
    } finally { setBusy(false); }
  }

  useEffect(() => { loadStatus(); }, [loadStatus]);
  useEffect(() => { if (status?.linked) loadData(expiring); }, [status?.linked, expiring, loadData]);
  useEffect(() => { if (status?.linked) loadMore(); }, [status?.linked, loadMore]);

  async function link() {
    setBusy(true);
    try {
      await api('/api/stations-admin/cloud/login', {
        method: 'POST',
        body: JSON.stringify({ username: user.trim(), password: pass }),
      });
      setPass('');
      toast('به سرورِ ابر وصل شد');
      await loadStatus();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'وصل نشد', 'bad');
    } finally { setBusy(false); }
  }

  async function unlink() {
    setBusy(true);
    try {
      await api('/api/stations-admin/cloud/forget', { method: 'POST' });
      setUsers([]); setSubs([]);
      toast('توکنِ ابر پاک شد');
      await loadStatus();
    } finally { setBusy(false); }
  }

  if (!status) return <Card title="حساب‌ها و اشتراک" icon={<CreditCard size={18} />}><Loading /></Card>;

  //  ⚠️ بی گاوصندوق جایی برای نگه داشتنِ توکن نیست. رمزِ مدیرِ ابر
  //  نباید روی دیسکِ خانه لخت بیفتد.
  if (!status.vault) {
    return (
      <Card title="حساب‌ها و اشتراک" icon={<CreditCard size={18} />}>
        <Notice>
          اول گاوصندوق را راه بیندازید. توکنِ سرورِ ابر آن‌جا رمزگذاری‌شده می‌نشیند و
          بی آن جایی برای نگه داشتنش نیست.
        </Notice>
      </Card>
    );
  }

  if (!status.linked) {
    return (
      <Card title="حساب‌ها و اشتراک" icon={<CreditCard size={18} />}>
        <Notice>
          اشتراکِ پمپ‌ها روی سرورِ ابر است (<code dir="ltr">{status.base}</code>). یک بار با حسابِ
          مدیرِ همان‌جا وارد شوید تا افراد و اشتراک‌هایشان همین‌جا دیده شوند.
          <br />
          رمز ذخیره نمی‌شود؛ فقط توکنی که برمی‌گردد در گاوصندوق می‌نشیند.
        </Notice>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="نام کاربریِ مدیرِ ابر">
            <input dir="ltr" value={user} onChange={(e) => setUser(e.target.value)} />
          </Field>
          <Field label="رمز">
            <input dir="ltr" type="password" value={pass} onChange={(e) => setPass(e.target.value)} />
          </Field>
        </div>
        <div className="mt-3">
          <ActionButton onClick={link} disabled={busy || !user.trim() || !pass}>وصل شدن</ActionButton>
        </div>
      </Card>
    );
  }

  const day_ = day;
  const usersCard = (
    <Card title="افرادِ پمپ‌ها" icon={<Users size={18} />}>
      {users.length === 0 ? (
        <Notice>هنوز کسی به پمپی وصل نشده است.</Notice>
      ) : (
        <Table head={['نام', 'ایمیل / شماره', 'پمپ', 'نقش', 'اشتراک', 'پایان']}>
          {users.map((u) => (
            <Row key={`${u.id}-${u.station_id}`}>
              <Cell>{u.name || '—'}</Cell>
              <Cell><span dir="ltr">{u.email || u.phone || '—'}</span></Cell>
              <Cell>{u.station_name ? `${u.station_name} (${u.station_code})` : '—'}</Cell>
              <Cell>{ROLE_FA[u.role] || u.role}</Cell>
              <Cell>{SUB_FA[u.sub_status || ''] || 'بدون اشتراک'}</Cell>
              <Cell>{fmtDate(u.sub_ends_at)}</Cell>
            </Row>
          ))}
        </Table>
      )}
    </Card>
  );

  const subsCard = (
    <Card
      title="اشتراک‌های پمپ"
      icon={<CreditCard size={18} />}
      action={<ActionButton onClick={() => setExpiring((v) => !v)}>{expiring ? 'همه' : 'رو به پایان'}</ActionButton>}
    >
      {subs.length === 0 ? (
        <Notice>{expiring ? 'هیچ اشتراکی رو به پایان نیست.' : 'هنوز اشتراکی نیست.'}</Notice>
      ) : (
        <Table head={['پمپ', 'پلن', 'وضعیت', 'پایان', 'روزِ مانده']}>
          {subs.map((s, i) => {
            /*  ⚠️ دو مسیر، دو شکلِ نام: فهرستِ کامل ستونِ خامِ SQL می‌دهد
                (station_name/ends_at) و «رو به پایان» شکلِ نگاشت‌شده
                (tenantName/endsAt). هر دو را بخوانید، وگرنه یکی از دو
                نما خالی می‌شود بی آن‌که خطایی دیده شود. */
            const name = s.station_name || s.tenantName || '';
            const code = s.station_code || '';
            const ends = s.ends_at ?? s.endsAt ?? null;
            const left = ends ? Math.max(0, Math.ceil((Number(ends) - Date.now()) / day_)) : null;
            return (
              <Row key={s.id || s.tenantId || i}>
                <Cell>{name ? (code ? `${name} (${code})` : name) : '—'}</Cell>
                <Cell>{s.plan || '—'}</Cell>
                <Cell>{SUB_FA[s.status] || s.status}</Cell>
                <Cell>{fmtDate(ends)}</Cell>
                <Cell>{left === null ? '—' : left.toLocaleString('fa-AF')}</Cell>
              </Row>
            );
          })}
        </Table>
      )}
    </Card>
  );

  const mirrorCard = (
    <Card
      title="آینهٔ ابر در پوشهٔ داده"
      icon={<HardDriveDownload size={18} />}
      action={<ActionButton onClick={mirrorNow} disabled={busy}>همین حالا تازه کن</ActionButton>}
    >
      <Notice>
        حساب‌ها، اشتراک‌ها و کدهای پمپ — و حساب‌ها و اشتراک‌های دکان — هر نیم ساعت از ابر
        گرفته و داخلِ پوشهٔ داده نوشته می‌شوند (<code dir="ltr">{mirror?.dir || '…/cloud'}</code>).
        پوشه را به هر کامپیوتری ببرید، این‌ها هم با آن می‌روند. فقط‌خواندنی است؛ منبعِ اصلی همچنان ابر است.
      </Notice>
      <div className="mt-2 text-sm">
        {mirror?.last
          ? mirror.last.skipped
            ? <span>آخرین بار ({fmtDate(mirror.last.at)}) رد شد: به ابر وصل نبودیم.</span>
            : <span>
                آخرین بار {fmtDate(mirror.last.at)} — {mirror.last.ok?.length ?? 0} فایل رفت
                {mirror.last.failed?.length ? `، ${mirror.last.failed.length} نرفت (${mirror.last.failed.map((f) => f.file).join('، ')})` : ''}.
              </span>
          : <span>هنوز آینه‌ای گرفته نشده.</span>}
      </div>
    </Card>
  );

  return (
    <>
      <Card
        title="حساب‌ها و اشتراکِ پمپ‌ها — روی ابر"
        icon={<CreditCard size={18} />}
        action={
          <div className="flex gap-2">
            <ActionButton onClick={() => { loadData(expiring); loadMore(); }} disabled={busy}>تازه‌سازی</ActionButton>
            <ActionButton onClick={unlink} disabled={busy}>قطعِ اتصال به ابر</ActionButton>
          </div>
        }
      >
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { id: 'overview', label: 'نمای کلی' },
            { id: 'stations', label: 'پمپ‌ها روی ابر', badge: cloudStations.length },
            { id: 'users', label: 'افراد', badge: users.length },
            { id: 'subs', label: 'اشتراک‌ها', badge: subs.length },
            { id: 'codes', label: 'کدهای اشتراک', badge: codes.filter((c) => c.status === 'active').length },
            { id: 'mirror', label: 'آینه' },
          ]}
        />

        {tab === 'overview' && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Stat label="پمپ‌ها روی ابر" value={fa(stats?.stations)} icon={<Fuel size={16} />} tone="info"
                    sub={`${fa(stats?.active_stations)} فعال`} onClick={() => setTab('stations')} />
              <Stat label="اشتراکِ فعال" value={fa(stats?.active_subs)} tone="good" onClick={() => setTab('subs')} />
              <Stat label="کدِ خرج‌نشده" value={fa(stats?.open_codes)} tone={stats?.open_codes ? 'warn' : undefined}
                    icon={<KeyRound size={16} />} onClick={() => setTab('codes')} />
              <Stat label="افراد" value={fa(users.length)} icon={<Users size={16} />} onClick={() => setTab('users')} />
              <Stat label="فایل در پوشه‌های ابری" value={fa(stats?.files)} sub="عکسِ زنده، حساب‌های کیو‌آردار، صندوق" />
            </div>
            <Notice>
              هر پمپ روی ابر پوشه، اشتراک و یک <b>کدِ پمپ</b> دارد. کارمندان با همان کد وارد اپِ اندروید/آیفون
              می‌شوند و فقط حساب‌های همان پمپ را می‌بینند. کدِ شش‌رقمیِ اشتراک را از تبِ «کدهای اشتراک» بسازید و به
              صاحبِ پمپ بدهید؛ برنامهٔ کامپیوترش با همان فعال می‌شود.
            </Notice>
            {canWrite && (
              <div className="flex flex-wrap gap-2">
                <ActionButton className="btn btn-sm btn-primary" onClick={() => setCodeFor('any')}>کدِ اشتراکِ تازه</ActionButton>
                <ActionButton onClick={() => setTab('stations')}>اشتراک دادن به یک پمپ</ActionButton>
              </div>
            )}
          </div>
        )}

        {tab === 'stations' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <input className="hlp-input max-w-xs" placeholder="جست‌وجو: نام، کد، صاحب…" value={q}
                     onChange={(e) => setQ(e.target.value)} />
              <span className="text-xs opacity-60">{fa(cloudStations.length)} پمپ</span>
            </div>
            {cloudStations.length === 0 ? (
              <Notice>هنوز پمپی روی ابر ثبت نشده. اولین فعال‌سازی با کدِ شش‌رقمی، پمپ را همین‌جا می‌آورد.</Notice>
            ) : (
              <Table head={['پمپ', 'صاحب', 'اعضا', 'اشتراک', 'پایان', 'سرورِ خانگی', '']}>
                {cloudStations.map((s) => {
                  const left = s.ends_at ? Math.max(0, Math.ceil((Number(s.ends_at) - Date.now()) / day_)) : null;
                  return (
                    <Row key={s.id}>
                      <Cell>
                        <div className="font-medium">{s.name || '—'}</div>
                        <div className="text-xs opacity-60" dir="ltr">{s.code}</div>
                      </Cell>
                      <Cell>
                        <div>{s.owner_name || <span className="opacity-60">بی صاحبِ گوگل</span>}</div>
                        <div className="text-xs opacity-60" dir="ltr">{s.owner_email || s.owner_phone || ''}</div>
                      </Cell>
                      <Cell>{fa(s.members)}</Cell>
                      <Cell>
                        <div>{SUB_FA[s.sub_status || ''] || 'بدون اشتراک'}</div>
                        <div className="text-xs opacity-60">{s.plan || ''}</div>
                      </Cell>
                      <Cell>
                        <div>{fmtDate(s.ends_at)}</div>
                        {left !== null && <div className="text-xs opacity-60">{fa(left)} روز</div>}
                      </Cell>
                      <Cell>
                        {s.home_url
                          ? <><div className="text-xs" dir="ltr">{s.home_url.replace(/^wss?:\/\//, '')}</div><div className="text-xs opacity-60">{fmtDate(s.home_seen_at)}</div></>
                          : <span className="text-xs opacity-60">هنوز وصل نشده</span>}
                      </Cell>
                      <Cell>
                        <div className="flex flex-wrap gap-1">
                          <ActionButton className="btn btn-sm btn-primary" onClick={() => openStation(s.id)}>جزئیات و کدِ پمپ</ActionButton>
                          {canWrite && <ActionButton onClick={() => setGrantFor(s)}>اشتراک بده</ActionButton>}
                          {canWrite && <ActionButton onClick={() => setCodeFor(s)}>کدِ اشتراک</ActionButton>}
                        </div>
                      </Cell>
                    </Row>
                  );
                })}
              </Table>
            )}
          </div>
        )}

        {tab === 'users' && usersCard}
        {tab === 'subs' && subsCard}

        {tab === 'codes' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs opacity-60">
                کدِ شش‌رقمی فقط همان لحظهٔ ساخت دیده می‌شود؛ بعدش حتی سرور هم نمی‌تواند نشانش بدهد. همان لحظه بردارید.
              </div>
              {canWrite && <ActionButton className="btn btn-sm btn-primary" onClick={() => setCodeFor('any')}>کدِ تازه</ActionButton>}
            </div>
            {codes.length === 0 ? (
              <Notice>هنوز کدی ساخته نشده.</Notice>
            ) : (
              <Table head={['کد', 'پلن', 'روز', 'وضعیت', 'ساخت', 'مهلت', 'یادداشت', '']}>
                {codes.map((c) => (
                  <Row key={c.id}>
                    <Cell><code dir="ltr">••••{c.code_hint || ''}</code></Cell>
                    <Cell>{c.plan}</Cell>
                    <Cell>{c.days == null ? '—' : fa(c.days)}</Cell>
                    <Cell>{STATUS_FA[c.status] || c.status}</Cell>
                    <Cell>{fmtDate(c.created_at)}</Cell>
                    <Cell>{fmtDate(c.expires_at)}</Cell>
                    <Cell><span className="text-xs">{c.note || ''}</span></Cell>
                    <Cell>
                      {canWrite && c.status === 'active' && (
                        <ActionButton className="btn btn-sm btn-danger" onClick={() => revoke(c.id)}>باطل کن</ActionButton>
                      )}
                    </Cell>
                  </Row>
                ))}
              </Table>
            )}
          </div>
        )}

        {tab === 'mirror' && mirrorCard}
      </Card>

      {/* ── جزئیاتِ یک پمپ روی ابر — با کدِ پمپ برای اپِ کارمندان ── */}
      <Modal open={Boolean(detail)} wide title={`پمپ «${detail?.station.name ?? ''}» روی ابر`} onClose={() => setDetail(null)}>
        {detail && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="card p-3 sm:col-span-2">
              <div className="mb-1 text-xs font-semibold">کدِ پمپ برای اپِ کارمندان</div>
              {detail.accessCode ? (
                <div className="flex flex-wrap items-center gap-3">
                  <code className="text-3xl tracking-[0.25em] font-mono" dir="ltr">{detail.accessCode}</code>
                  <CopyButton value={detail.accessCode} />
                  <span className="text-xs opacity-60">هر کسی اپ را نصب می‌کند این را می‌زند و فقط همین پمپ را می‌بیند.</span>
                </div>
              ) : (
                <Notice tone="warn">هنوز ساخته نشده — برنامهٔ کامپیوترِ همین پمپ اولین بار که «پروفایل» را باز کند، می‌سازدش.</Notice>
              )}
            </div>
            <div className="card p-3">
              <div className="mb-1 text-xs font-semibold">پمپ</div>
              <KV label="کد" mono>{detail.station.code}</KV>
              <KV label="وضعیت">{detail.station.status === 'active' ? 'فعال' : detail.station.status}</KV>
              <KV label="سرورِ خانگی" mono>{detail.station.homeUrl || '—'}</KV>
              <KV label="آخرین بار وصل">{fmtDate(detail.station.homeSeenAt)}</KV>
              <KV label="رمزِ خواندن">{detail.station.hasReadKey ? 'ثبت شده' : 'ندارد'}</KV>
              <KV label="صاحب">{detail.owner?.name || 'بی صاحبِ گوگل'}</KV>
            </div>
            <div className="card p-3">
              <div className="mb-1 text-xs font-semibold">اشتراک</div>
              <KV label="منبع">{detail.entitlement.source === 'trial' ? 'دورهٔ آزمایشی' : detail.entitlement.source === 'free' ? 'بدون اشتراک' : 'اشتراک'}</KV>
              <KV label="پلن">{detail.entitlement.subscription?.plan || '—'}</KV>
              <KV label="پایان">{fmtDate(detail.entitlement.subscription?.endsAt)}</KV>
              <KV label="بخش‌های باز">{fa(detail.entitlement.features?.length)}</KV>
            </div>
            <div className="card p-3">
              <div className="mb-1 text-xs font-semibold">اعضا ({fa(detail.members.length)})</div>
              {detail.members.length === 0 ? <div className="text-xs opacity-60">کسی با گوگل نپیوسته.</div> : detail.members.map((m) => (
                <KV key={m.id} label={ROLE_FA[m.role] || m.role}>{m.name || m.email || m.phone || m.user_id}</KV>
              ))}
            </div>
            <div className="card p-3">
              <div className="mb-1 text-xs font-semibold">پوشهٔ ابری ({fa(detail.files.length)} فایل)</div>
              {detail.files.length === 0 ? <div className="text-xs opacity-60">خالی</div> : detail.files.slice(0, 12).map((f) => (
                <KV key={f.path} label={f.path} mono>{fmtBytes(f.size)} · {fmtDate(f.updatedAt)}</KV>
              ))}
              {detail.files.length > 12 && <div className="text-xs opacity-60">و {fa(detail.files.length - 12)} فایلِ دیگر</div>}
            </div>
          </div>
        )}
      </Modal>

      {grantFor && (
        <GrantModal station={grantFor} plans={plans} onClose={() => setGrantFor(null)}
                    onDone={() => { setGrantFor(null); loadData(expiring); loadMore(); }} />
      )}
      {codeFor && (
        <CodeModal station={codeFor === 'any' ? null : codeFor} plans={plans} onClose={() => setCodeFor(null)}
                   onMade={(c) => { setCodeFor(null); setMadeCode(c); loadMore(); }} />
      )}
      <Modal open={Boolean(madeCode)} title="کدِ اشتراک ساخته شد" onClose={() => setMadeCode(null)}>
        {madeCode && (
          <div className="space-y-3 text-center">
            <div className="text-4xl tracking-[0.4em] font-mono" dir="ltr">{madeCode.code}</div>
            <div className="text-sm opacity-70">{madeCode.plan} · {madeCode.days == null ? 'مدتِ پلن' : `${fa(madeCode.days)} روز`}</div>
            <CopyButton value={madeCode.code} />
            <Notice tone="warn">این کد فقط همین یک بار دیده می‌شود. به صاحبِ پمپ بدهید؛ برنامهٔ کامپیوترش با همان فعال یا تمدید می‌شود.</Notice>
          </div>
        )}
      </Modal>
    </>
  );
}

/** اشتراک دادن به یک پمپ — همان کاری که در بخشِ فروشگاه می‌شود. */
function GrantModal({ station, plans, onClose, onDone }: {
  station: CloudStation; plans: PumpPlan[]; onClose: () => void; onDone: () => void;
}) {
  const [plan, setPlan] = useState(plans[0]?.code || 'custom');
  const [days, setDays] = useState('30');
  const [note, setNote] = useState('');
  const chosen = plans.find((p) => p.code === plan);
  return (
    <Modal open title={`اشتراک برای «${station.name || station.code}»`} onClose={onClose}>
      <div className="space-y-3">
        <Field label="پلن">
          <Select value={plan} onChange={setPlan}
                  options={[...plans.map((p) => ({ value: p.code, label: `${p.title}${p.price ? ` — ${fa(p.price)} افغانی` : ''}` })), { value: 'custom', label: 'دلخواه' }]} />
        </Field>
        {(plan === 'custom' || !chosen) && (
          <Field label="روز">
            <input className="hlp-input" type="number" min={1} max={3650} value={days} onChange={(e) => setDays(e.target.value)} />
          </Field>
        )}
        <Field label="یادداشت (اختیاری)">
          <input className="hlp-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً: پولش نقد گرفته شد" />
        </Field>
        <ActionButton className="btn btn-primary w-full" busyLabel="در حالِ ثبت…" onClick={async () => {
          try {
            await api('/api/stations-admin/cloud/grant', {
              method: 'POST',
              body: { stationId: station.id, plan, days: plan === 'custom' || !chosen ? Number(days) : undefined, note },
            });
            toast('اشتراک ثبت شد');
            onDone();
          } catch (e) { toast(e instanceof Error ? e.message : 'نشد', 'bad'); }
        }}>اشتراک بده</ActionButton>
      </div>
    </Modal>
  );
}

/** کدِ شش‌رقمیِ اشتراک — برای فعال کردنِ برنامهٔ کامپیوتر یا تمدیدش. */
function CodeModal({ station, plans, onClose, onMade }: {
  station: CloudStation | null; plans: PumpPlan[]; onClose: () => void;
  onMade: (c: { code: string; plan: string; days: number | null }) => void;
}) {
  const [plan, setPlan] = useState(plans[0]?.code || 'custom');
  const [days, setDays] = useState('30');
  const [expires, setExpires] = useState('30');
  const [note, setNote] = useState('');
  const [phone, setPhone] = useState('');
  const chosen = plans.find((p) => p.code === plan);
  return (
    <Modal open title={station ? `کدِ اشتراک برای «${station.name || station.code}»` : 'کدِ اشتراکِ تازه'} onClose={onClose}>
      <div className="space-y-3">
        <Field label="پلن">
          <Select value={plan} onChange={setPlan}
                  options={[...plans.map((p) => ({ value: p.code, label: `${p.title}${p.price ? ` — ${fa(p.price)} افغانی` : ''}` })), { value: 'custom', label: 'دلخواه' }]} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          {(plan === 'custom' || !chosen) && (
            <Field label="روزِ اشتراک">
              <input className="hlp-input" type="number" min={1} max={3650} value={days} onChange={(e) => setDays(e.target.value)} />
            </Field>
          )}
          <Field label="مهلتِ خرج کردنِ کد (روز)">
            <input className="hlp-input" type="number" min={1} max={365} value={expires} onChange={(e) => setExpires(e.target.value)} />
          </Field>
        </div>
        <Field label="شمارهٔ موبایل برای پیامک (اختیاری)">
          <input className="hlp-input" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07…" />
        </Field>
        <Field label="یادداشت (اختیاری)">
          <input className="hlp-input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {!station && <Notice>کدِ بی‌پمپ را هر برنامهٔ کامپیوتری می‌تواند خرج کند — برای پمپِ تازه‌ای که هنوز روی ابر نیست.</Notice>}
        <ActionButton className="btn btn-primary w-full" busyLabel="در حالِ ساخت…" onClick={async () => {
          try {
            const out = await api<{ code: string; plan: string; days: number | null }>('/api/stations-admin/cloud/vip-codes', {
              method: 'POST',
              body: {
                plan, note, phone: phone.trim() || undefined,
                days: plan === 'custom' || !chosen ? Number(days) : undefined,
                expiresInDays: Number(expires) || 30,
                stationId: station?.id,
              },
            });
            onMade({ code: out.code, plan: out.plan || plan, days: out.days ?? null });
          } catch (e) { toast(e instanceof Error ? e.message : 'نشد', 'bad'); }
        }}>بساز</ActionButton>
      </div>
    </Modal>
  );
}

type MirrorInfo = {
  dir: string;
  last: null | {
    at: number; reason?: string; skipped?: string;
    ok?: string[]; failed?: { file: string; error: string }[];
  };
};
