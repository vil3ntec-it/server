// ---------------------------------------------------------------------------
//  کدهای شش‌رقمی
//
//  سه تب، و هر کدام یک سؤالِ مشخص را جواب می‌دهد:
//
//    کدهای زنده   «الان چه کسی منتظرِ کد است و کدش چند است؟»
//    برنامه‌ها     «این برنامه را چطور به سرور وصل کنم؟»
//    ربات         «ایمیل از کجا می‌رود و صف در چه حالی است؟»
//
//  فهرستِ زنده خودش هر دو ثانیه تازه می‌شود، چون کد دو دقیقه بیشتر عمر
//  نمی‌کند و صفحه‌ای که باید دستی نو شود، همیشه کدِ مرده نشان می‌دهد.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  KeyRound,
  Mail,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Timer,
  Trash2,
} from 'lucide-react';
import { api } from '../api';
import { useApp } from '../app-context';
import { Card, CopyButton, Empty, Field, Loading, Modal, toast } from '../components/ui';
import { ActionButton, Cell, Notice, Row, Select, Stat, Table, Tabs } from '../control/ui';

/* ------------------------------- انواع ---------------------------------- */

type LiveItem = {
  id: number;
  app: string;
  appName: string;
  email: string;
  subjectId: string | null;
  purpose: string;
  code: string | null;
  createdAt: number;
  expiresAt: number;
  expiresIn: number;
  tries: number;
  status: 'live' | 'used' | 'replaced' | 'expired';
  sendState: 'queued' | 'sending' | 'sent' | 'failed';
  sendError: string | null;
  autoResend: boolean;
};

type QueueState = {
  running: boolean;
  workers: number;
  busyWorkers: number;
  mailReady: boolean;
  waiting: number;
  sending: number;
  failed: number;
  sentLastHour: number;
};

type CodeApp = {
  slug: string;
  name: string;
  kind: 'app' | 'site';
  kindLabel: string;
  apiKey: string;
  requireKey: boolean;
  enabled: boolean;
  codeTtl: number | null;
  subject: string | null;
  note: string | null;
  lastSeenAt: number | null;
};

type Settings = {
  email: {
    host: string;
    port: number;
    secure: boolean;
    username: string;
    password: string;
    from: string;
    fromName: string;
  };
  codeLength: number;
  ttlSeconds: number;
  resendSeconds: number;
  autoResendSeconds: number;
  autoResendMax: number;
  maxTries: number;
  workers: number;
  sendRetries: number;
  keepMinutes: number;
  subject: string;
  mailReady: boolean;
};

/* ------------------------------ صفحه ------------------------------------ */

export default function Codes() {
  const { t } = useApp();
  const [tab, setTab] = useState('live');
  const [queue, setQueue] = useState<QueueState | null>(null);

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-4">
        <h1 className="text-lg font-semibold">{t('codesTitle')}</h1>
        <p className="mt-1 text-xs text-ink-muted">{t('codesSubtitle')}</p>
      </header>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'live', label: t('codesLive'), badge: queue?.waiting },
          { id: 'apps', label: t('codesApps') },
          { id: 'bot', label: t('codesBot') },
        ]}
      />

      {tab === 'live' && <LiveTab onQueue={setQueue} />}
      {tab === 'apps' && <AppsTab />}
      {tab === 'bot' && <BotTab onQueue={setQueue} />}
    </div>
  );
}

/* --------------------------- تبِ کدهای زنده ------------------------------ */

function LiveTab({ onQueue }: { onQueue: (q: QueueState) => void }) {
  const { t } = useApp();
  const [items, setItems] = useState<LiveItem[] | null>(null);
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [onlyLive, setOnlyLive] = useState(true);
  const [app, setApp] = useState('');
  const [apps, setApps] = useState<CodeApp[]>([]);
  // ساعتِ صفحه، تا شمارشِ معکوس بینِ دو بار گرفتنِ داده هم جلو برود
  const [tick, setTick] = useState(Date.now());
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await api<{ items: LiveItem[]; queue: QueueState }>(
        `/api/codes-admin/live${app ? `?app=${encodeURIComponent(app)}` : ''}`
      );
      if (!alive.current) return;
      setItems(res.items);
      setQueue(res.queue);
      onQueue(res.queue);
    } catch {
      if (alive.current) setItems([]);
    }
  }, [app, onQueue]);

  useEffect(() => {
    alive.current = true;
    load();
    const poll = setInterval(load, 2500);
    const clock = setInterval(() => setTick(Date.now()), 1000);
    return () => {
      alive.current = false;
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [load]);

  useEffect(() => {
    api<{ apps: CodeApp[] }>('/api/codes-admin/apps')
      .then((r) => setApps(r.apps))
      .catch(() => {});
  }, []);

  const shown = useMemo(
    () => (items || []).filter((i) => !onlyLive || i.status === 'live'),
    [items, onlyLive]
  );

  if (!items) return <Loading />;

  return (
    <div className="space-y-4">
      {queue && !queue.mailReady && (
        <Notice tone="warn">
          {t('codesNoMail')}
        </Notice>
      )}

      {queue && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={t('codesQWaiting')} value={queue.waiting} />
          <Stat label={t('codesQSending')} value={queue.sending} />
          <Stat label={t('codesQSentHour')} value={queue.sentLastHour} />
          <Stat
            label={t('codesQFailed')}
            value={queue.failed}
            tone={queue.failed > 0 ? 'bad' : undefined}
          />
        </div>
      )}

      <Card
        title={t('codesLive')}
        icon={<Timer className="h-4 w-4" />}
        action={
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11px] text-ink-muted">
              <input
                type="checkbox"
                checked={onlyLive}
                onChange={(e) => setOnlyLive(e.target.checked)}
              />
              {t('codesOnlyLive')}
            </label>
            <div className="w-36">
              <Select
                value={app}
                onChange={setApp}
                placeholder={t('codesAllApps')}
                options={apps.map((a) => ({ value: a.slug, label: a.name }))}
              />
            </div>
            <ActionButton onClick={load}>
              <RefreshCw className="h-3.5 w-3.5" />
            </ActionButton>
          </div>
        }
      >
        {shown.length === 0 ? (
          <Empty
            icon={<Mail className="h-6 w-6" />}
            title={t('codesEmpty')}
            hint={t('codesEmptyHint')}
          />
        ) : (
          <Table
            head={[t('codesEmail'), t('codesFrom'), t('codesCode'), t('codesLeft'), t('codesState'), '']}
          >
            {shown.map((item) => (
              <CodeRow key={item.id} item={item} now={tick} />
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

function CodeRow({ item, now }: { item: LiveItem; now: number }) {
  const { t } = useApp();
  const left = Math.max(0, Math.round((item.expiresAt - now) / 1000));
  const live = item.status === 'live' && left > 0;

  const stateColor =
    item.sendState === 'sent' ? 'var(--status-good)'
    : item.sendState === 'failed' ? 'var(--status-critical)'
    : 'var(--status-warning)';

  const stateLabel =
    item.sendState === 'sent' ? t('codesSent')
    : item.sendState === 'failed' ? t('codesFailed')
    : item.sendState === 'sending' ? t('codesSending')
    : t('codesQueued');

  return (
    <Row>
      <Cell>
        <div className="min-w-0">
          <p className="truncate text-sm" dir="ltr">{item.email}</p>
          {item.subjectId && (
            <p className="truncate font-mono text-[10px] text-ink-muted" dir="ltr">{item.subjectId}</p>
          )}
        </div>
      </Cell>

      <Cell>
        <div className="min-w-0">
          <p className="truncate text-sm">{item.appName}</p>
          <p className="truncate text-[10px] text-ink-muted">
            {item.purpose}
            {item.autoResend ? ` · ${t('codesAuto')}` : ''}
          </p>
        </div>
      </Cell>

      {/* خودِ کد — بزرگ و خوانا، چون ممکن است تلفنی بخوانیدش */}
      <Cell>
        {item.code ? (
          <span className="tnum font-mono text-base font-semibold tracking-[0.2em]" dir="ltr">
            {item.code}
          </span>
        ) : (
          <span className="text-xs text-ink-muted">
            {item.status === 'used' ? t('codesUsed')
              : item.status === 'replaced' ? t('codesReplaced')
              : t('codesExpired')}
          </span>
        )}
      </Cell>

      <Cell>
        {live ? (
          <span
            className="tnum text-xs"
            style={{ color: left <= 15 ? 'var(--status-warning)' : 'var(--text-secondary)' }}
          >
            {left}s
          </span>
        ) : (
          <span className="text-xs text-ink-muted">—</span>
        )}
      </Cell>

      <Cell>
        <span
          className="chip whitespace-nowrap"
          style={{ background: `color-mix(in srgb, ${stateColor} 15%, transparent)`, color: stateColor }}
          title={item.sendError || undefined}
        >
          {stateLabel}
        </span>
        {item.tries > 0 && (
          <span className="ms-1 text-[10px] text-ink-muted">{t('codesTries')}: {item.tries}</span>
        )}
      </Cell>

      <Cell className="text-end">
        {item.code && <CopyButton value={item.code} />}
      </Cell>
    </Row>
  );
}

/* ---------------------------- تبِ برنامه‌ها ------------------------------ */

function AppsTab() {
  const { t } = useApp();
  const [apps, setApps] = useState<CodeApp[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [guide, setGuide] = useState<CodeApp | null>(null);

  const load = useCallback(() => {
    api<{ apps: CodeApp[] }>('/api/codes-admin/apps')
      .then((r) => setApps(r.apps))
      .catch(() => setApps([]));
  }, []);

  useEffect(load, [load]);

  if (!apps) return <Loading />;

  return (
    <div className="space-y-4">
      <Notice tone="info">{t('codesAppsHint')}</Notice>

      <Card
        title={t('codesApps')}
        icon={<KeyRound className="h-4 w-4" />}
        action={
          <button className="btn btn-sm" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" />
            {t('codesAddApp')}
          </button>
        }
      >
        {apps.length === 0 ? (
          <Empty icon={<KeyRound className="h-6 w-6" />} title={t('codesNoApps')} hint={t('codesNoAppsHint')} />
        ) : (
          <Table head={[t('codesAppName'), t('codesAppId'), t('codesKey'), t('codesOn'), '']}>
            {apps.map((row) => (
              <Row key={row.slug}>
                <Cell>
                  <p className="truncate text-sm">{row.name}</p>
                  <p className="text-[10px] text-ink-muted">{row.kindLabel}</p>
                </Cell>
                <Cell mono>{row.slug}</Cell>
                <Cell>
                  <span className="font-mono text-[10px] text-ink-muted" dir="ltr">
                    {row.apiKey.slice(0, 12)}…
                  </span>
                </Cell>
                <Cell>
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    onChange={async (e) => {
                      await api(`/api/codes-admin/apps/${row.slug}`, {
                        method: 'PUT',
                        body: { enabled: e.target.checked },
                      });
                      load();
                    }}
                  />
                </Cell>
                <Cell className="text-end">
                  <div className="flex justify-end gap-1.5">
                    <button className="btn btn-sm" onClick={() => setGuide(row)}>
                      {t('codesConnect')}
                    </button>
                    <ActionButton
                      onClick={async () => {
                        await api(`/api/codes-admin/apps/${row.slug}/key`, { method: 'POST' });
                        toast(t('codesKeyRotated'));
                        load();
                      }}
                      title={t('codesRotateHint')}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </ActionButton>
                    <ActionButton
                      onClick={async () => {
                        if (!confirm(t('codesDeleteAsk'))) return;
                        await api(`/api/codes-admin/apps/${row.slug}`, { method: 'DELETE' });
                        load();
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </ActionButton>
                  </div>
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>

      {adding && (
        <AddApp
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            load();
          }}
        />
      )}
      {guide && <ConnectGuide app={guide} onClose={() => setGuide(null)} />}
    </div>
  );
}

function AddApp({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useApp();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [kind, setKind] = useState<'app' | 'site'>('app');

  return (
    <Modal open title={t('codesAddApp')} onClose={onClose}>
      <Field label={t('codesAppName')}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t('codesAppId')} hint={t('codesAppIdHint')}>
        <input className="input" dir="ltr" value={slug} onChange={(e) => setSlug(e.target.value)} />
      </Field>
      <Field label={t('codesKind')}>
        <Select
          value={kind}
          onChange={(v) => setKind(v as 'app' | 'site')}
          options={[
            { value: 'app', label: t('codesKindApp') },
            { value: 'site', label: t('codesKindSite') },
          ]}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <button className="btn btn-sm" onClick={onClose}>{t('cancel')}</button>
        <ActionButton
          className="btn btn-sm btn-primary"
          onClick={async () => {
            if (!name.trim() && !slug.trim()) return;
            await api('/api/codes-admin/apps', {
              method: 'POST',
              body: { name: name.trim() || slug.trim(), slug: slug.trim() || name.trim(), kind },
            });
            onDone();
          }}
        >
          {t('ccSave')}
        </ActionButton>
      </div>
    </Modal>
  );
}

/**
 * «این برنامه را چطور وصل کنم؟»
 *
 * دو درخواست، با همان کلیدی که همین‌جا جلوی چشم است. عمداً curl نوشته شده
 * نه کدِ یک زبانِ خاص — هر زبانی همین دو درخواست را می‌فرستد.
 */
function ConnectGuide({ app, onClose }: { app: CodeApp; onClose: () => void }) {
  const { t } = useApp();
  const base = `${location.origin}/api/codes`;

  const request = `curl -X POST ${base}/request \\
  -H "Content-Type: application/json" \\
  -H "X-Api-Key: ${app.apiKey}" \\
  -d '{"app":"${app.slug}","email":"user@example.com","userId":"USER-1"}'`;

  const verify = `curl -X POST ${base}/verify \\
  -H "Content-Type: application/json" \\
  -H "X-Api-Key: ${app.apiKey}" \\
  -d '{"app":"${app.slug}","email":"user@example.com","code":"123456"}'`;

  return (
    <Modal open title={`${t('codesConnect')} — ${app.name}`} onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        <div>
          <p className="label">{t('codesKey')}</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-raised px-2 py-1.5 font-mono text-xs" dir="ltr">
              {app.apiKey}
            </code>
            <CopyButton value={app.apiKey} />
          </div>
          <p className="mt-1 text-[11px] text-ink-muted">{t('codesKeySecret')}</p>
        </div>

        <div>
          <p className="label">{t('codesStep1')}</p>
          <pre className="overflow-x-auto rounded-lg bg-surface-raised p-3 text-[11px] leading-relaxed" dir="ltr">
            {request}
          </pre>
          <div className="mt-1 flex justify-end"><CopyButton value={request} /></div>
        </div>

        <div>
          <p className="label">{t('codesStep2')}</p>
          <pre className="overflow-x-auto rounded-lg bg-surface-raised p-3 text-[11px] leading-relaxed" dir="ltr">
            {verify}
          </pre>
          <div className="mt-1 flex justify-end"><CopyButton value={verify} /></div>
        </div>

        <Notice tone="info">{t('codesConnectHint')}</Notice>
      </div>
    </Modal>
  );
}

/* ------------------------------ تبِ ربات -------------------------------- */

function BotTab({ onQueue }: { onQueue: (q: QueueState) => void }) {
  const { t } = useApp();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [testTo, setTestTo] = useState('');

  const load = useCallback(() => {
    api<{ settings: Settings; queue: QueueState }>('/api/codes-admin/settings')
      .then((r) => {
        setSettings(r.settings);
        setQueue(r.queue);
        onQueue(r.queue);
      })
      .catch(() => {});
  }, [onQueue]);

  useEffect(load, [load]);

  if (!settings) return <Loading />;

  const patch = (change: Partial<Settings>) => setSettings({ ...settings, ...change });
  const patchMail = (change: Partial<Settings['email']>) =>
    setSettings({ ...settings, email: { ...settings.email, ...change } });

  const save = async () => {
    await api('/api/codes-admin/settings', { method: 'PUT', body: settings });
    toast(t('saved'));
    load();
  };

  return (
    <div className="space-y-4">
      {!settings.mailReady && <Notice tone="warn">{t('codesNoMail')}</Notice>}

      <Card title={t('codesMailServer')} icon={<Mail className="h-4 w-4" />}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('codesHost')} hint="smtp.gmail.com">
            <input className="input" dir="ltr" value={settings.email.host}
              onChange={(e) => patchMail({ host: e.target.value })} />
          </Field>
          <Field label={t('codesPort')} hint="465 / 587">
            <input className="input" dir="ltr" type="number" value={settings.email.port}
              onChange={(e) => patchMail({ port: Number(e.target.value) })} />
          </Field>
          <Field label={t('codesUser')}>
            <input className="input" dir="ltr" value={settings.email.username}
              onChange={(e) => patchMail({ username: e.target.value })} />
          </Field>
          <Field label={t('codesPass')}>
            <input className="input" dir="ltr" type="password" value={settings.email.password}
              onChange={(e) => patchMail({ password: e.target.value })} />
          </Field>
          <Field label={t('codesFrom')}>
            <input className="input" dir="ltr" value={settings.email.from}
              onChange={(e) => patchMail({ from: e.target.value })} />
          </Field>
          <Field label={t('codesFromName')}>
            <input className="input" value={settings.email.fromName}
              onChange={(e) => patchMail({ fromName: e.target.value })} />
          </Field>
        </div>

        <Notice tone="warn">{t('codesDeliverability')}</Notice>

        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field label={t('codesTestTo')}>
              <input className="input" dir="ltr" value={testTo}
                onChange={(e) => setTestTo(e.target.value)} placeholder={settings.email.from} />
            </Field>
          </div>
          <ActionButton
            className="btn btn-sm mb-3"
            onClick={async () => {
              try {
                await api('/api/codes-admin/test-email', { method: 'POST', body: { to: testTo } });
                toast(t('codesTestSent'));
              } catch (e: any) {
                toast(e?.message || t('codesTestFailed'), 'bad');
              }
            }}
          >
            <Send className="h-3.5 w-3.5" />
            {t('codesTest')}
          </ActionButton>
        </div>
      </Card>

      <Card title={t('codesRules')} icon={<ShieldCheck className="h-4 w-4" />}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('codesTtl')} hint={t('codesTtlHint')}>
            <input className="input" dir="ltr" type="number" value={settings.ttlSeconds}
              onChange={(e) => patch({ ttlSeconds: Number(e.target.value) })} />
          </Field>
          <Field label={t('codesResend')} hint={t('codesResendHint')}>
            <input className="input" dir="ltr" type="number" value={settings.resendSeconds}
              onChange={(e) => patch({ resendSeconds: Number(e.target.value) })} />
          </Field>
          <Field label={t('codesAutoAfter')} hint={t('codesAutoAfterHint')}>
            <input className="input" dir="ltr" type="number" value={settings.autoResendSeconds}
              onChange={(e) => patch({ autoResendSeconds: Number(e.target.value) })} />
          </Field>
          <Field label={t('codesAutoMax')}>
            <input className="input" dir="ltr" type="number" value={settings.autoResendMax}
              onChange={(e) => patch({ autoResendMax: Number(e.target.value) })} />
          </Field>
          <Field label={t('codesMaxTries')}>
            <input className="input" dir="ltr" type="number" value={settings.maxTries}
              onChange={(e) => patch({ maxTries: Number(e.target.value) })} />
          </Field>
          <Field label={t('codesWorkers')} hint={t('codesWorkersHint')}>
            <input className="input" dir="ltr" type="number" value={settings.workers}
              onChange={(e) => patch({ workers: Number(e.target.value) })} />
          </Field>
        </div>
      </Card>

      <Card title={t('codesQueue')} icon={<Bot className="h-4 w-4" />}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={t('codesQWaiting')} value={queue?.waiting ?? 0} />
          <Stat label={t('codesQSending')} value={queue?.sending ?? 0} />
          <Stat label={t('codesQWorkers')} value={`${queue?.busyWorkers ?? 0}/${queue?.workers ?? 0}`} />
          <Stat label={t('codesQSentHour')} value={queue?.sentLastHour ?? 0} />
        </div>
      </Card>

      <div className="flex justify-end">
        <ActionButton className="btn btn-primary" onClick={save}>{t('ccSave')}</ActionButton>
      </div>
    </div>
  );
}
