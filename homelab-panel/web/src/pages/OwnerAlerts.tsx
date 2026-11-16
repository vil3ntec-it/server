// ---------------------------------------------------------------------------
//  «اعلان‌ها» — دروازهٔ پیام به مالک (۱.۵۳.۰، server/src/notify/owner.js)
//
//  خواستهٔ صاحب سامانه: «روزی ۲۰۰ تا پیام میده برای هر چی… نمی‌خوام انقدر پیامِ بی‌خود بیاد مثلِ سیل.»
//  این صفحه می‌گوید امروز چند پیام رفت و چه چیزی پرسروصدا بود، و قاعده‌ها را عوض می‌کند: مهلتِ تکرار،
//  سقفِ روزانه، ساعتِ خلاصه، ساعتِ آرام، و برای هر نوع روشن/خاموش و اهمیت.
//  ⛔ هیچ چیزی گم نمی‌شود: دفترِ پایین همه را دارد، چه رفت چه نرفت و چرا.
//  ⛔ «امنیت» قفل است — همیشه روشن و بحرانی (سرور هم همین را می‌پذیرد، نه فقط این‌جا).
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BellRing, Lock, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { Badge, Card, Loading, toast } from '../components/ui';
import { ActionButton, Cell, Notice, Row, Stat, Table } from '../control/ui';
import { PageHead } from './account/shared';

type Severity = 'critical' | 'warn' | 'info';
type Settings = {
  cooldownH: number; criticalCooldownH: number; dailyCap: number; digestHour: number;
  quiet: boolean; quietFrom: number; quietTo: number; tz: string; codesSilent: boolean;
  types: Record<string, { on?: boolean; severity?: Severity }>;
};
type TypeRow = { id: string; label: string; hint: string; locked: boolean; defaultSeverity: Severity | null };
type Stats = {
  day: string; total: number; alerts: number; cap: number; sentByType: Record<string, number>;
  byType: Record<string, number>; byDecision: Record<string, number>; top: { type: string; label: string; n: number }[];
  active: { key: string; type: string; severity: Severity; title: string; since: number; notified: boolean }[];
  quietNow: boolean; lastDigestAt: number | null; pending: number;
};
type HistoryRow = { id: number; at: number; type: string; severity: Severity; phase: string; title: string; decision: string };
type Payload = { settings: Settings; types: TypeRow[]; countOnly: Record<string, string>; stats: Stats; history: HistoryRow[] };

const fa = (n: number) => Number(n || 0).toLocaleString('fa-IR');
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const SEV_FA: Record<Severity, string> = { critical: 'بحرانی', warn: 'هشدار', info: 'خبر' };
const SEV_TONE: Record<Severity, 'bad' | 'warn' | 'info'> = { critical: 'bad', warn: 'warn', info: 'info' };
/** تصمیمِ هر ردیف — «چرا رفت یا نرفت» به زبانِ ساده */
const DECISION: Record<string, { label: string; tone: 'good' | 'warn' | 'bad' | 'info' | 'neutral' }> = {
  sent: { label: 'رفت', tone: 'good' },
  summarized: { label: 'در پیامِ جمعی رفت', tone: 'good' },
  pending: { label: 'در صف', tone: 'info' },
  waiting: { label: 'منتظر: اگر ادامه داشت', tone: 'info' },
  digest: { label: 'فقط خلاصهٔ شب', tone: 'neutral' },
  suppressed: { label: 'تکراری — نرفت', tone: 'neutral' },
  held: { label: 'ساعتِ آرام — صبح', tone: 'neutral' },
  capped: { label: 'سقفِ روزانه — نرفت', tone: 'warn' },
  panel: { label: 'خاموش — فقط پنل', tone: 'neutral' },
  dropped: { label: 'زود درست شد — نرفت', tone: 'neutral' },
  expired: { label: 'دیر شد — در خلاصه', tone: 'warn' },
  failed: { label: 'نرسید', tone: 'bad' },
};
const PHASE: Record<string, string> = { recovery: '✅ برطرف شد', reminder: '⏰ یادآوری', notice: '🔕', digest: '📋', event: '', problem: '' };
const NOT_SENT = ['digest', 'suppressed', 'held', 'capped', 'panel', 'dropped', 'expired', 'waiting'];
const hourLabel = (h: number) => `${fa(h)}:۰۰`;
const when = (ms: number, tz: string) => new Date(ms).toLocaleString('fa-IR', { timeZone: tz, hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric', hourCycle: 'h23' });

export default function OwnerAlertsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('');

  const load = useCallback(async () => {
    try {
      const res = await api<Payload>('/api/owner-alerts');
      setData(res);
      setForm(res.settings);
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const labels = useMemo(() => {
    const m: Record<string, string> = { ...(data?.countOnly || {}) };
    for (const t of data?.types || []) m[t.id] = t.label;
    return m;
  }, [data]);

  if (!data || !form) return <Loading />;
  const { stats, settings } = data;
  const people = (stats.sentByType.inbox || 0) + (stats.sentByType.codes || 0);
  const notSent = NOT_SENT.reduce((a, d) => a + (stats.byDecision[d] || 0), 0);
  const activeBad = stats.active.filter((a) => a.severity !== 'info');
  const dirty = JSON.stringify({ ...form, types: undefined }) !== JSON.stringify({ ...settings, types: undefined });

  const save = async (patch: Partial<Omit<Settings, 'types'>> & { types?: Record<string, { on?: boolean; severity?: Severity | 'auto' }> }) => {
    try {
      const res = await api<{ settings: Settings; stats: Stats }>('/api/owner-alerts/settings', { method: 'PUT', body: patch });
      setData((d) => (d ? { ...d, settings: res.settings, stats: res.stats } : d));
      setForm(res.settings);
      toast('ذخیره شد');
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  };

  const num = (k: 'cooldownH' | 'criticalCooldownH' | 'dailyCap', v: string) => setForm({ ...form, [k]: Number(v) });
  const history = filter ? data.history.filter((h) => h.type === filter) : data.history;

  return (
    <div>
      <PageHead
        title="اعلان‌ها"
        sub="پیام‌هایی که سرور برای شما در تلگرام می‌فرستد — فقط وقتی چیزی عوض شد، بی تکرار؛ خبرهای روزمره فقط در خلاصهٔ شب"
        actions={<ActionButton onClick={load} className="btn btn-sm"><RefreshCw size={14} /> تازه کن</ActionButton>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="امروز چند پیام فرستاده شد"
          value={fa(stats.total)}
          sub={`${fa(stats.alerts)} هشدار · ${fa(stats.sentByType.inbox || 0)} پیامِ کاربر · ${fa(stats.sentByType.codes || 0)} کد`}
          icon={<BellRing size={16} />}
          tone="info"
        />
        <Stat
          label="هشدار از سقفِ روزانه"
          value={`${fa(stats.alerts)} / ${fa(stats.cap)}`}
          sub={stats.alerts >= stats.cap ? 'سقف پر شد — فقط بحرانی‌ها می‌روند' : 'بحرانی‌ها بیرون از سقف‌اند'}
          tone={stats.alerts >= stats.cap ? 'warn' : 'good'}
        />
        <Stat
          label="نفرستادم (در پنل و خلاصه هست)"
          value={fa(notSent)}
          sub={[['suppressed', 'تکراری'], ['digest', 'خلاصه'], ['held', 'شب'], ['capped', 'سقف']].filter(([d]) => stats.byDecision[d]).map(([d, l]) => `${l} ${fa(stats.byDecision[d])}`).join(' · ') || 'امروز چیزی کنار نرفت'}
        />
        <Stat
          label="هنوز برقرار"
          value={fa(activeBad.length)}
          sub={activeBad[0] ? activeBad[0].title : 'مشکلِ بازی نیست'}
          tone={activeBad.some((a) => a.severity === 'critical') ? 'bad' : activeBad.length ? 'warn' : 'good'}
        />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card title="پرسروصداترین‌های امروز">
          {stats.top.length ? (
            <ol className="space-y-2 text-sm">
              {stats.top.map((t, i) => (
                <li key={t.type} className="flex items-center justify-between gap-3">
                  <span className="text-ink-soft">{fa(i + 1)}. {labels[t.type] || t.label}</span>
                  <button className="tnum text-xs text-ink-muted underline-offset-2 hover:underline" onClick={() => setFilter(t.type)}>{fa(t.n)} رخداد</button>
                </li>
              ))}
            </ol>
          ) : <p className="text-sm text-ink-muted">امروز هنوز هشداری نیامده.</p>}
          {people > 0 && <p className="mt-3 text-[11px] text-ink-muted">پیامِ کاربران و کدها هشدار نیستند و سقف ندارند؛ فقط شمرده می‌شوند.</p>}
        </Card>

        <Card title="قاعده‌ها">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label">تکرارِ هشدار، حداکثر هر (ساعت)</span>
              <input className="input" type="number" min={1} max={72} value={form.cooldownH} onChange={(e) => num('cooldownH', e.target.value)} />
            </label>
            <label className="block">
              <span className="label">تکرارِ بحرانی، حداکثر هر (ساعت)</span>
              <input className="input" type="number" min={1} max={24} value={form.criticalCooldownH} onChange={(e) => num('criticalCooldownH', e.target.value)} />
            </label>
            <label className="block">
              <span className="label">سقفِ هشدار در روز</span>
              <input className="input" type="number" min={5} max={200} value={form.dailyCap} onChange={(e) => num('dailyCap', e.target.value)} />
            </label>
            <label className="block">
              <span className="label">ساعتِ خلاصهٔ روزانه</span>
              <select className="input" value={form.digestHour} onChange={(e) => setForm({ ...form, digestHour: Number(e.target.value) })}>
                {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.quiet} onChange={(e) => setForm({ ...form, quiet: e.target.checked })} />
              ساعتِ آرام از
            </label>
            <select className="input w-24" disabled={!form.quiet} value={form.quietFrom} onChange={(e) => setForm({ ...form, quietFrom: Number(e.target.value) })}>
              {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
            <span>تا</span>
            <select className="input w-24" disabled={!form.quiet} value={form.quietTo} onChange={(e) => setForm({ ...form, quietTo: Number(e.target.value) })}>
              {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
            {stats.quietNow && <Badge tone="info">الان ساعتِ آرام است</Badge>}
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.codesSilent} onChange={(e) => setForm({ ...form, codesSilent: e.target.checked })} />
            کدهای شش‌رقمی بی‌صدا برسند (هشدار نیستند)
          </label>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-muted">
            بحرانی‌ها (سرورِ خاموش، دیسکِ تقریباً پر، پشتیبانِ ناموفق، امنیت) همیشه و همان دم می‌رسند — حتی شب و بالای سقف.
            ساعت‌ها به وقتِ {form.tz === 'Asia/Kabul' ? 'کابل' : form.tz}.
          </p>
          <div className="mt-3 flex justify-end">
            <ActionButton className="btn btn-primary btn-sm" disabled={!dirty} onClick={() => save({
              cooldownH: form.cooldownH, criticalCooldownH: form.criticalCooldownH, dailyCap: form.dailyCap, digestHour: form.digestHour,
              quiet: form.quiet, quietFrom: form.quietFrom, quietTo: form.quietTo, codesSilent: form.codesSilent,
            })}>ذخیره</ActionButton>
          </div>
        </Card>
      </div>

      <Card title="نوع‌ها — کدام برود و چقدر مهم است" className="mb-4">
        <Notice tone="info">«خودکار» یعنی همان اهمیتی که خودِ بررسی می‌گوید (دیسکِ ۹۰٪ هشدار، ۹۵٪ بحرانی). «خبر» یعنی فقط در خلاصهٔ شب. خاموش یعنی فقط در همین صفحه.</Notice>
        <Table head={['نوع', 'تلگرام', 'اهمیت', 'امروز']}>
          {data.types.map((t) => {
            const o = settings.types[t.id] || {};
            const on = t.locked || o.on !== false;
            return (
              <Row key={t.id}>
                <Cell>
                  <div className="font-medium text-ink">{t.label}</div>
                  <div className="text-[11px] text-ink-muted">{t.hint}</div>
                </Cell>
                <Cell>
                  {t.locked ? (
                    <Badge tone="bad"><Lock size={11} className="inline" /> همیشه روشن</Badge>
                  ) : (
                    <label className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={on} onChange={(e) => void save({ types: { [t.id]: { on: e.target.checked } } })} />
                      {on ? 'تلگرام' : 'فقط پنل'}
                    </label>
                  )}
                </Cell>
                <Cell>
                  {t.locked ? (
                    <Badge tone="bad">بحرانی</Badge>
                  ) : (
                    <select className="input w-32 py-1 text-xs" value={o.severity || 'auto'} onChange={(e) => void save({ types: { [t.id]: { severity: e.target.value as Severity | 'auto' } } })}>
                      <option value="auto">{t.defaultSeverity ? `خودکار (${SEV_FA[t.defaultSeverity]})` : 'خودکار'}</option>
                      <option value="critical">بحرانی</option>
                      <option value="warn">هشدار</option>
                      <option value="info">خبر</option>
                    </select>
                  )}
                </Cell>
                <Cell className="tnum text-xs text-ink-muted">{stats.byType[t.id] ? fa(stats.byType[t.id]) : '—'}</Cell>
              </Row>
            );
          })}
        </Table>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card
          title={filter ? `دفترِ اعلان‌ها — ${labels[filter] || filter}` : 'دفترِ اعلان‌ها — همه چیز، چه رفت چه نرفت'}
          className="lg:col-span-2"
          action={filter ? <button className="btn btn-sm" onClick={() => setFilter('')}>همه</button> : undefined}
        >
          <Table head={['کِی', 'نوع', 'چه', 'چه شد']} empty={!history.length}>
            {history.map((h) => {
              const d = DECISION[h.decision] || { label: h.decision, tone: 'neutral' as const };
              return (
                <Row key={h.id}>
                  <Cell className="tnum whitespace-nowrap text-xs text-ink-muted">{when(h.at, settings.tz)}</Cell>
                  <Cell className="whitespace-nowrap text-xs">
                    {labels[h.type] || h.type}
                    {h.severity !== 'info' && h.phase !== 'recovery' && <span className="ms-1"><Badge tone={SEV_TONE[h.severity]}>{SEV_FA[h.severity]}</Badge></span>}
                  </Cell>
                  <Cell className="text-xs">{PHASE[h.phase] ? <span className="me-1 text-ink-muted">{PHASE[h.phase]}</span> : null}{h.title}</Cell>
                  <Cell><Badge tone={d.tone}>{d.label}</Badge></Cell>
                </Row>
              );
            })}
          </Table>
        </Card>
        <Card title="خلاصهٔ امشب">
          <p className="mb-3 text-xs text-ink-muted">
            ساعتِ {hourLabel(settings.digestHour)} یک پیام (همراهِ گزارشِ روزانهٔ ربات): خبرها، هشدارهای نرفته و آن‌چه هنوز برقرار است.
          </p>
          <ActionButton className="btn btn-sm" onClick={async () => setDigest((await api<{ text: string }>('/api/owner-alerts/digest')).text)}>پیش‌نمایش</ActionButton>
          {digest && <div className="mt-3 whitespace-pre-wrap rounded-xl bg-surface-raised p-3 text-xs leading-relaxed text-ink-soft" dir="rtl">{digest}</div>}
        </Card>
      </div>
    </div>
  );
}
