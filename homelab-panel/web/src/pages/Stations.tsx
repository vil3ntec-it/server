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
import { ActionButton, Cell, Notice, Row, Table } from '../control/ui';
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

  return (
    <div className="space-y-4">
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
