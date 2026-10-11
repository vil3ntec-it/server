// گفت‌وگوهای سایت‌ها (مثلاً vill3n.top) — پیامِ بازدیدکننده این‌جا، در پنلِ خودِ سایت و در تلگرام می‌آید؛
// جواب از هر کدام درجا به همان پنجرهٔ سایت می‌رسد. همهٔ منطق روی سرور است (server/src/support/site-chats.js).
import { useEffect, useRef, useState } from 'react';
import { Globe, Send } from 'lucide-react';
import { api } from '../../api';
import { Modal, toast } from '../../components/ui';

type Chat = { id: string; name: string; contact: string; page: string; status: string; unread: number; updatedAt: number; lastFrom: string; lastMessage: string };
type SiteRow = { slug: string; name: string; domain: string; chats: Chat[]; unread: number; error?: string };
type Msg = { id: string; from: 'visitor' | 'owner'; body: string; at: number };

const time = (t: number) => new Date(t).toLocaleString('fa-IR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** هر ۴ ثانیه وقتی باز است، هر ۳۰ ثانیه وقتی بسته (فقط برای شمارهٔ نخوانده) */
function usePoll<T>(fn: () => Promise<T>, ms: number, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try { const d = await fn(); if (alive) { setData(d); setError(''); } } catch (e: any) { if (alive) setError(e?.message || 'نشد'); }
      if (alive) timer = setTimeout(tick, document.hidden ? ms * 3 : ms);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, setData };
}

export function SiteChatsButton() {
  const [open, setOpen] = useState(false);
  const { data } = usePoll(() => api<{ sites: SiteRow[]; unread: number }>('/api/site-chats'), open ? 60000 : 30000, [open]);
  if (data && !data.sites.length) return null; // هیچ سایتی گفت‌وگو ندارد
  const unread = data?.unread || 0;
  return (
    <>
      <button className="btn btn-sm" onClick={() => setOpen(true)} title="پیام‌هایی که بازدیدکنندگان در سایت می‌دهند">
        <Globe className="h-3.5 w-3.5" /> پیام‌های سایت
        {unread ? <span className="rounded-full bg-accent px-1.5 text-[10px] font-bold text-white">{unread.toLocaleString('fa-IR')}</span> : null}
      </button>
      {open && <SiteChatsDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function SiteChatsDialog({ onClose }: { onClose: () => void }) {
  const list = usePoll(() => api<{ sites: SiteRow[]; unread: number }>('/api/site-chats'), 5000, []);
  const [cur, setCur] = useState<{ slug: string; id: string } | null>(null);
  const rows = (list.data?.sites || []).flatMap((s) => s.chats.map((c) => ({ ...c, site: s })));
  rows.sort((a, b) => b.updatedAt - a.updatedAt);
  const errors = (list.data?.sites || []).filter((s) => s.error);

  return (
    <Modal open onClose={onClose} wide title="پیام‌های سایت">
      <div className="grid gap-3 text-sm md:grid-cols-[minmax(220px,300px)_minmax(0,1fr)]" style={{ minHeight: 420 }}>
        <div className={`${cur ? 'hidden md:block' : ''} max-h-[65vh] overflow-y-auto rounded-xl border border-line`}>
          {errors.map((s) => <p key={s.slug} className="border-b border-line p-2 text-xs text-state-bad">{s.name}: {s.error}</p>)}
          {!list.data && !list.error ? <p className="p-3 text-ink-muted">…</p> : null}
          {list.error ? <p className="p-3 text-state-bad">{list.error}</p> : null}
          {list.data && !rows.length ? <p className="p-3 text-ink-muted">هنوز کسی در سایت پیام نداده.</p> : null}
          {rows.map((r) => {
            const on = cur?.slug === r.site.slug && cur?.id === r.id;
            return (
              <button key={`${r.site.slug}:${r.id}`} onClick={() => setCur({ slug: r.site.slug, id: r.id })}
                className={`block w-full border-b border-line p-2.5 text-right ${on ? 'bg-accent-soft' : 'hover:bg-surface-raised'}`}>
                <div className="flex items-center justify-between gap-2">
                  <b className="truncate">{r.name}</b>
                  {r.unread ? <span className="rounded-full bg-accent px-1.5 text-[10px] font-bold text-white">{r.unread.toLocaleString('fa-IR')}</span> : <span className="text-[10px] text-ink-muted">{time(r.updatedAt)}</span>}
                </div>
                <div className="truncate text-xs text-ink-muted">{r.lastFrom === 'owner' ? 'شما: ' : ''}{r.lastMessage}</div>
                <div className="text-[10px] text-ink-muted">{r.site.name}{r.status === 'closed' ? ' · بسته' : ''}</div>
              </button>
            );
          })}
        </div>
        {cur ? <ChatPane key={`${cur.slug}:${cur.id}`} slug={cur.slug} id={cur.id} onBack={() => setCur(null)} /> : (
          <div className="hidden items-center justify-center rounded-xl border border-dashed border-line text-ink-muted md:flex">یک گفت‌وگو را انتخاب کنید</div>
        )}
      </div>
      <p className="mt-2 text-[11px] text-ink-muted">همین پیام‌ها در پنلِ خودِ سایت و (اگر «تلگرام» روشن باشد) در تلگرامِ شما هم هست؛ جواب از هر کدام درجا به بازدیدکننده می‌رسد.</p>
    </Modal>
  );
}

function ChatPane({ slug, id, onBack }: { slug: string; id: string; onBack: () => void }) {
  const url = `/api/site-chats/${encodeURIComponent(slug)}/${encodeURIComponent(id)}`;
  const conv = usePoll(() => api<{ chat: Chat; messages: Msg[] }>(url), 4000, [url]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const count = conv.data?.messages.length || 0;
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [count]);

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const r = await api<{ message: Msg }>(url, { method: 'POST', body: { text: t } });
      setText('');
      conv.setData((d) => (d ? { ...d, messages: [...d.messages, r.message] } : d));
    } catch (e: any) { toast(e?.message || 'نرسید', 'bad'); } finally { setBusy(false); }
  };
  const c = conv.data?.chat;
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-line">
      <div className="flex items-center gap-2 border-b border-line p-2.5">
        <button className="btn btn-sm md:hidden" onClick={onBack}>بازگشت</button>
        <div className="min-w-0">
          <b className="block truncate">{c?.name || '…'}</b>
          <span className="block truncate text-[11px] text-ink-muted" dir="auto">{[c?.contact, c?.page].filter(Boolean).join(' · ')}</span>
        </div>
      </div>
      <div ref={log} className="max-h-[50vh] min-h-[240px] flex-1 space-y-2 overflow-y-auto p-3">
        {conv.error ? <p className="text-state-bad">{conv.error}</p> : null}
        {(conv.data?.messages || []).map((m) => (
          <div key={m.id} className={`flex ${m.from === 'owner' ? 'justify-start' : 'justify-end'}`}>
            <div className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 ${m.from === 'owner' ? 'bg-accent text-white' : 'bg-surface-sunken'}`}>
              {m.body}
              <div className="mt-0.5 text-[10px] opacity-70">{time(m.at)}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2 border-t border-line p-2">
        <textarea className="input min-h-[42px] min-w-0 flex-1 resize-none" rows={1} maxLength={2000} placeholder="جواب… (Enter می‌فرستد، Shift+Enter خطِ تازه)"
          value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button className="btn btn-primary" onClick={send} disabled={busy || !text.trim()} aria-label="فرستادن"><Send className="h-4 w-4" /></button>
      </div>
    </div>
  );
}
