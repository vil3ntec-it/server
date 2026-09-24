// ---------------------------------------------------------------------------
//  ⛽ پروفایلِ یک پمپ — به شکلِ «پروفایلِ بیمار»ِ مرجع
//
//  خواستهٔ صاحب ریپو با عکس: «بخشِ سرورِ پمپ یک فیصد شبیهِ بخشِ پروفایل نیست؛
//  باید شبیهِ این عکس باشد، یا بهتر.» پس جزئیاتِ پمپ دیگر یک مودالِ تب‌دار
//  نیست؛ یک صفحهٔ کامل است، سه‌ستونه:
//
//    ┌──────────┬───────────────────────┬──────────────┐
//    │ آواتار   │ مشخصات                │ وضعیت         │
//    ├──────────┴───────────────────────┼──────────────┤
//    │ تب‌ها: خبرها · صندوق · بخش‌ها     │ فایل‌ها       │
//    │ (ردیف‌های رنگی)                  │ اپِ کارمندان  │
//    └──────────────────────────────────┴──────────────┘
//
//  همهٔ داده از ‎/api/stations-admin/:code/detail‎ می‌آید (همان ‎live.json‎ که
//  برنامهٔ کامپیوتر هر بیست ثانیه می‌فرستد) — این‌جا هیچ حسابی حساب نمی‌شود.
//  ⚠️ رمزها در این صفحه نمی‌آیند؛ همان مودالِ «رمزها»ی صفحهٔ فهرست.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Archive, ArrowRight, FolderTree, Fuel, HardDrive, Inbox, Smartphone } from 'lucide-react';

import { api } from '../api';
import { useLive } from '../useLive';
import { stationOnline } from '../stationLive';
import { Card, CopyButton, Loading, StatusDot } from '../components/ui';
import { ActionButton, KV, Notice, Tabs } from '../control/ui';

type TankSide = { in?: number; out?: number; show?: number; current?: number; low?: boolean; near?: boolean };
type Detail = {
  code: string; name: string; dataDir: string; diskBytes: number;
  liveConnections: number; reads: number; writes: number; lastActivity: number | null;
  live: null | {
    at: string | null; atUtc: string | null; seq: number | null; hasGate: boolean; detail: boolean;
    station: { name: string; address: string; phone: string; ratePetrol: number | null; rateDiesel: number | null } | null;
    tank: { petrol?: TankSide; diesel?: TankSide } | null;
    debtors: { total: number; ok: number; low: number; out: number; none: number };
    alerts: { k?: string; s?: string; t?: string }[];
    sections: { id: string; title: string; rows: number; months: number }[];
  };
  inbox: { id: string; text?: string; from?: string; at?: number; kind?: string }[];
  inboxCount: number;
  qrAccounts: number;
  files: { key: string; bytes: number; children: number }[];
  //  «پوشهٔ این حساب» — چیدمانِ ثابتِ ‎stations/layout.js‎ روی سرور
  folder?: {
    path: string; exists: boolean; bytes: number; missing: string[];
    items: { name: string; kind: 'file' | 'dir'; title: string; branch: string | null;
             secret: boolean; exists: boolean; bytes: number; at: string | null; children: number | null }[];
    extras: { name: string; kind: 'file' | 'dir'; bytes: number; at: string | null }[];
  };
  //  پشتیبان‌های همین پمپ — ‎stations/backups.js‎، سه روزِ تقویمی
  backups?: { name: string; day: string; bytes: number; at: string }[];
};
type Connect = { code: string; name: string; staff: { link: string | null; qr: string | null; readKey: string }; shortcut: string | null };
type CloudStation = { id: string; code: string; name: string; sub_status: string | null; ends_at: number | null; plan: string | null };
type CloudDetail = { accessCode: string; station: { homeSeenAt: number | null }; members: { id: string; role: string; name?: string; email?: string | null }[] };

const fa = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('fa-AF'));
const fmtTime = (ms: number | null | undefined) => (ms ? new Date(Number(ms)).toLocaleString('fa-IR') : '—');
const fmtBytes = (n: number) => {
  if (!n) return '۰';
  const u = ['B', 'KB', 'MB', 'GB']; let v = n; let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
};
const PALETTE = ['var(--accent)', 'var(--status-good)', 'var(--status-warning)', 'var(--status-critical)'];
const SUB_FA: Record<string, string> = { active: 'فعال', trial: 'آزمایشی', expired: 'تمام شده', suspended: 'معلق', cancelled: 'لغو شده' };

/** یک ردیفِ رنگی — همان «ویزیت»های مرجع: نوارِ رنگی راست، سه ستونِ برچسب/مقدار. */
function Row({ color, cells }: { color: string; cells: { l: string; v: string; strong?: boolean }[] }) {
  return (
    <div className="grid gap-3 rounded-xl px-4 py-3" style={{
      gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))`,
      background: `color-mix(in srgb, ${color} 9%, var(--surface-2))`,
      borderInlineStart: `5px solid ${color}`,
    }}>
      {cells.map((c, i) => (
        <div key={i} className="min-w-0">
          <div className="text-[11px] text-ink-muted">{c.l}</div>
          <div className={`truncate text-sm ${c.strong ? 'font-semibold' : ''}`} style={c.strong ? { color } : undefined}>{c.v}</div>
        </div>
      ))}
    </div>
  );
}

export default function StationProfile() {
  const { code = '' } = useParams();
  const [d, setD] = useState<Detail | null>(null);
  const [connect, setConnect] = useState<Connect | null>(null);
  const [cloud, setCloud] = useState<{ st: CloudStation; detail: CloudDetail | null } | null>(null);
  const [tab, setTab] = useState('alerts');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      setD(await api<Detail>(`/api/stations-admin/${encodeURIComponent(code)}/detail`));
      setErr('');
    } catch (e) { setErr((e as Error).message); }
  }, [code]);

  /*
   *  ⛔ نبضِ کورِ بیست‌ثانیه‌ای برداشته شد. هر نوشتنِ دفترِ پمپ از
   *  ‎sitesync/store.js‎ موضوعِ «پمپ‌ها» را بیدار می‌کند، پس این صفحه
   *  همان لحظه تازه می‌شود و تا چیزی عوض نشود **صفر** درخواست می‌زند.
   *  ⚠️ کفِ شصت‌ثانیه‌ای فقط برای وقتی است که گذرگاه وصل نباشد.
   */
  useLive('stations', load, 60000);

  useEffect(() => {
    void load();
    api<Connect>(`/api/stations-admin/${encodeURIComponent(code)}/connect?karBase=${encodeURIComponent('https://yaqobipump.top/kar')}`)
      .then(setConnect).catch(() => setConnect(null));
    //  سرورِ حساب اختیاری است: اگر وصل نباشد، کارتِ اپِ کارمندان فقط کیو‌آر را دارد
    api<{ stations: CloudStation[] }>('/api/stations-admin/cloud/stations?limit=200')
      .then(async (r) => {
        const st = (r.stations || []).find((s) => s.code === code);
        if (!st) return;
        let detail: CloudDetail | null = null;
        try { detail = await api<CloudDetail>(`/api/stations-admin/cloud/station/${encodeURIComponent(st.id)}`); } catch { /* بی کد */ }
        setCloud({ st, detail });
      }).catch(() => {});
  }, [code, load]);

  if (err && !d) return <Card title="پمپ" icon={<Fuel size={18} />}><Notice tone="bad">{err}</Notice><Link className="btn" to="/stations">برگشت</Link></Card>;
  if (!d) return <Loading label="پروفایلِ پمپ" />;

  const live = d.live;
  const online = stationOnline(d);
  const name = live?.station?.name || d.name;
  const initial = (name || d.code).trim().slice(0, 1) || '⛽';
  const tank = live?.tank || null;
  const deb = live?.debtors;

  return (
    <div className="space-y-4">
      {/* ── سربرگِ صفحه ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link className="btn btn-sm" to="/stations"><ArrowRight size={14} /> پمپ‌بنزین‌ها</Link>
          <h1 className="text-lg font-semibold">پروفایلِ پمپ</h1>
        </div>
        <div className="flex gap-2">
          <ActionButton onClick={load}>تازه‌سازی</ActionButton>
          {connect?.staff.link && <CopyButton value={connect.staff.link} label="کپیِ لینکِ اپ" />}
        </div>
      </div>

      {/* ── ردیفِ اول: آواتار · مشخصات · وضعیت ── */}
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)_320px]">
        <Card>
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex h-28 w-28 items-center justify-center rounded-full text-4xl font-bold"
                 style={{ background: 'color-mix(in srgb, var(--accent) 18%, transparent)', color: 'var(--accent)' }}>
              {initial}
            </div>
            <div>
              <div className="text-lg font-semibold">{name}</div>
              <div className="text-xs opacity-60" dir="ltr">{d.code}</div>
            </div>
            <StatusDot online={online} label={online ? 'برنامه روشن است' : 'خبری نیست'} />
            {cloud && (
              <span className="chip" style={{ background: 'color-mix(in srgb, var(--status-good) 15%, transparent)', color: 'var(--status-good)' }}>
                {SUB_FA[cloud.st.sub_status || ''] || 'بدونِ اشتراک'}{cloud.st.plan ? ` · ${cloud.st.plan}` : ''}
              </span>
            )}
            <div className="mt-2 w-full border-t border-line pt-3 text-xs text-ink-muted">
              <div>{fa(d.liveConnections)} دستگاهِ وصل</div>
              <div>آخرین عکس: {live?.at ?? '—'}</div>
            </div>
          </div>
        </Card>

        <Card title="مشخصات" icon={<Fuel size={16} />}>
          <KV label="نامِ پمپ">{name}</KV>
          <KV label="کد" mono>{d.code}</KV>
          <KV label="تلفن" mono>{live?.station?.phone || '—'}</KV>
          <KV label="نشانی">{live?.station?.address || '—'}</KV>
          <KV label="نرخِ اتحادیه — پطرول">{fa(live?.station?.ratePetrol)}</KV>
          <KV label="نرخِ اتحادیه — دیزل">{fa(live?.station?.rateDiesel)}</KV>
          <KV label="رمزِ قفلِ اپ">{live ? (live.hasGate ? 'دارد' : 'برنامه هنوز رمز نساخته') : '—'}</KV>
          <KV label="پوشهٔ داده" mono>{d.dataDir}</KV>
          <KV label="حساب‌های کیو‌آردار">{fa(d.qrAccounts)}</KV>
          {cloud?.detail && <KV label="آخرین اتصال به سرورِ حساب">{fmtTime(cloud.detail.station.homeSeenAt)}</KV>}
        </Card>

        <Card title="وضعیت" icon={<HardDrive size={16} />}>
          {!live ? (
            <Notice tone="warn">برنامهٔ کامپیوترِ این پمپ هنوز عکسی نفرستاده.</Notice>
          ) : (
            <div className="space-y-3">
              {(['petrol', 'diesel'] as const).map((k) => {
                const t = tank?.[k]; if (!t) return null;
                const color = t.low ? 'var(--status-critical)' : t.near ? 'var(--status-warning)' : 'var(--status-good)';
                return (
                  <div key={k} className="rounded-xl p-3" style={{ background: `color-mix(in srgb, ${color} 10%, var(--surface-2))` }}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">مخزن — {k === 'petrol' ? 'پطرول' : 'دیزل'}</span>
                      <span style={{ color }}>{t.low ? 'کم آمده' : t.near ? 'نزدیکِ حد' : 'خوب'}</span>
                    </div>
                    <div className="tnum mt-1 text-2xl font-semibold" style={{ color }}>{fa(t.show ?? t.current)} <span className="text-xs font-normal">لیتر</span></div>
                    <div className="text-[11px] opacity-60">وارد {fa(t.in)} · فروش {fa(t.out)}</div>
                  </div>
                );
              })}
              {deb && (
                <div className="grid grid-cols-2 gap-2 text-center">
                  {[['قرض‌داران', deb.total, 'var(--accent)'], ['موجودی دارد', deb.ok, 'var(--status-good)'],
                    ['کم مانده', deb.low, 'var(--status-warning)'], ['تمام شده', deb.out, 'var(--status-critical)']].map(([l, v, c]) => (
                    <div key={String(l)} className="rounded-xl p-2" style={{ background: `color-mix(in srgb, ${c} 10%, var(--surface-2))` }}>
                      <div className="tnum text-xl font-semibold" style={{ color: String(c) }}>{fa(Number(v))}</div>
                      <div className="text-[11px] opacity-70">{l}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* ── ردیفِ دوم: تب‌ها · فایل‌ها و اپِ کارمندان ── */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <Tabs active={tab} onChange={setTab} tabs={[
            { id: 'alerts', label: 'خبرها', badge: live?.alerts.length ?? 0 },
            { id: 'inbox', label: 'صندوقِ ورودی', badge: d.inboxCount },
            { id: 'sections', label: 'بخش‌ها', badge: live?.sections.length ?? 0 },
            ...(cloud?.detail ? [{ id: 'members', label: 'اعضای سرورِ حساب', badge: cloud.detail.members.length }] : []),
          ]} />
          <div className="space-y-2">
            {tab === 'alerts' && ((live?.alerts.length ?? 0) === 0
              ? <Notice tone="good">همین حالا خبری نیست — هیچ قرض‌داری اضافه نبرده و کم هم نمانده.</Notice>
              : live!.alerts.map((a, i) => (
                <Row key={a.k || i} color={a.s === 'out' ? 'var(--status-critical)' : 'var(--status-warning)'}
                     cells={[{ l: 'خبر', v: a.t || '—', strong: true }, { l: 'نوع', v: a.s === 'out' ? 'اضافه برد' : 'کم مانده' }, { l: 'کلید', v: a.k || '' }]} />
              )))}
            {tab === 'inbox' && (d.inbox.length === 0
              ? <Notice>صندوق خالی است. گوشیِ کارمندان از این‌جا درخواست می‌گذارند و برنامه پس از خواندن پاک می‌کند.</Notice>
              : d.inbox.map((m, i) => (
                <Row key={m.id} color={PALETTE[i % PALETTE.length]}
                     cells={[{ l: 'زمان', v: fmtTime(m.at), strong: true }, { l: 'از', v: m.from || '—' }, { l: 'پیام', v: m.text || JSON.stringify(m) }]} />
              )))}
            {tab === 'sections' && ((live?.sections.length ?? 0) === 0
              ? <Notice>هنوز بخشی در عکس نیست.</Notice>
              : live!.sections.map((s, i) => (
                <Row key={s.id} color={PALETTE[i % PALETTE.length]}
                     cells={[{ l: 'بخش', v: s.title, strong: true }, { l: 'ردیف‌ها', v: fa(s.rows) }, { l: 'ماه‌ها', v: fa(s.months) }, { l: 'شناسه', v: s.id }]} />
              )))}
            {tab === 'members' && cloud?.detail && (cloud.detail.members.length === 0
              ? <Notice>کسی با گوگل به این پمپ نپیوسته.</Notice>
              : cloud.detail.members.map((m, i) => (
                <Row key={m.id} color={PALETTE[i % PALETTE.length]}
                     cells={[{ l: 'نام', v: m.name || m.email || m.id, strong: true }, { l: 'نقش', v: m.role === 'owner' ? 'صاحب' : m.role === 'manager' ? 'مدیر' : 'کارمند' }]} />
              )))}
          </div>
        </Card>

        <div className="space-y-4">
          {/*
            ── پوشهٔ این حساب ──────────────────────────────────────────────
            خواستهٔ صاحب سامانه: «برای هر حسابِ کاربر یک فولدرِ مخصوصِ خودش،
            دقیق و منظم چیده شود و اطلاعاتشان دیده شود.»
            ⛔ فهرست از ‎stations/layout.js‎ی سرور می‌آید، نه از یک کپیِ
            دستی این‌جا — وگرنه فایلی که فردا اضافه شود در این صفحه
            بی‌صدا از قلم می‌افتاد.
            ⛔ و رمزها فقط «هست/نیست» می‌شوند؛ محتوایشان هیچ‌وقت خوانده
            نمی‌شود.
          */}
          <Card title="پوشهٔ این حساب" icon={<FolderTree size={16} />}
                action={<span className="text-xs opacity-60">{fmtBytes(d.folder?.bytes ?? d.diskBytes)}</span>}>
            {!d.folder ? (
              <Notice>نسخهٔ سرور این فهرست را نمی‌دهد.</Notice>
            ) : (
              <>
                <div className="mb-2 flex items-center gap-2 text-[11px] text-ink-muted">
                  <span className="truncate" dir="ltr" title={d.folder.path}>{d.folder.path}</span>
                  <CopyButton value={d.folder.path} />
                </div>
                <div className="space-y-1.5">
                  {d.folder.items.map((f) => (
                    <div key={f.name} className={`flex items-center justify-between gap-2 text-sm ${f.exists ? '' : 'opacity-45'}`}>
                      <span className="flex min-w-0 items-center gap-2">
                        {f.kind === 'dir' ? <Archive size={14} className="opacity-60" /> : <Inbox size={14} className="opacity-60" />}
                        <span className="truncate" dir="ltr">{f.name}</span>
                        <span className="truncate text-[11px] opacity-60">{f.title}</span>
                      </span>
                      <span className="whitespace-nowrap text-xs opacity-60">
                        {f.exists
                          ? (f.secret ? 'ساخته شده' : `${fmtBytes(f.bytes)}${f.children ? ` · ${fa(f.children)} فایل` : ''}`)
                          : 'هنوز نیامده'}
                      </span>
                    </div>
                  ))}
                  {d.folder.extras.map((f) => (
                    <div key={`x-${f.name}`} className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <Inbox size={14} className="opacity-60" />
                        <span className="truncate" dir="ltr">{f.name}</span>
                        <span className="text-[11px]" style={{ color: 'var(--status-warning)' }}>ناشناخته</span>
                      </span>
                      <span className="whitespace-nowrap text-xs opacity-60">{fmtBytes(f.bytes)}</span>
                    </div>
                  ))}
                </div>
                {/* ⚠️ «هنوز نیامده» خطا نیست: پمپی که چیزی نفرستاده ‎live.json‎ ندارد. */}
                {d.folder.missing.length > 0 && (
                  <div className="mt-2 text-[11px] opacity-60">
                    {`${fa(d.folder.missing.length)} قلم هنوز ساخته نشده — تا برنامه چیزی نفرستد طبیعی است.`}
                  </div>
                )}
              </>
            )}
          </Card>

          {/*
            ── فایل‌های پشتیبان ────────────────────────────────────────────
            «بک‌اپ‌ها هم همین‌طور [دیده شوند]». ⛔ فقط دیدنی است: نه دانلود،
            نه پاک کردن. چرخشِ سه‌روزه کارِ ‎stations/backups.js‎ است.
          */}
          <Card title="فایل‌های پشتیبان" icon={<Archive size={16} />}
                action={<span className="text-xs opacity-60">{fa(d.backups?.length || 0)}</span>}>
            {!d.backups || d.backups.length === 0 ? (
              <Notice>هنوز پشتیبانی از این پمپ نرسیده. برنامهٔ کامپیوتر هر ۶ ساعت می‌فرستد.</Notice>
            ) : (
              <div className="space-y-1.5">
                {d.backups.map((b) => (
                  <div key={b.name} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <Archive size={14} className="opacity-60" />
                      <span className="truncate" dir="ltr">{b.name}</span>
                    </span>
                    <span className="whitespace-nowrap text-xs opacity-60">
                      {new Date(b.at).toLocaleString('fa-IR')} · {fmtBytes(b.bytes)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="اپِ کارمندان" icon={<Smartphone size={16} />}>
            {cloud?.detail?.accessCode ? (
              <div className="mb-3">
                <div className="text-[11px] text-ink-muted">کدِ پمپ — کارمند همین را در اپ می‌زند</div>
                <div className="flex items-center gap-2">
                  <code className="text-2xl tracking-[0.2em] font-mono" dir="ltr">{cloud.detail.accessCode}</code>
                  <CopyButton value={cloud.detail.accessCode} />
                </div>
              </div>
            ) : (
              <div className="mb-3 text-xs opacity-60">کدِ پمپ از سرورِ حساب می‌آید؛ برنامهٔ کامپیوتر آن را در «پروفایل» نشان می‌دهد.</div>
            )}
            {connect?.staff.qr
              ? <img src={connect.staff.qr} alt="کیو‌آرِ اپِ کارمندان" className="mx-auto h-40 w-40 rounded-xl bg-white p-2" />
              : <div className="text-xs opacity-60">کیو‌آرِ راهِ بی‌اینترنت وقتی تونل روشن باشد ساخته می‌شود.</div>}
            <div className="mt-2 text-[11px] opacity-60">
              اندروید: <code dir="ltr">PumpYaqobiKar.apk</code> · آیفون: همان صفحه در Safari و «افزودن به صفحهٔ اصلی».
            </div>
          </Card>
        </div>
      </div>
      {err && <Notice tone="warn">{err}</Notice>}
    </div>
  );
}
