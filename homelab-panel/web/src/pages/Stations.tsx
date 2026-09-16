// ---------------------------------------------------------------------------
//  ⛽ پمپ‌بنزین‌ها
//
//  هر پمپ بنزین یک پوشه و دو رمزِ کاملاً جدا دارد. این صفحه همان چیزی است که
//  صاحبِ سرور واقعاً لازم دارد و تا امروز هیچ‌جا نبود:
//
//    • کدام پمپ‌ها ثبت شده‌اند، پوشه‌شان کجاست، و آخرین بار کِی برنامهٔ
//      کامپیوترشان چیزی فرستاد (یعنی «پمپ زنده است یا نه»)
//    • رمزِ برنامهٔ کامپیوتر و رمزِ کیو‌آرِ کارمند — جدا، و هرگز با هم
//    • کدِ ده‌دقیقه‌ایِ جفت‌شدن، برای برنامه‌ای که در شبکهٔ خانگی نیست
//
//  ⚠️ رمزها عمداً پیش‌فرض پنهان‌اند و فقط با یک کلیکِ جدا (که در لاگ هم ثبت
//  می‌شود) دیده می‌شوند. رمزِ برنامه هیچ‌وقت در فهرست نمی‌آید.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { Fuel, KeyRound, Smartphone } from 'lucide-react';

import { api } from '../api';
import { useApp } from '../app-context';
import { Card, ConfirmDialog, CopyButton, Empty, Field, Loading, Modal, StatusDot, toast } from '../components/ui';
import { ActionButton, Cell, KV, Notice, Row, Stat, Table, Tabs } from '../control/ui';
import StationsCloud from './StationsCloud';

type Station = {
  code: string;
  name: string;
  dataDir: string;
  diskBytes: number;
  liveConnections: number;
  lastActivity: number | null;
  liveAt: number | null;
  liveSeq: number | null;
  inboxCount: number;
  tokenPreview: string | null;
  readKeyPreview: string | null;
};

type Overview = {
  enabled: boolean;
  dataDir?: string;
  enrollMode?: string;
  stats?: { stations: number; connections: number; diskBytes: number };
  pairings?: { pin: string; code: string; name: string; expires: number }[];
  stations?: Station[];
};

type Keys = { code: string; token: string; readKey: string };

/** جزئیاتِ یک پمپ — ‎/api/stations-admin/:code/detail‎ (از روی همان ‎live.json‎) */
type TankSide = { in?: number; out?: number; show?: number; current?: number; low?: boolean; near?: boolean };
type Detail = {
  code: string;
  name: string;
  dataDir: string;
  diskBytes: number;
  liveConnections: number;
  reads: number;
  writes: number;
  lastActivity: number | null;
  live: null | {
    at: string | null;
    atUtc: string | null;
    seq: number | null;
    hasGate: boolean;
    detail: boolean;
    station: { name: string; address: string; phone: string; ratePetrol: number | null; rateDiesel: number | null } | null;
    tank: { petrol?: TankSide; diesel?: TankSide } | null;
    debtors: { total: number; ok: number; low: number; out: number; none: number };
    alerts: { k?: string; s?: string; t?: string }[];
    sections: { id: string; title: string; rows: number; months: number }[];
  };
  inbox: { id: string; text?: string; from?: string; at?: number; kind?: string }[];
  inboxCount: number;
  qrAccounts: number;
};

type Connect = {
  code: string;
  name: string;
  staff: { link: string | null; qr: string | null; readKey: string };
  shortcut: string | null;
};

const fa = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('fa-AF'));

const fmtTime = (ms: number | null) => (ms ? new Date(ms).toLocaleString('fa-IR') : '—');

function fmtBytes(n: number) {
  if (!n) return '۰';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i ? 1 : 0)} ${units[i]}`;
}

/**
 * «زنده است؟» — دو دقیقه سکوت یعنی برنامهٔ آن پمپ خاموش است.
 * حلقهٔ انتشارِ خودِ برنامه هر ۲۰ ثانیه است، پس این مرز با خیالِ راحت
 * شش برابرِ آن گرفته شده و یک قطعیِ کوتاهِ شبکه پمپ را «مرده» نشان نمی‌دهد.
 */
const LIVE_WINDOW_MS = 2 * 60 * 1000;
const isLive = (s: Station) => Boolean(s.liveAt && Date.now() - s.liveAt < LIVE_WINDOW_MS);

export default function StationsPage() {
  const { role } = useApp();
  const canWrite = role === 'admin' || role === 'operator';
  const isAdmin = role === 'admin';

  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ code: '', name: '' });
  const [keys, setKeys] = useState<Keys | null>(null);
  const [pairing, setPairing] = useState<{ pin: string; code: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Station | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [connect, setConnect] = useState<Connect | null>(null);
  const [detailTab, setDetailTab] = useState('summary');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<Overview>('/api/stations-admin/'));
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // پمپِ زنده هر بیست ثانیه چیزی می‌فرستد؛ صفحه هم هم‌قدمِ همان باشد
    const timer = setInterval(() => {
      api<Overview>('/api/stations-admin/').then(setData).catch(() => {});
    }, 20000);
    return () => clearInterval(timer);
  }, [load]);

  async function create() {
    try {
      await api('/api/stations-admin/', { method: 'POST', body: { code: form.code.trim(), name: form.name.trim() } });
      toast('پمپ بنزین ساخته شد');
      setShowNew(false);
      setForm({ code: '', name: '' });
      await load();
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }

  async function showKeys(code: string) {
    try {
      setKeys(await api<Keys>(`/api/stations-admin/${encodeURIComponent(code)}/keys`));
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }

  /** «داخلِ این پمپ چه خبر است؟» — جزئیات از همان عکسِ زنده، بی رمز */
  async function openDetail(code: string) {
    try {
      setDetailTab('summary');
      const d = await api<Detail>(`/api/stations-admin/${encodeURIComponent(code)}/detail`);
      setDetail(d);
      //  لینک و کیو‌آرِ اپِ کارمندان — جدا و اختیاری، تا اگر تونل نبود صفحه نیفتد
      api<Connect>(`/api/stations-admin/${encodeURIComponent(code)}/connect?karBase=${encodeURIComponent('https://yaqobipump.top/kar')}`)
        .then(setConnect)
        .catch(() => setConnect(null));
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }

  async function makePairing(code: string) {
    try {
      const res = await api<{ pin: string; code: string }>('/api/stations-admin/pair', {
        method: 'POST',
        body: { code },
      });
      setPairing(res);
      await load();
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }

  async function rotate(code: string, which: 'token' | 'read-key') {
    try {
      await api(`/api/stations-admin/${encodeURIComponent(code)}/rotate-${which}`, { method: 'POST' });
      toast(
        which === 'token'
          ? 'رمزِ برنامه عوض شد — برنامهٔ همان پمپ باید دوباره ثبت شود'
          : 'رمزِ خواندن عوض شد — کیو‌آرهای قبلیِ کارمندان باطل شدند'
      );
      setKeys(null);
      await load();
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }

  async function remove(station: Station) {
    try {
      await api(
        `/api/stations-admin/${encodeURIComponent(station.code)}?confirm=${encodeURIComponent(station.code)}`,
        { method: 'DELETE' }
      );
      toast('پمپ بنزین و پوشه‌اش پاک شد');
      setConfirmDelete(null);
      await load();
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }

  if (loading && !data) return <Loading label="پمپ‌بنزین‌ها" />;
  if (data && !data.enabled) {
    return (
      <Card title="پمپ‌بنزین‌ها" icon={<Fuel size={18} />}>
        <Notice tone="warn">
          این بخش خاموش است. برای روشن کردنش در فایل <code>.env</code> مقدار <code>HLP_STATIONS=1</code> بگذارید و سرور
          را دوباره راه بیندازید.
        </Notice>
      </Card>
    );
  }

  const stations = data?.stations ?? [];
  const liveCount = stations.filter(isLive).length;
  const inboxTotal = stations.reduce((n, s) => n + (s.inboxCount || 0), 0);

  return (
    <div className="space-y-4">
      {/* ── یک نگاه: چند پمپ، چندتا روشن، چند دستگاه، چند پیامِ نخوانده ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="پمپ‌های ثبت‌شده" value={fa(stations.length)} icon={<Fuel size={16} />} tone="info"
              sub={data?.enrollMode === 'lan' ? 'ثبت فقط از شبکهٔ خانگی' : data?.enrollMode === 'off' ? 'ثبت بسته است' : 'ثبت باز است'} />
        <Stat label="برنامه روشن است" value={fa(liveCount)} tone={liveCount === stations.length && stations.length > 0 ? 'good' : liveCount === 0 ? 'bad' : 'warn'}
              sub={stations.length ? `${fa(stations.length - liveCount)} پمپ خبری نداده` : 'هنوز پمپی نیست'} />
        <Stat label="دستگاه‌های وصل" value={fa(data?.stats?.connections ?? 0)} icon={<Smartphone size={16} />}
              sub="گوشیِ کارمندان و برنامهٔ کامپیوتر" />
        <Stat label="پیامِ صندوقِ ورودی" value={fa(inboxTotal)} tone={inboxTotal ? 'warn' : undefined}
              sub={`${fmtBytes(data?.stats?.diskBytes ?? 0)} روی دیسک`} />
      </div>

      <Card
        title="پمپ‌بنزین‌ها"
        icon={<Fuel size={18} />}
        action={
          <div className="flex gap-2">
            <ActionButton onClick={() => load()}>تازه‌سازی</ActionButton>
            {canWrite && <ActionButton onClick={() => setShowNew(true)}>پمپ تازه</ActionButton>}
          </div>
        }
      >
        <Notice tone="info">
          هر پمپ بنزین پوشه و رمزِ خودش را دارد و دادهٔ هیچ پمپی به پمپِ دیگر نمی‌رسد. معمولاً لازم نیست این‌جا چیزی
          بسازید: برنامهٔ کامپیوترِ همان پمپ را در همین شبکهٔ خانگی باز کنید، خودش سرور را پیدا می‌کند و خودش را ثبت
          می‌کند. «پمپ تازه» فقط برای وقتی است که می‌خواهید پیش از نصبِ برنامه پوشه‌اش آماده باشد.
        </Notice>

        {stations.length === 0 ? (
          <Empty
            icon={<Fuel size={28} />}
            title="هنوز هیچ پمپی ثبت نشده"
            hint="برنامهٔ کامپیوترِ پمپ را در همین شبکه باز کنید؛ خودش این‌جا پیدا می‌شود."
          />
        ) : (
          <Table head={['پمپ بنزین', 'وضعیت', 'آخرین داده', 'صندوقِ ورودی', 'پوشه', 'رمزها', '']}>
            {stations.map((s) => (
              <Row key={s.code}>
                <Cell>
                  <div className="font-medium">{s.name}</div>
                  <div className="text-xs opacity-60">{s.code}</div>
                </Cell>
                <Cell>
                  <StatusDot online={isLive(s)} label={isLive(s) ? 'برنامه روشن است' : 'خبری نیست'} />
                  <div className="text-xs opacity-60">{s.liveConnections} دستگاهِ وصل</div>
                </Cell>
                <Cell>
                  <div>{fmtTime(s.liveAt)}</div>
                  <div className="text-xs opacity-60">{fmtBytes(s.diskBytes)}</div>
                </Cell>
                <Cell>{s.inboxCount}</Cell>
                <Cell>
                  <code className="text-xs break-all">{s.dataDir}</code>
                </Cell>
                <Cell>
                  <div className="text-xs opacity-70">برنامه: {s.tokenPreview ?? '—'}</div>
                  <div className="text-xs opacity-70">کارمند: {s.readKeyPreview ?? '—'}</div>
                </Cell>
                <Cell>
                  <div className="flex flex-wrap gap-1">
                    <ActionButton className="btn btn-sm btn-primary" onClick={() => openDetail(s.code)}>جزئیات</ActionButton>
                    <ActionButton onClick={() => showKeys(s.code)}>رمزها</ActionButton>
                    {canWrite && <ActionButton onClick={() => makePairing(s.code)}>کدِ جفت‌شدن</ActionButton>}
                    {isAdmin && (
                      <ActionButton className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(s)}>
                        حذف
                      </ActionButton>
                    )}
                  </div>
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>

      {/* حساب‌ها و اشتراک — از سرورِ ابر می‌آید، نه از این‌جا */}
      <StationsCloud />

      {(data?.pairings?.length ?? 0) > 0 && (
        <Card title="کدهای جفت‌شدنِ باز" icon={<Smartphone size={18} />}>
          <Table head={['کد', 'پمپ', 'تا']}>
            {data!.pairings!.map((p) => (
              <Row key={p.pin}>
                <Cell>
                  <code className="text-lg tracking-widest">{p.pin}</code>
                </Cell>
                <Cell>{p.code}</Cell>
                <Cell>{fmtTime(p.expires)}</Cell>
              </Row>
            ))}
          </Table>
        </Card>
      )}

      {data?.dataDir && (
        <Card title="پوشهٔ داده" icon={<KeyRound size={18} />}>
          <div className="text-sm">
            همهٔ پوشه‌ها زیرِ <code className="break-all">{data.dataDir}</code> می‌نشینند و در پشتیبان‌گیریِ خودکارِ
            پنل هم می‌آیند.
          </div>
          <div className="mt-2 text-sm opacity-70">
            ثبتِ پمپِ تازه:{' '}
            {data.enrollMode === 'lan'
              ? 'فقط از شبکهٔ خانگی (از اینترنت هرگز)'
              : data.enrollMode === 'off'
                ? 'بسته — فقط از همین صفحه'
                : 'باز برای همه (فقط برای آزمون)'}
          </div>
        </Card>
      )}

      <Modal
        open={showNew}
        title="پمپ بنزینِ تازه"
        onClose={() => setShowNew(false)}
        footer={
          <>
            <button className="btn" onClick={() => setShowNew(false)}>
              انصراف
            </button>
            <ActionButton className="btn btn-sm btn-primary" onClick={() => create()}>
              ساختن
            </ActionButton>
          </>
        }
      >
        <Field label="کد (انگلیسی، بی فاصله)">
          <input
            className="hlp-input"
            value={form.code}
            placeholder="pump2"
            onChange={(e) => setForm({ ...form, code: e.target.value })}
          />
        </Field>
        <Field label="نام">
          <input
            className="hlp-input"
            value={form.name}
            placeholder="پمپ بنزینِ دوم"
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Notice tone="info">
          همین کد باید در تنظیماتِ برنامهٔ کامپیوترِ همان پمپ هم نوشته شود؛ وگرنه برنامه پوشهٔ دیگری می‌سازد.
        </Notice>
      </Modal>

      {/* ══ جزئیاتِ پمپ — همان چیزی که اپِ کارمندان می‌بیند، این‌جا برای صاحبِ سرور ══ */}
      <Modal open={Boolean(detail)} wide title={`پمپ «${detail?.name ?? ''}» — ${detail?.code ?? ''}`}
             onClose={() => { setDetail(null); setConnect(null); }}>
        {detail && (
          <div className="space-y-3">
            <Tabs
              active={detailTab}
              onChange={setDetailTab}
              tabs={[
                { id: 'summary', label: 'خلاصه' },
                { id: 'debtors', label: 'قرض‌داران و خبرها', badge: detail.live?.alerts.length ?? 0 },
                { id: 'sections', label: 'بخش‌ها', badge: detail.live?.sections.length ?? 0 },
                { id: 'inbox', label: 'صندوقِ ورودی', badge: detail.inboxCount },
                { id: 'staff', label: 'اپِ کارمندان' },
              ]}
            />

            {!detail.live && (
              <Notice tone="warn">
                برنامهٔ کامپیوترِ این پمپ هنوز هیچ عکسی نفرستاده. همین که روشن شود و وصل باشد، هر بیست ثانیه
                یک عکسِ کامل می‌آید و همه‌چیز این‌جا پُر می‌شود.
              </Notice>
            )}

            {detailTab === 'summary' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="card p-3">
                  <div className="mb-1 text-xs font-semibold">وضعیت</div>
                  <KV label="آخرین عکس">{detail.live?.at ?? '—'}{detail.live?.atUtc ? ` · ${new Date(detail.live.atUtc).toLocaleTimeString('fa-IR')}` : ''}</KV>
                  <KV label="شمارهٔ عکس" mono>{detail.live?.seq ?? '—'}</KV>
                  <KV label="دستگاه‌های وصل">{fa(detail.liveConnections)}</KV>
                  <KV label="خوانده / نوشته">{fa(detail.reads)} / {fa(detail.writes)}</KV>
                  <KV label="روی دیسک">{fmtBytes(detail.diskBytes)}</KV>
                  <KV label="رمزِ قفلِ اپ">{detail.live ? (detail.live.hasGate ? 'دارد' : 'برنامه هنوز رمز نساخته') : '—'}</KV>
                  <KV label="ردیف‌های حساب‌ها">{detail.live ? (detail.live.detail ? 'کامل به گوشی می‌رود' : 'فقط جمع‌ها (دفتر بزرگ است)') : '—'}</KV>
                </div>
                <div className="card p-3">
                  <div className="mb-1 text-xs font-semibold">پمپ</div>
                  <KV label="نام">{detail.live?.station?.name || detail.name}</KV>
                  <KV label="نشانی">{detail.live?.station?.address || '—'}</KV>
                  <KV label="شماره" mono>{detail.live?.station?.phone || '—'}</KV>
                  <KV label="نرخِ اتحادیه — پطرول">{fa(detail.live?.station?.ratePetrol)}</KV>
                  <KV label="نرخِ اتحادیه — دیزل">{fa(detail.live?.station?.rateDiesel)}</KV>
                  <KV label="حساب‌های کیو‌آردار">{fa(detail.qrAccounts)}</KV>
                </div>
                {detail.live?.tank && (['petrol', 'diesel'] as const).map((k) => {
                  const t = detail.live!.tank![k];
                  if (!t) return null;
                  return (
                    <div key={k} className="card p-3">
                      <div className="mb-1 flex items-center justify-between text-xs font-semibold">
                        <span>مخزن — {k === 'petrol' ? 'پطرول' : 'دیزل'}</span>
                        {t.low ? <span className="chip" style={{ color: 'var(--status-critical)' }}>کم آمده</span>
                          : t.near ? <span className="chip" style={{ color: 'var(--status-warning)' }}>نزدیکِ حد</span> : null}
                      </div>
                      <KV label="موجودی (لیتر)">{fa(t.show ?? t.current)}</KV>
                      <KV label="وارد">{fa(t.in)}</KV>
                      <KV label="فروش">{fa(t.out)}</KV>
                    </div>
                  );
                })}
              </div>
            )}

            {detailTab === 'debtors' && detail.live && (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-4">
                  <Stat label="قرض‌داران" value={fa(detail.live.debtors.total)} />
                  <Stat label="موجودی دارد" value={fa(detail.live.debtors.ok)} tone="good" />
                  <Stat label="کم مانده" value={fa(detail.live.debtors.low)} tone="warn" />
                  <Stat label="تمام شده / اضافه برد" value={fa(detail.live.debtors.out)} tone="bad" />
                </div>
                {detail.live.alerts.length === 0 ? (
                  <Notice tone="good">همین حالا خبری نیست — هیچ قرض‌داری اضافه نبرده و کم هم نمانده.</Notice>
                ) : (
                  <Table head={['خبر', 'نوع']}>
                    {detail.live.alerts.map((a, i) => (
                      <Row key={a.k || i}>
                        <Cell>{a.t || '—'}</Cell>
                        <Cell>
                          <span className="chip" style={{ color: a.s === 'out' ? 'var(--status-critical)' : 'var(--status-warning)' }}>
                            {a.s === 'out' ? 'اضافه برد' : 'کم مانده'}
                          </span>
                        </Cell>
                      </Row>
                    ))}
                  </Table>
                )}
                <div className="text-xs opacity-60">
                  همان فهرستی که گوشیِ کارمندان زنگ می‌زند (‎StationSnapshot.Alerts‎). نام‌ها و مبلغ‌ها فقط در خودِ برنامه و اپِ کارمندان دیده می‌شوند.
                </div>
              </div>
            )}

            {detailTab === 'sections' && detail.live && (
              detail.live.sections.length === 0 ? <Notice>هنوز بخشی در عکس نیست.</Notice> : (
                <Table head={['بخش', 'ردیف‌ها', 'ماه‌ها']}>
                  {detail.live.sections.map((sec) => (
                    <Row key={sec.id}>
                      <Cell><div className="font-medium">{sec.title}</div><div className="text-xs opacity-60">{sec.id}</div></Cell>
                      <Cell>{fa(sec.rows)}</Cell>
                      <Cell>{fa(sec.months)}</Cell>
                    </Row>
                  ))}
                </Table>
              )
            )}

            {detailTab === 'inbox' && (
              detail.inbox.length === 0 ? (
                <Notice>صندوق خالی است. گوشیِ کارمندان از این‌جا درخواست و یادداشت می‌گذارند و برنامهٔ کامپیوتر پس از خواندن پاک می‌کند.</Notice>
              ) : (
                <Table head={['از', 'پیام', 'زمان']}>
                  {detail.inbox.map((m) => (
                    <Row key={m.id}>
                      <Cell>{m.from || '—'}</Cell>
                      <Cell><div className="max-w-md whitespace-pre-wrap break-words">{m.text || JSON.stringify(m)}</div></Cell>
                      <Cell>{fmtTime(m.at ? Number(m.at) : null)}</Cell>
                    </Row>
                  ))}
                </Table>
              )
            )}

            {detailTab === 'staff' && (
              <div className="space-y-3">
                <Notice>
                  کارمندان با <b>کدِ پمپ</b> وارد اپ می‌شوند — همان کدی که برنامهٔ کامپیوتر در بخشِ «پروفایل» نشان
                  می‌دهد و در «پمپ‌ها روی ابر» هم دیده می‌شود. کیو‌آرِ زیر راهِ دوم است: فقط برای جایی که اینترنت
                  نیست ولی شبکهٔ پمپ هست. رمزِ داخلش فقط‌خواندنی است.
                </Notice>
                {connect ? (
                  <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
                    {connect.staff.qr ? (
                      <img src={connect.staff.qr} alt="کیو‌آرِ اپِ کارمندان" className="h-44 w-44 rounded-xl bg-white p-2" />
                    ) : (
                      <div className="text-xs opacity-60">تونلِ عمومی روشن نیست؛ کیو‌آر ساخته نمی‌شود.</div>
                    )}
                    <div className="space-y-2 text-sm">
                      <div>
                        <div className="text-xs opacity-60">لینکِ اپِ کارمندان (اندروید و آیفون)</div>
                        {connect.staff.link ? (
                          <div className="flex items-center gap-2"><code className="text-xs break-all flex-1" dir="ltr">{connect.staff.link}</code><CopyButton value={connect.staff.link} /></div>
                        ) : <span className="opacity-60">—</span>}
                      </div>
                      <div>
                        <div className="text-xs opacity-60">شورت‌کاتِ آیفون (یک GET ساده)</div>
                        {connect.shortcut ? (
                          <div className="flex items-center gap-2"><code className="text-xs break-all flex-1" dir="ltr">{connect.shortcut}</code><CopyButton value={connect.shortcut} /></div>
                        ) : <span className="opacity-60">—</span>}
                      </div>
                      <div className="text-xs opacity-60">
                        فایلِ نصبِ اندروید: <code dir="ltr">PumpYaqobiKar.apk</code> از انتشارِ <code dir="ltr">kar-latest</code>. آیفون: همان صفحه در Safari و «افزودن به صفحهٔ اصلی».
                      </div>
                    </div>
                  </div>
                ) : <Loading label="لینکِ اپ" />}
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal open={Boolean(keys)} title={`رمزهای پمپ «${keys?.code ?? ''}»`} onClose={() => setKeys(null)}>
        {keys && (
          <div className="space-y-3">
            <div>
              <div className="text-sm font-medium">رمزِ برنامهٔ کامپیوتر — می‌نویسد</div>
              <div className="text-xs opacity-60 mb-1">فقط در خودِ برنامهٔ همان پمپ. به هیچ‌کسِ دیگری ندهید.</div>
              <div className="flex items-center gap-2">
                <code className="text-xs break-all flex-1">{keys.token}</code>
                <CopyButton value={keys.token} />
              </div>
              {isAdmin && (
                <div className="mt-1">
                  <ActionButton onClick={() => rotate(keys.code, 'token')}>عوض کردن</ActionButton>
                </div>
              )}
            </div>
            <div>
              <div className="text-sm font-medium">رمزِ کارمند — فقط می‌خواند</div>
              <div className="text-xs opacity-60 mb-1">
                همین در کیو‌آرِ اپِ کارمندان و در اپِ اندروید/آیفون می‌نشیند. حتی اگر لو برود، هیچ‌کس نمی‌تواند چیزی
                را عوض کند.
              </div>
              <div className="flex items-center gap-2">
                <code className="text-xs break-all flex-1">{keys.readKey}</code>
                <CopyButton value={keys.readKey} />
              </div>
              {canWrite && (
                <div className="mt-1">
                  <ActionButton onClick={() => rotate(keys.code, 'read-key')}>عوض کردن</ActionButton>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(pairing)} title="کدِ جفت‌شدن" onClose={() => setPairing(null)}>
        {pairing && (
          <div className="space-y-2">
            <div className="text-center text-3xl tracking-[0.4em] font-mono">{pairing.pin}</div>
            <Notice tone="info">
              این کد ده دقیقه و فقط یک بار کار می‌کند. در برنامهٔ کامپیوترِ پمپ «{pairing.code}» واردش کنید تا برنامه
              رمزِ خودش را بگیرد — بی اینکه لازم باشد در شبکهٔ خانگی باشد.
            </Notice>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title={`حذفِ پمپ «${confirmDelete?.name ?? ''}»`}
        message={`کلِ پوشهٔ ${confirmDelete?.dataDir ?? ''} و هر چه در آن است پاک می‌شود. این کار برگشت ندارد.`}
        danger
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) void remove(confirmDelete);
        }}
      />
    </div>
  );
}
