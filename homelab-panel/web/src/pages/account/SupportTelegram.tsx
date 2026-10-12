// پلِ تلگرامِ پشتیبانی — پیامِ کاربرانِ پمپ و فروشگاه در تلگرامِ مالک؛ Reply در تلگرام به خودِ کاربر می‌رسد.
// همهٔ منطق روی سرور است (server/src/support/telegram.js)؛ این فقط فرمِ تنظیم است.
import { useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import { api } from '../../api';
import { Modal, toast } from '../../components/ui';

type State = { enabled: boolean; chatId: string; apps: string[]; hasToken: boolean; tokenHint: string; last: { at: number; sent: number; replied: number } | null; bot?: { loggedIn: boolean; username?: string; until?: number } };

const APPS: Record<string, string> = { pump: 'پمپ', shop: 'فروشگاه', site: 'سایت‌ها' };

export function SupportTelegramButton() {
  const [open, setOpen] = useState(false);
  const [st, setSt] = useState<State | null>(null);
  useEffect(() => { api<State>('/api/support-telegram').then(setSt).catch(() => setSt(null)); }, [open]);
  return (
    <>
      <button className="btn btn-sm" onClick={() => setOpen(true)} title="پیام‌های پشتیبانی در تلگرامِ شما">
        <Send className="h-3.5 w-3.5" /> تلگرام {st?.enabled ? <span className="text-[10px] text-state-good">● روشن</span> : null}
      </button>
      {open && <SupportTelegramDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function SupportTelegramDialog({ onClose }: { onClose: () => void }) {
  const [st, setSt] = useState<State | null>(null);
  const [token, setToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [apps, setApps] = useState<string[]>(['pump', 'shop', 'site']);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    api<State>('/api/support-telegram').then((s) => { setSt(s); setChatId(s.chatId); setApps(s.apps); setEnabled(s.enabled); }).catch((e) => toast(e.message, 'bad'));
  }, []);

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    try { await fn(); } catch (e: any) { toast(e?.message || 'نشد', 'bad'); } finally { setBusy(''); }
  };
  const save = () => run('save', async () => {
    const s = await api<State>('/api/support-telegram', { method: 'PUT', body: { enabled, chatId, apps, ...(token ? { token } : {}) } });
    setSt(s); setToken(''); toast('ذخیره شد');
  });
  const find = () => run('find', async () => {
    const r = await api<{ chat: { id: string; title: string } }>('/api/support-telegram/find-chat', { method: 'POST', body: token ? { token } : {} });
    setChatId(r.chat.id); toast(`پیدا شد: ${r.chat.title || r.chat.id}`);
  });
  const test = () => run('test', async () => { await api('/api/support-telegram/test', { method: 'POST', body: {} }); toast('فرستاده شد؛ تلگرام را ببینید'); });
  const toggleApp = (a: string) => setApps((cur) => (cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]));

  return (
    <Modal open onClose={onClose} title="پشتیبانی در تلگرام"
      footer={<div className="flex flex-wrap justify-end gap-2">
        <button className="btn btn-sm" onClick={test} disabled={!!busy || !st?.hasToken || !st?.chatId}>پیامِ آزمایشی</button>
        <button className="btn btn-sm btn-primary" onClick={save} disabled={!!busy}>{busy === 'save' ? '…' : 'ذخیره'}</button>
      </div>}>
      <div className="space-y-4 text-sm">
        <p className="text-ink-muted">پیامِ هر کاربرِ برنامهٔ پمپ و فروشگاه، و هر بازدیدکنندهٔ سایت، همان لحظه در تلگرامِ شما هم می‌آید. روی پیام <b>Reply</b> بزنید و بنویسید؛ جوابتان به خودِ همان کاربر در برنامه یا سایت می‌رسد.</p>
        <ol className="list-decimal space-y-1 pr-5 text-xs text-ink-muted">
          <li>در تلگرام با ‎@BotFather‎ یک <b>رباتِ تازه و جدا</b> بسازید (‎/newbot‎) و توکن را این‌جا بچسبانید. ⛔ نه رباتِ پمپ بنزین — آن برای صاحبانِ پمپ است و پنل توکنش را نمی‌پذیرد. (رباتِ اعلانِ سایت را می‌شود همین گذاشت.)</li>
          <li>ربات را باز کنید و Start بزنید، بعد «پیدا کردن».</li>
          <li>«روشن» را بزنید، ذخیره کنید و «پیامِ آزمایشی» را امتحان کنید.</li>
          <li>🔐 در ربات ‎/login‎ بزنید و <b>نام و رمزِ همین پنل</b> را بدهید (و کدِ دوعاملی اگر روشن است). بی ورود هیچ دستور، دکمه یا جوابی کار نمی‌کند؛ پیامِ رمز همان لحظه از تلگرام پاک می‌شود.</li>
          <li>پس از ورود، <b>منوی ثابتِ پایینِ صفحه</b> می‌آید: 💬 صندوقِ پیام‌ها · 🔎 جست‌وجوی حساب · ⏳ اشتراک‌های رو به پایان · 🔑 کدِ آفلاین · 🛠 مدیریتِ سرور (آپدیتِ کنترول سنتر، سرورِ حساب، برنامهٔ پمپ و سایت‌ها، ری‌استارت، پشتیبان، کارهای خودکار، تونل، خطاها) · 🖥 وضعیتِ سرور · 🌐 سایت‌ها · 📊 گزارش · 📣 پیامِ همگانی · ⚙️ تنظیمات. زیرِ هر پیامِ کاربر: ✍️ جواب (متن، عکس، ویدیو، صدا) · ⚡ جوابِ آماده · 💬 کلِ گفت‌وگو · 👤 حساب و اشتراک · ✅ بستن. هشدارِ دیسک، سرورِ حساب و سایت‌ها و گزارشِ روزانه خودشان می‌آیند.</li>
        </ol>
        {st?.chatId && (
          <p className="text-xs">{st.bot?.loggedIn
            ? <>🔓 ربات با «<bdi>{st.bot.username}</bdi>» وارد شده — تا {new Date(st.bot.until || 0).toLocaleDateString('fa-IR')}. عوض کردنِ رمزِ پنل همان لحظه بیرونش می‌کند.</>
            : <>🔒 ربات قفل است؛ در تلگرام ‎/login‎ بزنید.</>}</p>
        )}
        <label className="block">
          <span className="mb-1 block text-xs font-semibold">توکنِ ربات {st?.hasToken ? <span className="font-normal text-ink-muted">(ذخیره شده: <bdi dir="ltr">{st.tokenHint}</bdi> — برای عوض کردن، تازه بچسبانید)</span> : null}</span>
          <input className="input w-full" dir="ltr" autoComplete="off" placeholder="123456789:AA…" value={token} onChange={(e) => setToken(e.target.value.trim())} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold">شناسهٔ گفت‌وگوی شما (chat id)</span>
          <div className="flex gap-2">
            <input className="input min-w-0 flex-1" dir="ltr" value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="123456789" />
            <button className="btn btn-sm" onClick={find} disabled={!!busy || (!token && !st?.hasToken)}>{busy === 'find' ? '…' : 'پیدا کردن'}</button>
          </div>
        </label>
        <div>
          <span className="mb-1 block text-xs font-semibold">پیام‌های کدام برنامه بیاید؟</span>
          <div className="flex gap-4">
            {Object.entries(APPS).map(([k, label]) => (
              <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={apps.includes(k)} onChange={() => toggleApp(k)} /> {label}</label>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> روشن</label>
        {st?.last ? <p className="text-xs text-ink-muted">آخرین دور: {new Date(st.last.at).toLocaleTimeString('fa-IR')} · {st.last.sent} پیام به تلگرام · {st.last.replied} جواب به کاربران</p> : null}
      </div>
    </Modal>
  );
}
