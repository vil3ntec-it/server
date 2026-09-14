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
import { CreditCard, Users } from 'lucide-react';

import { api } from '../api';
import { Card, Field, Loading, toast } from '../components/ui';
import { ActionButton, Cell, Notice, Row, Table } from '../control/ui';

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

export default function StationsCloud() {
  const [status, setStatus] = useState<Status | null>(null);
  const [users, setUsers] = useState<PumpUser[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [expiring, setExpiring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');

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

  useEffect(() => { loadStatus(); }, [loadStatus]);
  useEffect(() => { if (status?.linked) loadData(expiring); }, [status?.linked, expiring, loadData]);

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

  return (
    <>
      <Card
        title="افرادِ پمپ‌ها"
        icon={<Users size={18} />}
        action={<ActionButton onClick={unlink} disabled={busy}>قطعِ اتصال به ابر</ActionButton>}
      >
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

      <Card
        title="اشتراک‌های پمپ"
        icon={<CreditCard size={18} />}
        action={
          <ActionButton onClick={() => setExpiring((v) => !v)}>
            {expiring ? 'همه' : 'رو به پایان'}
          </ActionButton>
        }
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
              const left = ends ? Math.max(0, Math.ceil((Number(ends) - Date.now()) / day)) : null;
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
    </>
  );
}
