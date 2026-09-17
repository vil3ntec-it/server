// ---------------------------------------------------------------------------
//  🔐 ورودها — هر برنامه در بخشِ خودش
//
//  ⚠️ چرا این صفحه ساخته شد: تا امروز هیچ تاریخچه‌ای از ورود نبود، فقط یک
//  «آخرین ورود» روی خودِ کاربر. یعنی نمی‌شد فهمید کی، کِی، از کجا و به
//  کدام برنامه وارد شده — و اگر حسابی دستِ کسِ دیگری می‌افتاد، هیچ ردی
//  نمی‌ماند.
//
//  ⚠️ و تلاش‌های *ناموفق* هم این‌جا دیده می‌شوند، که مهم‌ترند: چند کدِ غلط
//  پشتِ هم روی یک ایمیل، تنها نشانه‌ای است که کسی دارد حدس می‌زند.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { KeyRound, LogIn, ShieldAlert, UserPlus } from 'lucide-react';

import { api } from '../api';
import { Card, Loading, toast } from '../components/ui';
import { ActionButton, Cell, Notice, Row, Stat, Table, Tabs } from '../control/ui';

type Login = {
  id: number;
  app: string;
  userId: number | null;
  email: string;
  at: number;
  ok: boolean;
  reason: string | null;
  device: string | null;
  ip: string | null;
  isNew: boolean;
};

type Summary = {
  app: string | null;
  total: number;
  today: number;
  failedToday: number;
  newToday: number;
  lastAt: number | null;
};

type AppRow = Summary & { slug: string; name: string; kindLabel?: string };

const fa = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('fa-AF'));
const fmt = (ms: number | null) => (ms ? new Date(ms).toLocaleString('fa-IR') : '—');

/** چرا وارد نشد — به فارسیِ قابلِ فهم */
const WHY: Record<string, string> = {
  wrong_code: 'کد غلط بود',
  expired: 'کد منقضی شده بود',
  no_code: 'کدی درخواست نشده بود',
  too_many_tries: 'تلاشِ زیاد',
  blocked: 'حساب مسدود است',
  bad_email: 'ایمیل درست نبود',
  unknown_app: 'برنامه ثبت نشده',
};

export default function AppLogins() {
  const [apps, setApps] = useState<AppRow[] | null>(null);
  const [all, setAll] = useState<Summary | null>(null);
  const [app, setApp] = useState<string>('');
  const [only, setOnly] = useState<'all' | 'ok' | 'failed'>('all');
  const [logins, setLogins] = useState<Login[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);

  const loadApps = useCallback(async () => {
    try {
      const res = await api<{ apps: AppRow[]; all: Summary }>('/api/app-admin/logins/summary');
      setApps(res.apps || []);
      setAll(res.all || null);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'نشد', 'bad');
      setApps([]);
    }
  }, []);

  const loadLogins = useCallback(async () => {
    try {
      const q = new URLSearchParams();
      if (app) q.set('app', app);
      if (only !== 'all') q.set('only', only);
      q.set('limit', '200');
      const res = await api<{ logins: Login[]; summary: Summary }>(`/api/app-admin/logins?${q}`);
      setLogins(res.logins || []);
      setSummary(res.summary || null);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'نشد', 'bad');
    }
  }, [app, only]);

  useEffect(() => { void loadApps(); }, [loadApps]);
  useEffect(() => { void loadLogins(); }, [loadLogins]);

  if (apps === null) return <Loading label="ورودها" />;

  const shown = summary || all;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">ورودها</h1>
        <p className="mt-1 text-xs text-ink-muted">
          هر برنامه بخشِ خودش را دارد. تلاش‌های ناموفق هم این‌جا دیده می‌شوند.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="ورودِ موفقِ امروز" value={fa(shown?.today)} icon={<LogIn size={16} />} tone="good" />
        <Stat
          label="تلاشِ ناموفقِ امروز"
          value={fa(shown?.failedToday)}
          icon={<ShieldAlert size={16} />}
          tone={shown?.failedToday ? 'warn' : undefined}
          sub={shown?.failedToday ? 'اگر زیاد است، کسی دارد حدس می‌زند' : ''}
        />
        <Stat label="حسابِ تازهٔ امروز" value={fa(shown?.newToday)} icon={<UserPlus size={16} />} />
        <Stat label="آخرین ورود" value={fmt(shown?.lastAt ?? null)} icon={<KeyRound size={16} />} />
      </div>

      {/* ── انتخابِ برنامه ────────────────────────────────────────────── */}
      <Tabs
        active={app}
        onChange={(id) => setApp(id)}
        tabs={[
          { id: '', label: 'همه', badge: all?.today },
          ...apps.map((a) => ({ id: a.slug, label: a.name || a.slug, badge: a.today })),
        ]}
      />

      <Card
        title={app ? `ورودهای «${apps.find((a) => a.slug === app)?.name || app}»` : 'ورودهای همهٔ برنامه‌ها'}
        icon={<LogIn size={18} />}
        action={
          <div className="flex gap-2">
            <ActionButton onClick={() => { void loadApps(); void loadLogins(); }}>تازه‌سازی</ActionButton>
            <ActionButton onClick={() => setOnly(only === 'failed' ? 'all' : 'failed')}>
              {only === 'failed' ? 'همه' : 'فقط ناموفق'}
            </ActionButton>
          </div>
        }
      >
        {logins.length === 0 ? (
          <Notice>
            {only === 'failed' ? 'تلاشِ ناموفقی ثبت نشده.' : 'هنوز کسی وارد نشده است.'}
          </Notice>
        ) : (
          <Table head={['کِی', 'ایمیل', 'برنامه', 'نتیجه', 'دستگاه', 'IP']}>
            {logins.map((l) => (
              <Row key={l.id}>
                <Cell><span className="text-xs">{fmt(l.at)}</span></Cell>
                <Cell>
                  <span dir="ltr" className="text-sm">{l.email}</span>
                  {l.isNew && <div className="text-[10px]" style={{ color: 'var(--status-good)' }}>حسابِ تازه</div>}
                </Cell>
                <Cell><span className="text-xs">{apps.find((a) => a.slug === l.app)?.name || l.app}</span></Cell>
                <Cell>
                  <span
                    className="chip whitespace-nowrap text-xs"
                    style={{
                      background: `color-mix(in srgb, ${l.ok ? 'var(--status-good)' : 'var(--status-critical)'} 15%, transparent)`,
                      color: l.ok ? 'var(--status-good)' : 'var(--status-critical)',
                    }}
                  >
                    {l.ok ? 'وارد شد' : (WHY[l.reason || ''] || l.reason || 'نشد')}
                  </span>
                </Cell>
                <Cell><span className="truncate text-[10px] text-ink-muted">{l.device || '—'}</span></Cell>
                <Cell><span className="text-xs" dir="ltr">{l.ip || '—'}</span></Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>

      {/* ── خلاصهٔ هر برنامه، کنارِ هم ──────────────────────────────────── */}
      <Card title="هر برنامه در یک نگاه" icon={<KeyRound size={18} />}>
        {apps.length === 0 ? (
          <Notice>هنوز برنامه‌ای ثبت نشده.</Notice>
        ) : (
          <Table head={['برنامه', 'نوع', 'ورودِ امروز', 'ناموفقِ امروز', 'حسابِ تازه', 'کلِ ورودها', 'آخرین ورود']}>
            {apps.map((a) => (
              <Row key={a.slug} onClick={() => setApp(a.slug)}>
                <Cell>
                  <div className="text-sm font-medium">{a.name || a.slug}</div>
                  <div className="text-[10px] text-ink-muted" dir="ltr">{a.slug}</div>
                </Cell>
                <Cell><span className="text-xs">{a.kindLabel || '—'}</span></Cell>
                <Cell><span className="tnum">{fa(a.today)}</span></Cell>
                <Cell>
                  <span className="tnum" style={a.failedToday ? { color: 'var(--status-critical)' } : undefined}>
                    {fa(a.failedToday)}
                  </span>
                </Cell>
                <Cell><span className="tnum">{fa(a.newToday)}</span></Cell>
                <Cell><span className="tnum">{fa(a.total)}</span></Cell>
                <Cell><span className="text-xs">{fmt(a.lastAt)}</span></Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
