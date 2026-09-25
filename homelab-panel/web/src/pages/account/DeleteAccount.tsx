// ---------------------------------------------------------------------------
//  🗑️ حذفِ کاملِ حساب — «از ریشه»
//
//  خواستهٔ صاحب سامانه (۱۴۰۵/۰۷/۱۳): «نمی‌تونم حسابِ کاربری رو حذف کنم از
//  ریشه.» تا امروز فقط «تعلیق» بود.
//
//  ⛔ **پیش از زدنِ دکمه، دیده می‌شود چه می‌رود** — پیش‌نمایش از خودِ سرورِ
//     حساب می‌آید (`delete-preview`)، نه از حدسِ این صفحه.
//  ⛔ **تا ایمیلِ همان حساب دقیق تایپ نشده، دکمه خاموش است** — و سرورِ حساب
//     هم خودش همان را دوباره می‌سنجد. یک کلیکِ اشتباه نباید پمپِ کسی را ببرد.
//  ⚠️ پرداخت‌ها (درآمدِ شما) و دفترِ ممیزی نمی‌روند؛ شرحش در
//     `shop/server/src/lib/user-delete.js`.
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api } from '../../api';
import { Modal, Skeleton, toast } from '../../components/ui';
import { Notice } from '../../control/ui';
import { fa } from './shared';

type Preview = {
  user: { id: string; email: string; name: string; status: string };
  stations: { id: string; name: string; otherMembers: number }[];
  shops: { id: string; name: string; otherMembers: number }[];
  memberOf: { stations: number; shops: number };
};

export default function DeleteAccount({
  userId, onClose, onDone,
}: { userId: string; onClose: () => void; onDone: () => void | Promise<void> }) {
  const [pv, setPv] = useState<Preview | null>(null);
  const [err, setErr] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Preview>(`/api/account-admin/users/${encodeURIComponent(userId)}/delete-preview`)
      .then(setPv)
      .catch((e) => setErr(e?.message || 'پیش‌نمایش نیامد'));
  }, [userId]);

  const match = !!pv && typed.trim().toLowerCase() === (pv.user.email || '').toLowerCase();
  const others = pv ? [...pv.stations, ...pv.shops].reduce((n, x) => n + x.otherMembers, 0) : 0;

  const go = async () => {
    if (!pv || !match) return;
    setBusy(true);
    try {
      await api(`/api/account-admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE', body: { confirmEmail: typed.trim() } });
      toast(`حسابِ ${pv.user.email} کاملاً حذف شد`, 'good');
      await onDone();
      onClose();
    } catch (e) {
      setErr((e as Error)?.message || 'حذف نشد');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={<span className="flex items-center gap-2"><Trash2 size={18} /> حذفِ کاملِ حساب</span>}
      footer={(
        <div className="flex justify-end gap-2">
          <button className="btn btn-sm" onClick={onClose}>انصراف</button>
          <button
            className="btn btn-sm"
            style={{ background: match ? 'var(--status-critical)' : undefined, color: match ? '#fff' : undefined }}
            disabled={!match || busy}
            onClick={go}
          >
            {busy ? 'در حالِ حذف…' : 'حذفِ همیشگی'}
          </button>
        </div>
      )}
    >
      {!pv && !err && <Skeleton rows={4} />}
      {err && <Notice tone="bad">{err}</Notice>}
      {pv && (
        <div className="flex flex-col gap-3 text-sm">
          <p>
            حسابِ <b>{pv.user.name || '—'}</b> (<span dir="ltr">{pv.user.email}</span>) و هرچه مالِ خودِ اوست
            <b> برای همیشه</b> پاک می‌شود. برگرداندنی نیست.
          </p>
          <ul className="list-disc pr-5 text-ink-soft">
            <li>{pv.stations.length ? `پمپ‌های خودش: ${pv.stations.map((s) => s.name).join('، ')} — با اشتراک، دستگاه‌ها، پیوندهای تلگرام و پشتیبان‌های ابری` : 'هیچ پمپی ندارد'}</li>
            <li>{pv.shops.length ? `دکان‌های خودش: ${pv.shops.map((s) => s.name).join('، ')}` : 'هیچ دکانی ندارد'}</li>
            <li>نشست‌ها، دستگاه‌ها، کدهای ورود و راه‌های ورودِ همین حساب</li>
            {(pv.memberOf.stations + pv.memberOf.shops) > 0 && (
              <li>عضویتش در {fa(pv.memberOf.stations + pv.memberOf.shops)} پمپ/دکانِ کسِ دیگر برداشته می‌شود — خودِ آن‌ها دست نمی‌خورند</li>
            )}
            <li>پرداخت‌ها (درآمدِ شما) و دفترِ ممیزی <b>نمی‌روند</b></li>
          </ul>
          {others > 0 && (
            <Notice tone="warn">{fa(others)} نفرِ دیگر عضوِ پمپ یا دکانِ همین حساب‌اند و دسترسی‌شان هم می‌رود.</Notice>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-muted">برای تایید، ایمیلِ همین حساب را بنویسید:</span>
            <input className="input" dir="ltr" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={pv.user.email} />
          </label>
        </div>
      )}
    </Modal>
  );
}
