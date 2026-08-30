import { useCallback, useEffect, useState } from 'react';
import {
  Anchor,
  Bell,
  Database,
  Eye,
  EyeOff,
  FolderTree,
  Globe,
  Info,
  Link2,
  Plug,
  Power,
  PowerOff,
  RefreshCw,
  RotateCw,
  TriangleAlert,
  MessageCircle,
  Wrench,
} from 'lucide-react';
import { useApp } from '../app-context';
import { api, ApiError } from '../api';
import type { SiteServerInfo } from '../types';
import { Badge, Card, ConfirmDialog, CopyButton, Empty, Loading, Spinner, toast } from '../components/ui';
import { bytes, dateTime, ltr } from '../format';

/* ---------------------------------------------------------------------------
   «سرور سایت» — سرور برنامهٔ پمپ یعقوبی روی همین پنل و همین پورت اجرا می‌شود.
   آدرس و رمزی که سایت لازم دارد، اینجا پیدا می‌شود.
--------------------------------------------------------------------------- */
export default function SiteServer() {
  const { t, lang } = useApp();
  const [info, setInfo] = useState<SiteServerInfo | { enabled: false } | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [rotateOpen, setRotateOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setInfo(await api<SiteServerInfo>('/api/site-server'));
    } catch {
      setInfo({ enabled: false });
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 8000);
    return () => clearInterval(timer);
  }, [load]);

  if (!info) return <Loading />;
  if (!info.enabled) {
    return (
      <Card>
        <Empty icon={<Plug className="h-8 w-8" />} title={t('notSupported')} />
      </Card>
    );
  }

  const data = info as SiteServerInfo;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-base font-semibold">{t('siteServerTitle')}</h1>
          <p className="mt-1 max-w-2xl text-xs text-ink-muted">{t('siteServerIntro')}</p>
        </div>
        <button className="btn btn-sm" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" />
          {t('refresh')}
        </button>
      </div>

      {/* ------------------ اتصال از اینترنت: مهم‌ترین بخش صفحه ------------------ */}
      <InternetAccess data={data} onChanged={load} />

      {/* آدرس ثابت — تا سایت یک‌بار تنظیم شود و برای همیشه کار کند */}
      <PermanentAddress data={data} onChanged={load} />

      <Card
        title={t('serverAddress')}
        icon={<Link2 className="h-4 w-4" />}
        action={<Badge tone="info">{t('whereToPut')}</Badge>}
      >
        <ul className="space-y-2">
          {data.addresses.map((a) => (
            <li
              key={a.ws}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-3"
              style={{ background: 'var(--surface-0)' }}
            >
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-ink-muted">{a.label}</p>
                <p className="truncate font-mono text-sm" dir="ltr">
                  {a.ws}
                </p>
              </div>
              <CopyButton value={a.ws} />
              <a className="btn btn-sm" href={`${a.http}/health`} target="_blank" rel="noreferrer">
                /health
              </a>
            </li>
          ))}
        </ul>
      </Card>

      <Card title={t('serverToken')} icon={<Eye className="h-4 w-4" />}>
        <div className="flex flex-wrap items-center gap-2">
          <code
            className="min-w-0 flex-1 truncate rounded-xl border border-line px-3 py-2.5 font-mono text-sm"
            style={{ background: 'var(--surface-0)' }}
            dir="ltr"
          >
            {token ?? data.tokenPreview ?? '—'}
          </code>
          {token ? (
            <button className="btn btn-sm" onClick={() => setToken(null)}>
              <EyeOff className="h-3.5 w-3.5" />
              {t('hideToken')}
            </button>
          ) : (
            <button
              className="btn btn-sm"
              onClick={async () => {
                try {
                  const res = await api<{ token: string }>('/api/site-server/token');
                  setToken(res.token);
                } catch {
                  toast(t('error'), 'bad');
                }
              }}
            >
              <Eye className="h-3.5 w-3.5" />
              {t('showToken')}
            </button>
          )}
          {token && <CopyButton value={token} />}
          <button className="btn btn-sm" onClick={() => setRotateOpen(true)}>
            <RotateCw className="h-3.5 w-3.5" />
            {t('rotateToken')}
          </button>
        </div>
        <p className="mt-3 flex items-start gap-1.5 text-[11px] text-ink-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {t('rotateWarn')}
        </p>
        {data.dedicatedPort && (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-ink-muted">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t('dedicatedPortNote', { port: data.dedicatedPort })}
          </p>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label={t('liveConnections')} value={String(data.stats.liveConnections)} />
        <Stat label={t('dataBranches')} value={String(data.stats.branches)} />
        <Stat label={t('reads')} value={String(data.stats.reads)} />
        <Stat label={t('writes')} value={String(data.stats.writes)} />
      </div>

      <Card title={t('dataBranches')} icon={<Database className="h-4 w-4" />}>
        {!data.branches.length ? (
          <Empty title={t('noData')} />
        ) : (
          <ul className="divide-y divide-line">
            {data.branches.map((b) => (
              <li key={b.key} className="flex items-center justify-between gap-3 py-2">
                <span className="truncate font-mono text-sm">{b.key}</span>
                <span className="tnum shrink-0 text-xs text-ink-soft">
                  {ltr(`${b.children} · ${bytes(b.bytes)}`)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 truncate font-mono text-[11px] text-ink-muted" dir="ltr">
          {data.dataDir}
        </p>
      </Card>

      {/* پوشهٔ دادهٔ هر سایت — جدا از هم، تا هیچ‌چیز قاطی نشود */}
      {data.stores && data.stores.length > 1 && (
        <Card title={t('perSiteStores')} icon={<FolderTree className="h-4 w-4" />}>
          <p className="mb-3 text-[11px] leading-relaxed text-ink-muted">{t('perSiteStoresHint')}</p>
          <ul className="divide-y divide-line">
            {data.stores.map((s) => (
              <li key={s.key} className="flex flex-wrap items-center gap-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                    {s.main ? t('mainStore') : s.label}
                    {s.main && <Badge tone="info">{t('mainStore')}</Badge>}
                  </p>
                  <p className="truncate font-mono text-[11px] text-ink-muted" dir="ltr" title={s.dataDir}>
                    {s.dataDir}
                  </p>
                </div>
                <span className="tnum shrink-0 text-xs text-ink-soft">
                  {ltr(`${s.branches.length} · ${bytes(s.diskBytes)}`)}
                </span>
                {s.liveConnections > 0 && <Badge tone="good">{s.liveConnections}</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {data.stats.clients.length > 0 && (
        <Card title={t('liveConnections')} icon={<Plug className="h-4 w-4" />}>
          <ul className="divide-y divide-line">
            {data.stats.clients.map((c, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2 text-xs">
                <span className="font-mono" dir="ltr">
                  {c.remote}
                </span>
                <span className="text-ink-soft">{dateTime(c.since, lang)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <MessengerCard />

      <NotifyCard addresses={data.addresses} />

      <ConfirmDialog
        open={rotateOpen}
        danger
        title={t('rotateToken')}
        message={t('rotateWarn')}
        onCancel={() => setRotateOpen(false)}
        onConfirm={async () => {
          try {
            const res = await api<{ token: string }>('/api/site-server/rotate-token', { method: 'POST' });
            setToken(res.token);
            toast(t('saved'));
            load();
          } catch {
            toast(t('error'), 'bad');
          }
          setRotateOpen(false);
        }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------------
   پیام‌رسان — سرور خانگی پیامک نمی‌فرستد، پس کدِ ورودِ هر کس اینجا به صاحبِ
   سرور نشان داده می‌شود تا خودش به او بدهد.
--------------------------------------------------------------------------- */
type MessengerInfo = {
  codes: { phone: string; code: string; expiresAt: number; isNewUser: boolean }[];
  stats: { onlineUsers: number; connections: number; vapidPublicKey: string };
};

function MessengerCard() {
  const { t } = useApp();
  const [info, setInfo] = useState<MessengerInfo | null>(null);

  const load = useCallback(() => {
    api<MessengerInfo>('/api/site-server/messenger/codes')
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  if (!info) return null;

  return (
    <Card
      title={t('messenger')}
      icon={<MessageCircle className="h-4 w-4" />}
      action={<Badge tone={info.stats.onlineUsers > 0 ? 'good' : undefined}>{t('messengerOnline', { n: info.stats.onlineUsers })}</Badge>}
    >
      <p className="mb-3 text-[11px] leading-relaxed text-ink-muted">{t('messengerCodesHint')}</p>
      {!info.codes.length ? (
        <p className="text-[11px] text-ink-muted">{t('messengerNoCodes')}</p>
      ) : (
        <ul className="divide-y divide-line">
          {info.codes.map((c) => (
            <li key={c.phone} className="flex flex-wrap items-center gap-2 py-2.5">
              <span className="min-w-0 flex-1 truncate font-mono text-sm" dir="ltr">
                {c.phone}
              </span>
              {c.isNewUser && <Badge tone="info">{t('messengerNewUser')}</Badge>}
              <code className="tnum rounded-lg border border-line px-3 py-1 font-mono text-lg tracking-widest">
                {c.code}
              </code>
              <CopyButton value={c.code} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------------------
   اعلان‌ها — همان کاری که ntfy می‌کند، ولی روی همین سرور خانگی.
   هر «موضوع» یک آدرس دارد؛ هر برنامه‌ای که بتواند یک درخواست ساده بزند،
   می‌تواند روی آن موضوع خبر بگذارد و خبر روی برنامهٔ پمپ یعقوبی می‌نشیند.
--------------------------------------------------------------------------- */
type NotifyTopic = {
  name: string;
  title: string | null;
  hasToken: boolean;
  messages: number;
  devices: number;
  lastAt: number | null;
};

function NotifyCard({ addresses }: { addresses: SiteServerInfo['addresses'] }) {
  const { t } = useApp();
  const [topics, setTopics] = useState<NotifyTopic[] | null>(null);
  const [listeners, setListeners] = useState(0);
  const [newName, setNewName] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [freshToken, setFreshToken] = useState<{ topic: string; token: string } | null>(null);

  const load = useCallback(() => {
    api<{ topics: NotifyTopic[]; stats: { listeners: number } }>('/api/notify-admin')
      .then((r) => {
        setTopics(r.topics);
        setListeners(r.stats?.listeners ?? 0);
      })
      .catch(() => setTopics(null));
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 6000);
    return () => clearInterval(timer);
  }, [load]);

  if (!topics) return null;

  // آدرسی که کاربر باید در برنامهٔ دیگرش بگذارد — بهترین آدرسِ در دسترس
  const base = addresses.find((a) => a.scope === 'public')?.http || addresses[0]?.http || '';

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await api('/api/notify-admin', { body: { name } });
      setNewName('');
      load();
    } catch {
      toast(t('error'), 'bad');
    }
  };

  return (
    <Card
      title={t('notify')}
      icon={<Bell className="h-4 w-4" />}
      action={<Badge tone={listeners > 0 ? 'good' : undefined}>{t('notifyListeners', { n: listeners })}</Badge>}
    >
      <p className="mb-3 text-[11px] leading-relaxed text-ink-muted">{t('notifyHint')}</p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className="input min-w-0 flex-1 font-mono"
          dir="ltr"
          placeholder={t('notifyTopicName')}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
        />
        <button className="btn btn-sm btn-primary" onClick={create}>
          {t('notifyCreate')}
        </button>
      </div>

      {!topics.length ? (
        <p className="text-[11px] text-ink-muted">{t('notifyNoTopics')}</p>
      ) : (
        <ul className="divide-y divide-line">
          {topics.map((topic) => (
            <li key={topic.name} className="py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="min-w-0 flex-1 truncate text-start font-mono text-sm"
                  dir="ltr"
                  onClick={() => setOpen(open === topic.name ? null : topic.name)}
                >
                  {topic.name}
                </button>
                <Badge tone={topic.hasToken ? 'info' : undefined}>
                  {topic.hasToken ? t('notifyLocked') : t('notifyOpen')}
                </Badge>
                <span className="tnum shrink-0 text-[11px] text-ink-soft">
                  {ltr(`${topic.messages} · ${topic.devices}`)}
                </span>
              </div>

              {open === topic.name && (
                <div className="mt-2.5 flex flex-col gap-2.5 rounded-xl border border-line p-3" style={{ background: 'var(--surface-0)' }}>
                  <SendNotification topic={topic.name} onSent={load} />

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      className="btn btn-sm"
                      onClick={async () => {
                        try {
                          const r = await api<{ token: string }>(`/api/notify-admin/${topic.name}/token`, { body: {} });
                          setFreshToken({ topic: topic.name, token: r.token });
                          load();
                        } catch {
                          toast(t('error'), 'bad');
                        }
                      }}
                    >
                      {t('notifyNewToken')}
                    </button>
                    {topic.hasToken && (
                      <button
                        className="btn btn-sm"
                        onClick={async () => {
                          try {
                            await api(`/api/notify-admin/${topic.name}/token`, { body: { clear: true } });
                            setFreshToken(null);
                            load();
                          } catch {
                            toast(t('error'), 'bad');
                          }
                        }}
                      >
                        {t('notifyClearToken')}
                      </button>
                    )}
                  </div>

                  {freshToken?.topic === topic.name && (
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="min-w-0 flex-1 truncate rounded-lg border border-line px-2 py-1.5 font-mono text-xs" dir="ltr">
                        {freshToken.token}
                      </code>
                      <CopyButton value={freshToken.token} />
                      <p className="basis-full text-[11px] text-ink-muted">{t('notifyTokenMade')}</p>
                    </div>
                  )}

                  <div>
                    <p className="mb-1 text-[11px] text-ink-muted">{t('notifyHowTo')}</p>
                    <div className="flex items-center gap-2">
                      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-line px-2 py-1.5 font-mono text-[11px]" dir="ltr">
                        {curlFor(base, topic.name)}
                      </code>
                      <CopyButton value={curlFor(base, topic.name)} />
                    </div>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const curlFor = (base: string, topic: string) => `curl -d "متن خبر" ${base}/api/notify/${topic}`;

function SendNotification({ topic, onSent }: { topic: string; onSent: () => void }) {
  const { t } = useApp();
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!message.trim() || busy) return;
    setBusy(true);
    try {
      await api(`/api/notify-admin/${topic}/send`, { body: { title: title.trim() || undefined, message } });
      setTitle('');
      setMessage('');
      toast(t('notifySent'));
      onSent();
    } catch {
      toast(t('error'), 'bad');
    }
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-2">
      <input className="input" placeholder={t('notifyTitle')} value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input min-w-0 flex-1"
          placeholder={t('notifyBody')}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <button className="btn btn-sm btn-primary" onClick={send} disabled={busy}>
          {busy ? <Spinner /> : t('notifySend')}
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <p className="text-[11px] text-ink-muted">{label}</p>
      <p className="tnum mt-1 text-2xl font-semibold">{value}</p>
    </Card>
  );
}

/* ---------------------------------------------------------------------------
   اتصال از اینترنت — همان چیزی که باعث می‌شود سایت روی همهٔ دستگاه‌ها کار کند.
   تونل خودش بالا می‌آید؛ کاربر فقط لینک یا QR را به دستگاه‌ها می‌دهد.
--------------------------------------------------------------------------- */
function InternetAccess({ data, onChanged }: { data: SiteServerInfo; onChanged: () => void }) {
  const { t, socket } = useApp();
  const [tunnel, setTunnel] = useState(data.tunnel);
  const [busy, setBusy] = useState(false);
  const [siteUrl, setSiteUrl] = useState(data.siteUrl);
  const [savingUrl, setSavingUrl] = useState(false);

  useEffect(() => setTunnel(data.tunnel), [data.tunnel]);
  useEffect(() => setSiteUrl(data.siteUrl), [data.siteUrl]);

  // وضعیت تونل زنده می‌آید (دانلود، بالا آمدن، خطا)
  useEffect(() => {
    if (!socket) return;
    const onTunnel = (payload: SiteServerInfo['tunnel']) => setTunnel(payload);
    socket.on('tunnel', onTunnel);
    return () => {
      socket.off('tunnel', onTunnel);
    };
  }, [socket]);

  const running = tunnel.status === 'running' && Boolean(tunnel.wss);
  const busyState = tunnel.status === 'installing' || tunnel.status === 'starting';

  async function toggle() {
    setBusy(true);
    try {
      await api(`/api/site-server/tunnel/${running || busyState ? 'stop' : 'start'}`, { method: 'POST' });
      setTimeout(onChanged, 1200);
    } catch {
      toast(t('error'), 'bad');
    } finally {
      setBusy(false);
    }
  }

  // آدرس سایت — اگر دامنه عوض شود، لینک یک‌کلیکی باید به آدرس تازه برود
  async function saveSiteUrl() {
    const value = siteUrl.trim();
    if (!/^https?:\/\/[^\s/]+/i.test(value)) {
      toast(t('invalidSiteUrl'), 'bad');
      return;
    }
    setSavingUrl(true);
    try {
      await api('/api/site-server/site-url', { method: 'PUT', body: { siteUrl: value } });
      toast(t('saved'), 'good');
      onChanged();
    } catch {
      toast(t('error'), 'bad');
    } finally {
      setSavingUrl(false);
    }
  }

  return (
    <Card
      title={t('internetAccess')}
      icon={<Globe className="h-4 w-4" />}
      action={
        <button className={`btn btn-sm ${running ? '' : 'btn-primary'}`} disabled={busy} onClick={toggle}>
          {running || busyState ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
          {running || busyState ? t('turnOff') : t('turnOn')}
        </button>
      }
    >
      {/* وضعیت */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {running ? (
          <Badge tone="good">{t('tunnelRunning')}</Badge>
        ) : tunnel.status === 'installing' ? (
          <Badge tone="info">{t('tunnelInstalling')}</Badge>
        ) : tunnel.status === 'starting' ? (
          <Badge tone="info">{t('tunnelStarting')}</Badge>
        ) : tunnel.status === 'error' ? (
          <Badge tone="bad">{t('tunnelError')}</Badge>
        ) : (
          <Badge>{t('tunnelOff')}</Badge>
        )}
        {busyState && <Spinner className="text-ink-muted" />}
      </div>

      {tunnel.error && (
        <div
          className="mb-3 rounded-xl px-3 py-2 text-xs"
          style={{
            background: 'color-mix(in srgb, var(--status-critical) 12%, transparent)',
            color: 'var(--status-critical)',
          }}
        >
          <p>{tunnel.error}</p>

          {/* دلیل واقعی، نه فقط «کد ۱» */}
          {tunnel.diagnosis?.problems?.length ? (
            <ul className="mt-1.5 list-disc space-y-0.5 ps-4">
              {tunnel.diagnosis.problems.map((p) => (
                <li key={p.code}>{p.message}</li>
              ))}
            </ul>
          ) : null}

          {tunnel.diagnosis?.lastError && (
            <p className="mt-1.5 break-all font-mono text-[10px] opacity-80" dir="ltr">
              {tunnel.diagnosis.lastError}
            </p>
          )}

          {tunnel.diagnosis?.problems?.some((p) => p.fixable) && (
            <button
              className="btn btn-sm mt-2"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api('/api/site-server/tunnel/repair', { method: 'POST' });
                  toast(t('repairStarted'));
                  setTimeout(onChanged, 2000);
                } catch (e) {
                  toast(e instanceof ApiError ? e.code : t('error'), 'bad');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Wrench className="h-3.5 w-3.5" />
              {t('repairTunnel')}
            </button>
          )}
        </div>
      )}

      {running && data.siteLink ? (
        <>
          <p className="mb-3 text-xs leading-relaxed text-ink-soft">{t('oneClickIntro')}</p>

          <div className="flex flex-col gap-4 sm:flex-row">
            {data.siteLinkQr && (
              <div
                className="mx-auto w-40 shrink-0 rounded-xl border border-line bg-white p-2"
                // QR از سرور به‌صورت SVG می‌آید
                dangerouslySetInnerHTML={{ __html: data.siteLinkQr }}
              />
            )}

            <div className="min-w-0 flex-1">
              <p className="label">{t('oneClickLink')}</p>
              <div className="flex flex-wrap items-center gap-2">
                <code
                  className="min-w-0 flex-1 break-all rounded-xl border border-line px-3 py-2 font-mono text-[11px]"
                  style={{ background: 'var(--surface-0)' }}
                  dir="ltr"
                >
                  {data.siteLink}
                </code>
                <CopyButton value={data.siteLink} />
                <a className="btn btn-sm" href={data.siteLink} target="_blank" rel="noreferrer">
                  {t('open')}
                </a>
              </div>

              <p className="label mt-4">{t('serverAddress')}</p>
              <div className="flex flex-wrap items-center gap-2">
                <code
                  className="min-w-0 flex-1 truncate rounded-xl border border-line px-3 py-2 font-mono text-xs"
                  style={{ background: 'var(--surface-0)' }}
                  dir="ltr"
                >
                  {tunnel.wss}
                </code>
                <CopyButton value={tunnel.wss || ''} />
              </div>
            </div>
          </div>

          <p className="mt-4 flex items-start gap-1.5 text-[11px] text-ink-muted">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t('tunnelAddressChanges')}
          </p>
        </>
      ) : (
        <div className="flex items-start gap-2.5">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--status-warning)' }} />
          <div className="text-xs leading-relaxed text-ink-soft">
            <p className="mb-1 font-semibold text-ink">{t('lanOnlyTitle')}</p>
            <p>{t('lanOnlyBody')}</p>
            <p className="mt-1.5">{t('tunnelHint')}</p>
          </div>
        </div>
      )}

      {/* آدرس سایت همیشه قابل نوشتن است — چه تونل روشن باشد چه خاموش */}
      <div className="mt-4 border-t border-line pt-4">
        <p className="label">{t('siteAddress')}</p>
        <p className="mb-2 text-[11px] leading-relaxed text-ink-muted">{t('siteAddressHint')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="input min-w-0 flex-1 font-mono text-xs"
            dir="ltr"
            value={siteUrl}
            onChange={(e) => setSiteUrl(e.target.value)}
            placeholder="https://example.com"
          />
          <button
            className="btn btn-sm btn-primary"
            disabled={savingUrl || !siteUrl.trim() || siteUrl.trim() === data.siteUrl}
            onClick={saveSiteUrl}
          >
            {savingUrl ? <Spinner /> : null}
            {t('save')}
          </button>
        </div>
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------------------
   آدرس ثابت — مدل فایربیس
   با تونل نام‌دار Cloudflare یک زیردامنهٔ خودِ کاربر برای همیشه به این سرور وصل
   می‌شود. آن وقت آدرس یک‌بار در سایت می‌نشیند و دیگر هیچ لینکی لازم نیست.
--------------------------------------------------------------------------- */
/**
 *  «دامنه‌ام برای یک برنامهٔ دیگر است» — پرسشی که هر کسی اینجا می‌پرسد.
 *
 *  یک دامنه بی‌نهایت زیردامنه دارد و هرکدام جای خودش می‌رود. چیزی که
 *  اینجا ساخته می‌شود فقط یک رکورد برای همان زیردامنه‌ای است که خودتان
 *  می‌نویسید؛ به بقیه دست نمی‌زند. نگفتنش یعنی کسی یا از ترس جلو نمی‌رود،
 *  یا دامنهٔ اصلی را می‌نویسد و برنامهٔ دیگرش را از کار می‌اندازد.
 */
function SubdomainNote() {
  const { t } = useApp();
  return (
    <div
      className="mb-2 rounded-xl border border-line p-3 text-[11px] leading-relaxed text-ink-soft"
      style={{ background: 'var(--surface-0)' }}
    >
      <p className="mb-1.5 font-medium text-ink">{t('subdomainTitle')}</p>
      <p className="mb-1.5">{t('subdomainBody')}</p>
      <pre className="mb-1.5 overflow-x-auto font-mono text-[11px]" dir="ltr">
{`app.example.com    ← برنامهٔ فعلی شما، دست‌نخورده
panel.example.com  ← این سرور
shop.example.com   ← هر چیز دیگری، بعداً`}
      </pre>
      <p className="text-[11px]" style={{ color: 'var(--status-warning)' }}>{t('subdomainWarn')}</p>
    </div>
  );
}

function PermanentAddress({ data, onChanged }: { data: SiteServerInfo; onChanged: () => void }) {
  const { t } = useApp();
  const [hostname, setHostname] = useState(data.named.hostname || '');
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState(data.named.loggedIn);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [cfToken, setCfToken] = useState('');
  const [newHost, setNewHost] = useState('');
  const [newPort, setNewPort] = useState('');
  const [commands, setCommands] = useState<string[]>([]);

  const active = data.tunnel.permanent && Boolean(data.tunnel.hostname);

  // دستورهای دستی را از سرور می‌گیریم (مسیر دقیق cloudflared در همان کامپیوتر)
  useEffect(() => {
    api<{ commands: string[] }>('/api/site-server/tunnel/named/commands')
      .then((r) => setCommands(r.commands))
      .catch(() => setCommands([]));
  }, [data.tunnel.installed, data.named.hostname]);

  // بعد از باز کردن لینک ورود، منتظر می‌مانیم تا Cloudflare اجازه را ثبت کند
  useEffect(() => {
    if (!loginUrl || loggedIn) return;
    const timer = setInterval(async () => {
      try {
        const res = await api<{ loggedIn: boolean }>('/api/site-server/tunnel/named/login-status');
        if (res.loggedIn) {
          setLoggedIn(true);
          setLoginUrl(null);
        }
      } catch { /* هنوز */ }
    }, 3000);
    return () => clearInterval(timer);
  }, [loginUrl, loggedIn]);

  async function startLogin() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ alreadyLoggedIn: boolean; url: string | null; error?: string }>(
        '/api/site-server/tunnel/named/login',
        { method: 'POST' }
      );
      if (res.alreadyLoggedIn) setLoggedIn(true);
      else if (res.url) setLoginUrl(res.url);
      else setError(res.error || t('error'));
    } catch (e) {
      setError(e instanceof ApiError ? e.code : t('error'));
    } finally {
      setBusy(false);
    }
  }

  async function createPermanent() {
    setBusy(true);
    setError(null);
    try {
      await api('/api/site-server/tunnel/named/setup', { body: { hostname: hostname.trim() } });
      const tk = await api<{ token: string }>('/api/site-server/token');
      setToken(tk.token);
      toast(t('permanentDone'));
      onChanged();
    } catch (e) {
      // اگر سرور توضیح داده، همان را نشان بده — نه تکرارِ کد
      setError(
        e instanceof ApiError ? (e.message && e.message !== e.code ? e.message : e.code) : t('error')
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t('permanentTitle')} icon={<Anchor className="h-4 w-4" />}>
      <p className="mb-4 text-xs leading-relaxed text-ink-soft">{t('permanentIntro')}</p>

      {active ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge tone="good">{t('permanentActive')}</Badge>
            <code className="font-mono text-sm" dir="ltr">
              wss://{data.tunnel.hostname}
            </code>
            <CopyButton value={`wss://${data.tunnel.hostname}`} />
          </div>

          <p className="label mt-4">{t('permanentPutInSite')}</p>
          <pre
            className="overflow-x-auto rounded-xl border border-line p-3 font-mono text-[11px] leading-relaxed"
            style={{ background: 'var(--surface-0)' }}
            dir="ltr"
          >
{`var SELF_HOST_URL   = 'wss://${data.tunnel.hostname}';
var SELF_HOST_TOKEN = '${token ?? '…'}';`}
          </pre>
          {/* سایت‌های دیگر روی همین تونل — بدون تکرار هیچ مرحله‌ای */}
          <div className="mt-5 rounded-xl border border-line p-3.5" style={{ background: 'var(--surface-0)' }}>
            <p className="mb-1 text-sm font-semibold">{t('moreSites')}</p>
            <p className="mb-3 text-[11px] leading-relaxed text-ink-soft">{t('moreSitesHint')}</p>

            {data.hostnames.filter((h) => !h.main).length ? (
              <ul className="mb-3 divide-y divide-line">
                {data.hostnames
                  .filter((h) => !h.main)
                  .map((h) => (
                    <li key={h.hostname} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0 truncate font-mono text-xs" dir="ltr">
                        {h.hostname} → localhost:{h.port}
                        {h.site ? ` (${h.site})` : ''}
                      </span>
                      {h.source === 'site' ? (
                        // از بخش «دامنه‌ها» می‌آید؛ آنجا هم عوض می‌شود
                        <Badge tone="info">{t('connectedSite')}</Badge>
                      ) : (
                        <button
                          className="btn btn-sm"
                          onClick={async () => {
                            await api(`/api/site-server/tunnel/hostname?hostname=${encodeURIComponent(h.hostname)}`, {
                              method: 'DELETE',
                            });
                            onChanged();
                          }}
                        >
                          {t('delete')}
                        </button>
                      )}
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="mb-3 text-[11px] text-ink-muted">{t('noExtraHostnames')}</p>
            )}

            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <label className="label">{t('domain')}</label>
                <input
                  className="input"
                  dir="ltr"
                  placeholder="shop.example.com"
                  value={newHost}
                  onChange={(e) => setNewHost(e.target.value)}
                />
              </div>
              <div className="w-28">
                <label className="label">{t('hostnamePort')}</label>
                <input
                  className="input tnum"
                  dir="ltr"
                  inputMode="numeric"
                  placeholder="8100"
                  value={newPort}
                  onChange={(e) => setNewPort(e.target.value)}
                />
              </div>
              <button
                className="btn btn-primary"
                disabled={busy || !newHost.trim() || !newPort.trim()}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await api('/api/site-server/tunnel/hostname', {
                      body: { hostname: newHost.trim(), port: Number(newPort) },
                    });
                    setNewHost('');
                    setNewPort('');
                    toast(t('saved'));
                    onChanged();
                  } catch (e) {
                    setError(e instanceof ApiError ? e.code : t('error'));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy && <Spinner />}
                {t('addHostname')}
              </button>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            {!token && (
              <button
                className="btn btn-sm"
                onClick={async () => {
                  try {
                    const tk = await api<{ token: string }>('/api/site-server/token');
                    setToken(tk.token);
                  } catch {
                    toast(t('error'), 'bad');
                  }
                }}
              >
                <Eye className="h-3.5 w-3.5" />
                {t('showToken')}
              </button>
            )}
            {token && (
              <CopyButton
                value={`var SELF_HOST_URL   = 'wss://${data.tunnel.hostname}';\nvar SELF_HOST_TOKEN = '${token}';`}
              />
            )}
            <button
              className="btn btn-sm"
              onClick={async () => {
                await api('/api/site-server/tunnel/named/reset', { method: 'POST' });
                onChanged();
              }}
            >
              {t('permanentReset')}
            </button>
          </div>
        </>
      ) : (
        <>
          {/* راه رایگان — بدون کارت بانکی */}
          <div className="mb-5 rounded-xl border border-line p-3.5" style={{ background: 'var(--surface-0)' }}>
            <p className="mb-1 text-sm font-semibold">{t('freeWayTitle')}</p>
            <p className="mb-3 text-[11px] leading-relaxed text-ink-soft">{t('freeWayIntro')}</p>

            {loggedIn ? (
              <Badge tone="good">{t('permanentLoggedIn')}</Badge>
            ) : (
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={startLogin}>
                {busy && <Spinner />}
                {t('permanentLogin')}
              </button>
            )}

            {loginUrl && (
              <div className="mt-2">
                <p className="mb-1 text-[11px] text-ink-muted">{t('permanentOpenLink')}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <code
                    className="min-w-0 flex-1 break-all rounded-xl border border-line px-3 py-2 font-mono text-[11px]"
                    style={{ background: 'var(--surface-2)' }}
                    dir="ltr"
                  >
                    {loginUrl}
                  </code>
                  <CopyButton value={loginUrl} />
                  <a className="btn btn-sm" href={loginUrl} target="_blank" rel="noreferrer">
                    {t('open')}
                  </a>
                </div>
              </div>
            )}

            {/* همیشه در دسترس: دستورهای دستی */}
            {commands.length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-[11px] font-medium text-ink-soft">{t('manualCommands')}</p>
                <pre
                  className="overflow-x-auto rounded-xl border border-line p-3 font-mono text-[11px] leading-relaxed"
                  style={{ background: 'var(--surface-2)' }}
                  dir="ltr"
                >
                  {commands.join('\n')}
                </pre>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <CopyButton value={commands.join('\n')} />
                  <span className="text-[11px] text-ink-muted">{t('manualHint')}</span>
                </div>
              </div>
            )}

            <label className="label mt-4">{t('permanentStep2')}</label>
            <p className="mb-1.5 text-[11px] text-ink-muted">{t('permanentStep2Hint')}</p>
            {/*
                بیشترِ کسانی که به اینجا می‌رسند یک دامنه دارند که همین حالا
                جای دیگری کار می‌کند، و می‌ترسند با این کار خرابش کنند. جواب
                کوتاه است و باید همین‌جا باشد، نه در جایی که بعداً پیدا شود.
            */}
            <SubdomainNote />
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="input max-w-xs"
                dir="ltr"
                placeholder="sync.example.com"
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
              />
              <button
                className="btn btn-primary"
                disabled={busy || !loggedIn || !hostname.trim()}
                onClick={createPermanent}
              >
                {busy && <Spinner />}
                {t('permanentCreate')}
              </button>
            </div>
          </div>

          {/* راه دوم: توکن از داشبورد (کارت بانکی می‌خواهد) */}
          <div className="mb-5 rounded-xl border border-line p-3.5" style={{ background: 'var(--surface-0)' }}>
            <p className="mb-2 text-sm font-semibold">{t('tokenWay')}</p>
            <ol className="mb-3 space-y-1 text-[11px] leading-relaxed text-ink-soft">
              <li>{t('tokenStep1')}</li>
              <li>{t('tokenStep2')}</li>
              <li>{t('tokenStep3', { port: data.dedicatedPort || 4701 })}</li>
              <li>{t('tokenStep4')}</li>
            </ol>
            <a
              className="btn btn-sm mb-3"
              href="https://one.dash.cloudflare.com/?to=/:account/networks/tunnels"
              target="_blank"
              rel="noreferrer"
            >
              <Globe className="h-3.5 w-3.5" />
              one.dash.cloudflare.com
            </a>

            <label className="label">{t('tokenLabel')}</label>
            <textarea
              className="input h-20 font-mono text-[11px]"
              dir="ltr"
              placeholder="eyJhIjoiXXXXXXXX…"
              value={cfToken}
              onChange={(e) => setCfToken(e.target.value)}
            />
            <label className="label mt-3">{t('permanentStep2')}</label>
            <SubdomainNote />
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="input max-w-xs"
                dir="ltr"
                placeholder="sync.example.com"
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
              />
              <button
                className="btn btn-primary"
                disabled={busy || !cfToken.trim() || !hostname.trim()}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await api('/api/site-server/tunnel/token', {
                      body: { token: cfToken.trim(), hostname: hostname.trim() },
                    });
                    setCfToken('');
                    toast(t('tokenSaved'));
                    onChanged();
                  } catch (e) {
                    const code = e instanceof ApiError ? e.code : 'error';
                    setError(
                      code === 'invalid_token' || code === 'invalid_hostname' ? t(code as never) : code
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy && <Spinner />}
                {t('tokenSave')}
              </button>
            </div>
          </div>


          {error && (
            <p
              className="mt-3 rounded-xl px-3 py-2 text-xs"
              style={{
                background: 'color-mix(in srgb, var(--status-critical) 12%, transparent)',
                color: 'var(--status-critical)',
              }}
            >
              {error}
            </p>
          )}
        </>
      )}
    </Card>
  );
}
