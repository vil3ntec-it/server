// ---------------------------------------------------------------------------
//  💬 پشتیبانی — بندِ ۱۲
//
//  صندوقِ همهٔ گفت‌وگوهای دکان و پمپ در یک جا، با جوابِ مستقیم و پیامِ
//  همگانی.
//
//  ⛔ **پشتیبانی هیچ‌وقت پشتِ اشتراک نمی‌رود.** کسی که اشتراکش تمام شده
//     بیشتر از همه لازم دارد بپرسد چرا.
//  ⚠️ **پیوست (عکس/ویدیو/صدا) از این‌جا نمی‌رود و دیده نمی‌شود** — و این
//     کم‌کاریِ صفحه نیست: مسیرِ مدیریتیِ پشتیبانیِ سرورِ حساب فقط متن دارد
//     (`support_messages.kind` تنها `text` و `notice` می‌شود). چتِ
//     رسانه‌دار مالِ گفت‌وگوی مشتریِ کیو‌آر با صاحبِ پمپ است و دفترِ
//     جداگانه‌ای دارد. دکمه‌ای که بخورد به «این‌جا نمی‌شود» از نبودنش بدتر
//     است، پس ساخته نشده.
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState } from 'react';
import { MessagesSquare, Send } from 'lucide-react';

import { api } from '../../api';
import { Badge, Card, ConfirmDialog, Empty, Modal, Skeleton, toast } from '../../components/ui';
import { ActionButton, Cell, Notice as InlineNotice, Row, Select, Table } from '../../control/ui';
import { APP_LABEL, AppPicker, CloudProblem, PageHead, fa, moment, useLoad, type Scope } from './shared';
import type { Message, Thread } from './types';

const THREAD_STATUS: Record<string, string> = {
  open: 'باز', pending: 'منتظرِ مشتری', closed: 'بسته',
};

export default function Support() {
  const [app, setApp] = useState<Scope>('both');
  const [status, setStatus] = useState('');
  const [openThread, setOpenThread] = useState<Thread | null>(null);
  const [broadcast, setBroadcast] = useState(false);

  const qs = new URLSearchParams();
  if (app !== 'both') qs.set('app', app);
  if (status) qs.set('status', status);
  qs.set('limit', '200');
  const list = useLoad<{ threads: Thread[]; unread: number }>(`/api/account-admin/support/threads?${qs}`, [app, status]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHead
        title="پشتیبانی"
        sub="گفت‌وگوهای دکان و پمپ، در یک صندوق"
        actions={
          <>
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
          </>
        }
      />

      {list.error && <CloudProblem code={list.code} message={list.error} />}

      <InlineNotice tone="info">
        پشتیبانی همیشه باز است و به اشتراک ربطی ندارد. پیوست (عکس و ویدیو و صدا) از این صندوق نمی‌گذرد؛
        مسیرِ مدیریتیِ سرورِ حساب فقط متن دارد.
      </InlineNotice>

      <Card>
        {list.busy && !list.data ? (
          <Skeleton rows={5} />
        ) : (list.data?.threads.length || 0) === 0 ? (
          <Empty icon={<MessagesSquare className="h-6 w-6" />} title="گفت‌وگویی نیست" />
        ) : (
          <Table head={['طرفِ گفت‌وگو', 'بخش', 'آخرین پیام', 'نخوانده', 'حال', 'به‌روزرسانی', '']}>
            {(list.data?.threads || []).map((th) => (
              <Row key={th.id} onClick={() => setOpenThread(th)}>
                <Cell>
                  <p className="font-medium text-ink">{th.who || '—'}</p>
                  <p className="text-[11px] text-ink-muted">{th.shopName || th.stationName || th.accountName || ''}</p>
                </Cell>
                <Cell><Badge tone={th.app === 'pump' ? 'info' : 'neutral'}>{APP_LABEL[th.app as 'shop' | 'pump'] || th.app}</Badge></Cell>
                <Cell className="max-w-[16rem] truncate">{th.lastMessage || '—'}</Cell>
                <Cell className="tnum">{th.unreadAdmin ? <Badge tone="warn">{fa(th.unreadAdmin)}</Badge> : '—'}</Cell>
                <Cell><Badge tone={th.status === 'open' ? 'good' : 'neutral'}>{THREAD_STATUS[th.status] || th.status}</Badge></Cell>
                <Cell>{moment(th.updatedAt)}</Cell>
                <Cell><button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); setOpenThread(th); }}>باز کن</button></Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>

      {openThread && <ThreadView thread={openThread} onClose={() => setOpenThread(null)} onChanged={list.reload} />}
      {broadcast && <Broadcast onClose={() => setBroadcast(false)} />}
    </div>
  );
}

function ThreadView({ thread, onClose, onChanged }: { thread: Thread; onClose: () => void; onChanged: () => Promise<void> }) {
  const [text, setText] = useState('');
  const [close, setClose] = useState(false);
  const conv = useLoad<{ thread: Thread; messages: Message[] }>(`/api/account-admin/support/threads/${thread.id}?after=0`);
  const bottom = useRef<HTMLDivElement | null>(null);

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [conv.data]);

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={`${thread.who || '—'} · ${APP_LABEL[thread.app as 'shop' | 'pump'] || thread.app}`}
      footer={
        <>
          <button className="btn" onClick={() => setClose(true)}>بستنِ گفت‌وگو</button>
          <ActionButton
            className="btn btn-primary"
            busyLabel="…"
            disabled={!text.trim()}
            onClick={async () => {
              try {
                await api(`/api/account-admin/support/threads/${thread.id}/messages`, { body: { body: text } });
                setText('');
                await conv.reload();
                await onChanged();
              } catch (e) {
                toast(e instanceof Error ? e.message : 'نشد', 'bad');
              }
            }}
          >
            <Send className="h-3.5 w-3.5" /> فرستادن
          </ActionButton>
        </>
      }
    >
      {conv.busy && !conv.data ? <Skeleton rows={5} /> : (
        <div className="mb-3 flex max-h-[45vh] flex-col gap-2 overflow-y-auto" dir="rtl">
          {(conv.data?.messages || []).map((m) => (
            <div
              key={m.id}
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.sender === 'admin' ? 'self-start' : 'self-end'}`}
              style={{
                background: m.sender === 'admin' ? 'var(--accent)' : 'var(--surface-2)',
                color: m.sender === 'admin' ? 'var(--accent-ink)' : 'var(--text-primary)',
              }}
            >
              <p className="whitespace-pre-wrap">{m.body}</p>
              <p className="mt-1 text-[10px] opacity-70">{m.senderName || m.sender} · {moment(m.createdAt)}</p>
            </div>
          ))}
          <div ref={bottom} />
        </div>
      )}
      <textarea
        className="input h-20 w-full"
        dir="rtl"
        placeholder="جوابِ شما…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      <ConfirmDialog
        open={close}
        title="بستنِ گفت‌وگو"
        message="گفت‌وگو بسته می‌شود و از فهرستِ «باز» بیرون می‌رود. مشتری هر وقت بخواهد دوباره پیام می‌دهد و همین گفت‌وگو باز می‌شود؛ هیچ پیامی پاک نمی‌شود."
        onCancel={() => setClose(false)}
        onConfirm={async () => {
          setClose(false);
          try {
            await api(`/api/account-admin/support/threads/${thread.id}/status`, { body: { status: 'closed' } });
            toast('بسته شد');
            onClose();
            await onChanged();
          } catch (e) {
            toast(e instanceof Error ? e.message : 'نشد', 'bad');
          }
        }}
      />
    </Modal>
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
