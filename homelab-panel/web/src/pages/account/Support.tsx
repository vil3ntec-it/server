// ---------------------------------------------------------------------------
//  💬 پشتیبانی — چت‌رومِ مدیر، به شکلِ چت‌رومِ برنامهٔ پمپ (۱۴۰۵/۰۷/۱۴)
//
//  خواستهٔ صاحب سامانه: «پشتیبانیِ سرور رو مثلِ پشتیبانی یا چتِ پمپ‌بنزین کن،
//  شبیه همون بشه.» چت‌رومِ برنامهٔ پمپ سه ستون است (‎ChatSectionView‎):
//
//      فهرستِ گفت‌وگوها  ·  خودِ گفت‌وگو  ·  مشخصاتِ همان کسی که پیام داده
//
//  همان سه ستون این‌جا هم هست، با همان ترتیب و همان چیزها: آواتارِ حرفی،
//  شمارهٔ نخوانده، جست‌وجو، حباب‌های «من / او»، کادرِ نوشتن با Enter، و
//  کارتِ طرف با بخش، حساب، دکان یا پمپ، و لینک به همان پرونده.
//
//  ⛔ **هیچ منطقی این‌جا نیست** — همان چهار مسیرِ پلِ ‎account-admin‎:
//     فهرست، یک گفت‌وگو، فرستادن، وضعیت (+ پیامِ همگانی). دفترِ دومی ساخته
//     نشد و هیچ پیامی روی این کامپیوتر نمی‌ماند: همان قاعدهٔ همیشگی.
//  ⛔ **پشتیبانی هیچ‌وقت پشتِ اشتراک نمی‌رود.** کسی که اشتراکش تمام شده
//     بیشتر از همه لازم دارد بپرسد چرا.
//  📎 **رسانه (عکس/ویدیو/پیامِ صوتی) — فقط در گفت‌وگوی پمپ** (۱۴۰۵/۰۷/۱۵):
//     سرورِ حساب فقط رله است و رسانه را پس از رسیدن به گیرنده پاک می‌کند؛
//     نسخهٔ مدیر روی دیسکِ همین کامپیوتر است (‎support-media-cache.js‎).
//     برنامهٔ دکان رسانه را نشان نمی‌دهد، پس در گفت‌وگوی دکان دکمه‌اش نیست.
//  ⚠️ زنده است: فهرست و خودِ گفت‌وگو هر دو موضوعِ ‎support‎ را می‌شنوند، پس
//     پیامِ تازهٔ مشتری همان لحظه می‌نشیند — بی نبضِ کور.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Mic, MessagesSquare, Paperclip, Search, Send, Square } from 'lucide-react';

import { api, getToken } from '../../api';
import { Badge, ConfirmDialog, Modal, Skeleton, toast } from '../../components/ui';
import { ActionButton, Notice as InlineNotice, Select } from '../../control/ui';
import { APP_LABEL, AppPicker, CloudProblem, day, fa, moment, useLoad, type Scope } from './shared';
import type { Message, Thread } from './types';

const THREAD_STATUS: Record<string, string> = {
  open: 'باز', pending: 'منتظرِ مشتری', closed: 'بسته',
};

/*
 *  ── رسانه ─────────────────────────────────────────────────────────────
 *  همان سقفِ سرورِ حساب (۲۵ مگابایت) و همان سه نوع. پیش‌نمایشِ فهرست همان
 *  جمله‌ای است که سرورِ حساب در ‎lastMessage‎ می‌گذارد.
 */
const MAX_MEDIA = 25 * 1024 * 1024;
const MEDIA_KINDS = ['image', 'video', 'audio'] as const;
type MediaKind = (typeof MEDIA_KINDS)[number];
const MEDIA_LABEL: Record<MediaKind, string> = { image: '📷 عکس', video: '🎥 ویدیو', audio: '🎤 پیامِ صوتی' };

function kindOfMime(mime: string): MediaKind | null {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  return null;
}

/** نشانیِ رسانه روی خودِ پنل — ‎?token=‎ چون ‎<img>‎ سرآیندِ Authorization ندارد. */
function mediaUrl(mid: string) {
  return `/api/account-admin/support/media/${encodeURIComponent(mid)}?token=${encodeURIComponent(getToken() || '')}`;
}

/** رسانهٔ داخلِ حباب. نشد (گذشته از ۱۵ روز یا جای دیگری گرفته شد) ⇒ یک جملهٔ راست. */
function MediaView({ kind, mid }: { kind: MediaKind; mid: string }) {
  const [broken, setBroken] = useState(false);
  const url = mediaUrl(mid);
  if (broken) {
    return <p className="text-[12px] opacity-80">{MEDIA_LABEL[kind]} · رسانه دیگر در دسترس نیست</p>;
  }
  if (kind === 'image') {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block">
        <img src={url} alt="عکس" loading="lazy" onError={() => setBroken(true)}
          className="max-h-72 max-w-full rounded-xl object-contain" style={{ background: 'rgba(0,0,0,.06)' }} />
      </a>
    );
  }
  if (kind === 'video') {
    return <video src={url} controls preload="metadata" onError={() => setBroken(true)} className="max-h-72 max-w-full rounded-xl" />;
  }
  return <audio src={url} controls preload="metadata" onError={() => setBroken(true)} className="w-64 max-w-full" />;
}

/** رنگِ آواتار از روی نام — همان قاعدهٔ ‎AvatarKey‎ی برنامهٔ پمپ: یک نام، همیشه یک رنگ. */
const AVATAR = ['#0f6f83', '#7c4dbe', '#c2410c', '#15803d', '#b91c1c', '#1d4ed8'];
function avatarOf(th: Pick<Thread, 'who' | 'id'>) {
  const s = th.who || th.id || '?';
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { letter: (th.who || '؟').trim().charAt(0) || '؟', color: AVATAR[h % AVATAR.length] };
}

/** نامِ خواندنیِ طرف: دکان، پمپ، یا صاحبِ حساب. */
function partyOf(th: Thread) {
  return th.shopName || th.stationName || th.accountName || '';
}

export default function Support() {
  const [app, setApp] = useState<Scope>('both');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [current, setCurrent] = useState<string>('');
  const [broadcast, setBroadcast] = useState(false);

  const qs = new URLSearchParams();
  if (app !== 'both') qs.set('app', app);
  if (status) qs.set('status', status);
  qs.set('limit', '200');
  const list = useLoad<{ threads: Thread[]; unread: number }>(`/api/account-admin/support/threads?${qs}`, [app, status], 'support');

  //  جست‌وجو روی همان فهرستِ آمده — نام، دکان/پمپ، آخرین پیام
  const threads = useMemo(() => {
    const all = list.data?.threads || [];
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((th) =>
      [th.who, partyOf(th), th.lastMessage, th.subject].some((s) => (s || '').toLowerCase().includes(needle)));
  }, [list.data, q]);

  const selected = threads.find((t) => t.id === current) || (list.data?.threads || []).find((t) => t.id === current) || null;
  const unread = list.data?.unread || 0;

  return (
    <div className="mx-auto flex h-[calc(100vh-6.5rem)] min-h-[560px] max-w-[1400px] flex-col">
      <header className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-ink">پشتیبانی</h1>
          <p className="mt-0.5 text-xs text-ink-muted">
            گفت‌وگوهای دکان و پمپ، مثلِ چت‌رومِ برنامهٔ پمپ
            {unread ? <> · <span className="font-semibold text-ink">{fa(unread)} نخوانده</span></> : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AppPicker value={app} onChange={setApp} withBoth />
          <div className="w-32">
            <Select
              value={status}
              onChange={setStatus}
              placeholder="هر حالی"
              options={Object.entries(THREAD_STATUS).map(([v, label]) => ({ value: v, label }))}
            />
          </div>
          <button className="btn btn-sm" onClick={() => setBroadcast(true)}>پیامِ همگانی</button>
        </div>
      </header>

      {list.error && <div className="mb-3"><CloudProblem code={list.code} message={list.error} onRetry={list.reload} /></div>}

      <div className="grid min-h-0 flex-1 gap-3" style={{ gridTemplateColumns: 'minmax(250px,310px) minmax(0,1fr) minmax(240px,320px)' }}>
        {/* ══ ۱) فهرستِ گفت‌وگوها ═══════════════════════════════════════════ */}
        <section className="card flex min-h-0 flex-col overflow-hidden p-0" data-chat="list">
          <div className="border-b border-line p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
              <input
                className="input w-full pr-8 text-sm"
                dir="rtl"
                placeholder="جست‌وجوی نام، دکان، پمپ…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {list.busy && !list.data ? (
              <div className="p-3"><Skeleton rows={6} /></div>
            ) : threads.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-ink-muted">
                <MessagesSquare className="h-6 w-6" />
                <p className="text-sm">گفت‌وگویی نیست</p>
              </div>
            ) : (
              threads.map((th) => {
                const av = avatarOf(th);
                const active = th.id === current;
                return (
                  <button
                    key={th.id}
                    type="button"
                    onClick={() => setCurrent(th.id)}
                    className={`flex w-full items-center gap-3 border-b border-line px-3 py-2.5 text-right transition ${active ? '' : 'hover:bg-surface-raised'}`}
                    style={active ? { background: 'var(--accent-soft)' } : undefined}
                    data-thread={th.id}
                  >
                    <span
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg font-extrabold text-white"
                      style={{ background: av.color }}
                    >
                      {av.letter}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-bold text-ink">{th.who || '—'}</span>
                        <Badge tone={th.app === 'pump' ? 'info' : 'neutral'}>{APP_LABEL[th.app as 'shop' | 'pump'] || th.app}</Badge>
                      </span>
                      <span className="block truncate text-[11.5px] text-ink-muted">
                        {th.lastMessage ? `${th.lastSender === 'admin' ? 'شما: ' : ''}${th.lastMessage}` : partyOf(th) || '—'}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-center gap-1">
                      <span className="text-[10.5px] text-ink-muted">{moment(th.updatedAt)}</span>
                      {th.unreadAdmin ? (
                        <span className="min-w-[22px] rounded-full bg-red-600 px-1.5 text-center text-[11px] font-extrabold text-white">{fa(th.unreadAdmin)}</span>
                      ) : th.status !== 'open' ? (
                        <span className="text-[10px] text-ink-muted">{THREAD_STATUS[th.status] || th.status}</span>
                      ) : null}
                    </span>
                  </button>
                );
              })
            )}
          </div>
          <p className="border-t border-line px-3 py-2 text-[10.5px] text-ink-muted">
            پیام‌ها ۱۵ روز روی سرورِ حساب؛ رسانه فقط تا رسیدن به طرفِ دیگر.
          </p>
        </section>

        {/* ══ ۲) خودِ گفت‌وگو ══════════════════════════════════════════════ */}
        <section className="card flex min-h-0 flex-col overflow-hidden p-0" data-chat="conversation">
          {selected ? (
            <Conversation key={selected.id} thread={selected} onChanged={list.reload} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-ink-muted">
              <span className="text-5xl">💬</span>
              <p className="max-w-[420px] text-sm">
                یک گفت‌وگو را از فهرست انتخاب کنید. پیامِ تازهٔ مشتری همان لحظه این‌جا می‌نشیند.
              </p>
            </div>
          )}
        </section>

        {/* ══ ۳) مشخصاتِ همان کسی که پیام داده ═════════════════════════════ */}
        <section className="card min-h-0 overflow-y-auto p-0" data-chat="party">
          {selected ? <PartyCard thread={selected} /> : (
            <div className="p-5 text-center text-xs text-ink-muted">مشخصاتِ طرفِ گفت‌وگو این‌جا می‌آید.</div>
          )}
        </section>
      </div>

      {broadcast && <Broadcast onClose={() => setBroadcast(false)} />}
    </div>
  );
}

function Conversation({ thread, onChanged }: { thread: Thread; onChanged: () => Promise<void> }) {
  const [text, setText] = useState('');
  const [close, setClose] = useState(false);
  const [sendingMedia, setSendingMedia] = useState(false);
  const [recording, setRecording] = useState<{ started: number } | null>(null);
  const [recSeconds, setRecSeconds] = useState(0);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  //  رسانه فقط در گفت‌وگوی پمپ: برنامهٔ دکان نشانش نمی‌دهد و سرورِ حساب هم ردش می‌کند
  const mediaOk = thread.app === 'pump';
  //  ضبط در یک رندر شروع و در رندرِ دیگری تمام می‌شود — نوشتهٔ کادر از همین ref
  const textRef = useRef(text);
  textRef.current = text;
  //  ⚠️ خودِ گفت‌وگو هم زنده است: پیامِ تازهٔ مشتری وسطِ باز بودن می‌نشیند
  const conv = useLoad<{ thread: Thread; messages: Message[] }>(`/api/account-admin/support/threads/${thread.id}?after=0`, [thread.id], 'support');
  const bottom = useRef<HTMLDivElement | null>(null);
  const av = avatarOf(thread);
  const live = conv.data?.thread || thread;

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [conv.data]);
  //  باز شدنِ گفت‌وگو، مدیر دیدش ⇒ شمارهٔ نخواندهٔ فهرست هم تازه شود
  useEffect(() => { if (conv.data) void onChanged(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [conv.data?.thread?.unreadAdmin]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    try {
      await api(`/api/account-admin/support/threads/${thread.id}/messages`, { body: { body } });
      setText('');
      await conv.reload();
      await onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'نشد', 'bad');
    }
  }

  /** بارگذاریِ خام، بعد پیامی با همان ‎mediaId‎ — و نوشتهٔ کادر به‌عنوانِ توضیح. */
  async function sendMedia(blob: Blob, mime: string) {
    const kind = kindOfMime(mime);
    if (!kind) { toast('فقط عکس، ویدیو و صدا', 'bad'); return; }
    if (blob.size > MAX_MEDIA) { toast('فایل بزرگ‌تر از ۲۵ مگابایت است', 'bad'); return; }
    if (!blob.size) { toast('فایل خالی است', 'bad'); return; }
    setSendingMedia(true);
    try {
      const up = await api<{ mediaId: string }>(`/api/account-admin/support/threads/${thread.id}/media`, {
        method: 'POST', raw: blob, contentType: mime,
      });
      await api(`/api/account-admin/support/threads/${thread.id}/messages`, {
        body: { kind, mediaId: up.mediaId, body: textRef.current.trim() },
      });
      setText('');
      await conv.reload();
      await onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'نشد', 'bad');
    } finally {
      setSendingMedia(false);
    }
  }

  async function pickFile(file: File | undefined) {
    if (fileInput.current) fileInput.current.value = '';
    if (file) await sendMedia(file, file.type || '');
  }

  /*
   *  پیامِ صوتی — ‎MediaRecorder‎ی خودِ مرورگر؛ هیچ کتابخانه‌ای. ضبط با دکمهٔ
   *  دوم تمام و همان لحظه فرستاده می‌شود. میکروفون هم همان لحظه آزاد می‌شود.
   */
  async function toggleRecord() {
    if (recorder.current) { recorder.current.stop(); return; }
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      toast('این مرورگر ضبطِ صدا ندارد', 'bad');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast('اجازهٔ میکروفون داده نشد', 'bad');
      return;
    }
    const type = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4']
      .find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
    const rec = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream);
    const chunks: BlobPart[] = [];
    rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      recorder.current = null;
      setRecording(null);
      const mime = (rec.mimeType || type || 'audio/webm').split(';')[0];
      const blob = new Blob(chunks, { type: mime });
      if (blob.size) void sendMedia(blob, mime);
    };
    recorder.current = rec;
    rec.start();
    setRecSeconds(0);
    setRecording({ started: Date.now() });
  }

  //  شمارندهٔ ضبط — فقط تا وقتی ضبط روشن است
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setRecSeconds(Math.floor((Date.now() - recording.started) / 1000)), 500);
    return () => clearInterval(t);
  }, [recording]);
  //  رفتن از گفت‌وگو وسطِ ضبط ⇒ میکروفون آزاد، چیزی فرستاده نمی‌شود
  useEffect(() => () => {
    const r = recorder.current;
    if (r) { r.onstop = () => r.stream.getTracks().forEach((t) => t.stop()); r.stop(); }
  }, []);

  async function setStatus(status: 'open' | 'pending' | 'closed') {
    try {
      await api(`/api/account-admin/support/threads/${thread.id}/status`, { body: { status } });
      toast(status === 'closed' ? 'بسته شد' : status === 'pending' ? 'منتظرِ مشتری' : 'باز شد');
      await conv.reload();
      await onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'نشد', 'bad');
    }
  }

  return (
    <>
      <header className="flex items-center gap-3 border-b border-line px-4 py-2.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-extrabold text-white" style={{ background: av.color }}>
          {av.letter}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-extrabold text-ink">{live.who || '—'}</p>
          <p className="truncate text-[11.5px] text-ink-muted">
            {APP_LABEL[live.app as 'shop' | 'pump'] || live.app}
            {partyOf(live) ? ` · ${partyOf(live)}` : ''}
            {' · '}
            {THREAD_STATUS[live.status] || live.status}
          </p>
        </div>
        {live.status === 'closed' ? (
          <button className="btn btn-sm" onClick={() => setStatus('open')}>باز کردنِ دوباره</button>
        ) : (
          <>
            {live.status !== 'pending' && (
              <button className="btn btn-sm" onClick={() => setStatus('pending')} title="جواب داده شد؛ منتظرِ مشتری">منتظرِ مشتری</button>
            )}
            <button className="btn btn-sm" onClick={() => setClose(true)}>بستنِ گفت‌وگو</button>
          </>
        )}
      </header>

      {conv.error && <div className="p-3"><CloudProblem code={conv.code} message={conv.error} onRetry={conv.reload} /></div>}

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-3" dir="rtl">
        {conv.busy && !conv.data ? <Skeleton rows={5} /> : (conv.data?.messages || []).length === 0 ? (
          <p className="m-auto text-sm text-ink-muted">هنوز پیامی نیست.</p>
        ) : (
          (conv.data?.messages || []).map((m) => {
            const mine = m.sender === 'admin';
            return (
              <div
                key={m.id}
                className={`max-w-[78%] rounded-2xl px-3 py-2 text-[13.5px] ${mine ? 'self-start' : 'self-end'}`}
                style={{
                  background: mine ? 'var(--accent)' : 'var(--surface-2)',
                  color: mine ? 'var(--accent-ink)' : 'var(--text-primary)',
                }}
                data-sender={m.sender}
              >
                {!mine && <p className="mb-0.5 text-[11.5px] font-extrabold opacity-80">{m.senderName || live.who || m.sender}</p>}
                {m.mediaId && (MEDIA_KINDS as readonly string[]).includes(m.kind) && (
                  <div className="mb-1" data-media={m.kind}><MediaView kind={m.kind as MediaKind} mid={m.mediaId} /></div>
                )}
                {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                <p className="mt-1 text-[10px] opacity-70">{moment(m.createdAt)}{m.kind === 'notice' ? ' · اعلان' : ''}</p>
              </div>
            );
          })
        )}
        <div ref={bottom} />
      </div>

      <footer className="flex items-end gap-2 border-t border-line px-3 py-2.5">
        {mediaOk && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept="image/*,video/*,audio/*"
              className="hidden"
              onChange={(e) => void pickFile(e.target.files?.[0])}
            />
            <button
              type="button"
              className="btn min-h-[44px] px-3"
              title="فرستادنِ عکس، ویدیو یا صدا (تا ۲۵ مگابایت)"
              disabled={sendingMedia || !!recording}
              onClick={() => fileInput.current?.click()}
              data-action="attach"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={`btn min-h-[44px] px-3 ${recording ? 'btn-danger' : ''}`}
              title={recording ? 'پایان و فرستادن' : 'ضبطِ پیامِ صوتی'}
              disabled={sendingMedia}
              onClick={() => void toggleRecord()}
              data-action="record"
            >
              {recording ? <><Square className="h-4 w-4" /> <span className="tnum text-xs">{fa(recSeconds)}ث</span></> : <Mic className="h-4 w-4" />}
            </button>
          </>
        )}
        <textarea
          className="input max-h-40 min-h-[44px] flex-1 resize-y"
          dir="rtl"
          rows={1}
          placeholder="پیام‌تان را بنویسید… (Enter می‌فرستد، Shift+Enter خطِ تازه)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
          }}
        />
        <ActionButton className="btn btn-primary min-h-[44px]" busyLabel="…" disabled={!text.trim() || sendingMedia} onClick={send}>
          <Send className="h-3.5 w-3.5" /> فرستادن
        </ActionButton>
      </footer>

      <ConfirmDialog
        open={close}
        title="بستنِ گفت‌وگو"
        message="گفت‌وگو بسته می‌شود و از فهرستِ «باز» بیرون می‌رود. مشتری هر وقت بخواهد دوباره پیام می‌دهد و همین گفت‌وگو باز می‌شود؛ هیچ پیامی پاک نمی‌شود."
        onCancel={() => setClose(false)}
        onConfirm={async () => { setClose(false); await setStatus('closed'); }}
      />
    </>
  );
}

/** ستونِ سوم — همان «مشخصاتِ همان کسی که پیام داده»ی برنامهٔ پمپ. */
function PartyCard({ thread: th }: { thread: Thread }) {
  const av = avatarOf(th);
  const app = th.app as 'shop' | 'pump';
  const party = partyOf(th);
  //  لینک به همان پرونده: پمپ ⇒ پمپ‌بنزین‌ها با جست‌وجوی نامش؛ دکان ⇒ میزِ فروشگاه
  const file = app === 'pump'
    ? { to: `/stations?q=${encodeURIComponent(th.stationName || th.who || '')}`, label: 'پروندهٔ پمپ' }
    : { to: `/shop?q=${encodeURIComponent(th.shopName || th.who || '')}`, label: 'میزِ فروشگاه' };
  const subs = `/subscriptions?app=${app}&q=${encodeURIComponent(th.accountEmail || th.who || '')}`;

  return (
    <div className="flex flex-col gap-4 p-4" dir="rtl">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full text-2xl font-extrabold text-white" style={{ background: av.color }}>
          {av.letter}
        </span>
        <p className="text-base font-extrabold text-ink">{th.who || '—'}</p>
        <Badge tone={app === 'pump' ? 'info' : 'neutral'}>{APP_LABEL[app] || th.app}</Badge>
      </div>

      <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-2 text-[12.5px]">
        {party && <><dt className="text-ink-muted">{app === 'pump' ? 'پمپ' : 'دکان'}</dt><dd className="font-medium text-ink">{party}</dd></>}
        {th.accountName && <><dt className="text-ink-muted">حساب</dt><dd className="text-ink">{th.accountName}</dd></>}
        {th.accountEmail && <><dt className="text-ink-muted">ایمیل</dt><dd className="break-all text-ink" dir="ltr">{th.accountEmail}</dd></>}
        {th.contact && <><dt className="text-ink-muted">تماس</dt><dd className="text-ink" dir="ltr">{th.contact}</dd></>}
        {th.subject && <><dt className="text-ink-muted">موضوع</dt><dd className="text-ink">{th.subject}</dd></>}
        <dt className="text-ink-muted">حال</dt><dd><Badge tone={th.status === 'open' ? 'good' : 'neutral'}>{THREAD_STATUS[th.status] || th.status}</Badge></dd>
        <dt className="text-ink-muted">نخوانده</dt><dd className="tnum text-ink">{fa(th.unreadAdmin || 0)}</dd>
        <dt className="text-ink-muted">شروع</dt><dd className="text-ink">{day(th.createdAt)}</dd>
        <dt className="text-ink-muted">آخرین پیام</dt><dd className="text-ink">{moment(th.updatedAt)}</dd>
        {th.deviceUid && <><dt className="text-ink-muted">دستگاه</dt><dd className="break-all text-[11px] text-ink-muted" dir="ltr">{th.deviceUid}</dd></>}
      </dl>

      <div className="flex flex-col gap-2">
        <Link className="btn btn-sm justify-center" to={file.to}>📒 {file.label}</Link>
        <Link className="btn btn-sm justify-center" to={subs}>💳 اشتراکِ همین حساب</Link>
      </div>

      <InlineNotice tone="info">
        پشتیبانی همیشه باز است و به اشتراک ربطی ندارد.
        {app === 'pump'
          ? ' عکس، ویدیو و پیامِ صوتی روی سرورِ حساب نمی‌مانند: همین که به طرفِ دیگر رسیدند آن‌جا پاک می‌شوند و نسخهٔ شما ۱۵ روز روی همین کامپیوتر است.'
          : ' رسانه فقط در گفت‌وگوی پمپ است؛ برنامهٔ دکان نشانش نمی‌دهد.'}
      </InlineNotice>
    </div>
  );
}

function Broadcast({ onClose }: { onClose: () => void }) {
  const [app, setApp] = useState<Scope>('both');
  const [body, setBody] = useState('');

  return (
    <Modal
      open
      onClose={onClose}
      title="پیامِ همگانی"
      footer={
        <>
          <button className="btn" onClick={onClose}>انصراف</button>
          <ActionButton
            className="btn btn-primary"
            busyLabel="…"
            disabled={!body.trim()}
            onClick={async () => {
              try {
                const out = await api<{ sent: number; failed?: number }>('/api/account-admin/support/broadcast', {
                  body: { body, target: 'all', app },
                });
                toast(`به ${fa(out.sent)} گفت‌وگو رفت${out.failed ? ` · ناموفق: ${fa(out.failed)}` : ''}`);
                onClose();
              } catch (e) {
                toast(e instanceof Error ? e.message : 'نشد', 'bad');
              }
            }}
          >
            فرستادن
          </ActionButton>
        </>
      }
    >
      <InlineNotice tone="warn">
        این پیام در گفت‌وگوی پشتیبانیِ **هر** مشتریِ بخشِ انتخاب‌شده می‌نشیند. برای خبرِ فروشی و تخفیف،
        «مرکز اعلان» جای درست‌تری است: آن‌جا گزارشِ تحویل به تفکیکِ هر گیرنده دارید.
      </InlineNotice>
      <label className="label">بخش</label>
      <div className="mb-3"><AppPicker value={app} onChange={setApp} withBoth /></div>
      <label className="label">متن</label>
      <textarea className="input h-28 w-full" dir="rtl" value={body} onChange={(e) => setBody(e.target.value)} />
    </Modal>
  );
}
