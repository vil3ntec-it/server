// ---------------------------------------------------------------------------
//  🔢 کد و ربات — بخشِ پمپ بنزین
//
//  کدِ شش‌رقمی برای پمپ، و رباتی که همان کد را به ایمیلِ خودِ طرف می‌فرستد.
//
//  ⚠️ این همان موتور و همان صفِ بخشِ «کدهای شش‌رقمی» است — نه یک نسخهٔ
//  دوم. اگر این‌جا دفترِ جداگانه‌ای می‌ساختیم، روزی یکی می‌گفت «کد
//  فرستاده شد» و آن یکی «چیزی نیست».
//
//  کدها با برچسبِ همین بخش (pump-station) ثبت می‌شوند تا در فهرستِ کلی
//  هم معلوم باشد مالِ پمپ‌اند و با کدهای دکان قاتی نشوند.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { Pin, Send } from 'lucide-react';

import { api } from '../api';
import { useApp } from '../app-context';
import { Card, CopyButton, Field, Loading, toast } from '../components/ui';
import { ActionButton, Cell, Notice, Row, Stat, Table } from '../control/ui';

/** شناسهٔ این بخش در موتورِ کدها — همان که برنامهٔ اندرویدِ مدیر هم می‌زند */
const PUMP_APP = 'pump-station';
const PUMP_LABEL = 'پمپ بنزین';

type CodeRow = {
  id: number;
  email: string;
  code: string | null;
  createdAt: number;
  expiresIn: number;
  status: 'live' | 'used' | 'replaced' | 'expired';
  sendState: 'queued' | 'sending' | 'sent' | 'failed';
  sendError: string | null;
  sendResponse?: string | null;
  tries: number;
};

type Queue = { waiting: number; sending: number; failed: number; sentLastHour: number; mailReady: boolean };

const fa = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('fa-AF'));
const fmtTime = (ms: number) => new Date(ms).toLocaleString('fa-IR');

const STATUS_FA: Record<string, string> = {
  live: 'زنده', used: 'خرج شده', replaced: 'با کدِ تازه باطل شد', expired: 'منقضی',
};
const SEND_FA: Record<string, string> = {
  sent: 'رفت', failed: 'نرفت', sending: 'در حالِ فرستادن', queued: 'در صف',
};

export default function PumpCodes() {
  const { role } = useApp();
  const canWrite = role === 'admin' || role === 'operator';

  const [items, setItems] = useState<CodeRow[] | null>(null);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<{ items: CodeRow[]; queue: Queue }>(
        `/api/codes-admin/live?app=${encodeURIComponent(PUMP_APP)}`
      );
      setItems(res.items || []);
      setQueue(res.queue || null);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'نشد', 'bad');
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
    //  کدها دو دقیقه عمر دارند؛ صفحه باید هم‌قدمِ همان باشد
    const timer = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(timer);
  }, [load]);

  /*
   *  ⚠️ این درخواست عمداً کُند است و باید باشد: سرور تا خودِ سرورِ ایمیل
   *  نگوید «گرفتم» جواب نمی‌دهد. تا دیروز همان لحظه «فرستاده شد» می‌گفت
   *  و اگر ایمیل نمی‌رفت، هیچ‌جا معلوم نمی‌شد.
   */
  async function send() {
    if (!email.trim() || busy) return;
    setBusy(true);
    try {
      const res = await api<{ ok: boolean; message?: string; delivery?: { state: string; error?: string | null } }>(
        '/api/codes-admin/send',
        {
          method: 'POST',
          body: {
            app: PUMP_APP,
            appName: PUMP_LABEL,
            kind: 'app',
            email: email.trim(),
            name: name.trim() || undefined,
          },
        }
      );
      const failed = res.delivery?.state === 'failed' || res.ok === false;
      toast(res.message || (failed ? 'ایمیل نرفت' : 'کد رفت'), failed ? 'bad' : 'good');
      if (!failed) { setEmail(''); setName(''); }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'نشد', 'bad');
    } finally {
      setBusy(false);
      void load();
    }
  }

  if (items === null) return <Loading label="کدهای پمپ" />;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="در صفِ ارسال" value={fa(queue?.waiting ?? 0)} tone={queue?.waiting ? 'warn' : undefined} />
        <Stat label="در یک ساعتِ گذشته رفت" value={fa(queue?.sentLastHour ?? 0)} tone="good" />
        <Stat label="نرفته (۲۴ ساعت)" value={fa(queue?.failed ?? 0)} tone={queue?.failed ? 'bad' : undefined} />
        <Stat
          label="رباتِ ایمیل"
          value={queue?.mailReady ? 'آماده' : 'تنظیم نشده'}
          tone={queue?.mailReady ? 'good' : 'bad'}
          sub={queue?.mailReady ? '' : 'در «کدهای شش‌رقمی» سرورِ ایمیل را تنظیم کنید'}
        />
      </div>

      {canWrite && (
        <Card title="ربات — کد را به ایمیلِ طرف بفرست" icon={<Send size={18} />}>
          <Notice tone="info">
            کد ساخته می‌شود و همان لحظه به ایمیلِ خودِ همان شخص می‌رود — با نام و کدِ خودش،
            نه چیزی تصادفی. اگر نام بگذارید، ایمیل با «فلانی عزیز» شروع می‌شود.
          </Notice>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="ایمیلِ گیرنده">
              <input
                dir="ltr"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
              />
            </Field>
            <Field label="نامِ گیرنده (اختیاری)">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="احمد یعقوبی" />
            </Field>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <ActionButton className="btn btn-sm btn-primary" onClick={send} disabled={busy || !email.trim()}>
              {busy ? 'در حالِ فرستادن…' : 'بفرست'}
            </ActionButton>
            {busy && <span className="text-xs opacity-60">منتظرِ جوابِ سرورِ ایمیل…</span>}
          </div>
        </Card>
      )}

      <Card title="کدهای پمپ بنزین" icon={<Pin size={18} />} action={<ActionButton onClick={load}>تازه‌سازی</ActionButton>}>
        {items.length === 0 ? (
          <Notice>هنوز کدی برای پمپ ساخته نشده.</Notice>
        ) : (
          <Table head={['ایمیل', 'کد', 'مانده', 'وضعیت', 'ارسال', 'ساخت', '']}>
            {items.map((row) => (
              <Row key={row.id}>
                <Cell><span dir="ltr">{row.email}</span></Cell>
                <Cell>
                  {row.code
                    ? <code className="font-mono text-base tracking-[0.2em]" dir="ltr">{row.code}</code>
                    : <span className="text-xs opacity-60">—</span>}
                </Cell>
                <Cell>
                  {row.status === 'live'
                    ? <span className="tnum text-xs">{fa(row.expiresIn)} ثانیه</span>
                    : <span className="text-xs opacity-60">—</span>}
                </Cell>
                <Cell><span className="text-xs">{STATUS_FA[row.status] || row.status}</span></Cell>
                <Cell>
                  <span
                    className="text-xs"
                    style={{
                      color: row.sendState === 'sent' ? 'var(--status-good)'
                        : row.sendState === 'failed' ? 'var(--status-critical)'
                        : 'var(--status-warning)',
                    }}
                    title={row.sendError || row.sendResponse || undefined}
                  >
                    {SEND_FA[row.sendState] || row.sendState}
                  </span>
                  {/* دلیلِ نرفتن باید دیده شود، نه پشتِ نگه‌داشتنِ موس قایم بماند */}
                  {row.sendState === 'failed' && row.sendError && (
                    <div className="mt-0.5 text-[10px] leading-snug" style={{ color: 'var(--status-critical)' }} dir="auto">
                      {row.sendError}
                    </div>
                  )}
                </Cell>
                <Cell><span className="text-xs opacity-70">{fmtTime(row.createdAt)}</span></Cell>
                <Cell>{row.code && <CopyButton value={row.code} />}</Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
