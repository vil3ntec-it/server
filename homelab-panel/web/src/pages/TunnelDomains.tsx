// ---------------------------------------------------------------------------
//  دامنه‌ها
//
//  ⚠️ چرا این صفحه ساخته شد: تا امروز فقط «دامنهٔ اصلی» یک بخشِ کامل داشت —
//  با آدرسِ https، دکمهٔ کپی، و وضعیت. بقیهٔ دامنه‌ها یک سطرِ ساده در گوشهٔ
//  همان کارت بودند: نه معلوم بود رکوردِ DNS ساخته شده یا نه، نه به کدام
//  پورت می‌روند، نه از کجا آمده‌اند.
//
//  حالا هر دامنه همان بخش را دارد. و مهم‌تر: می‌شود هر کدام را «آدرسِ اصلیِ
//  سرور» کرد، بدونِ اینکه کلِ تونل بازنشانی شود.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Copy, ExternalLink, Globe, Plus,
  RefreshCw, Server, Star, Trash2,
} from 'lucide-react';

import { api, ApiError } from '../api';
import { useApp } from '../app-context';
import { Badge, Card, ConfirmDialog, Empty, Field, Loading, Modal, toast } from '../components/ui';
import { ActionButton, Notice } from '../control/ui';

type Source = 'main' | 'site' | 'api' | 'manual';

type DomainRow = {
  hostname: string;
  port: number;
  main: boolean;
  source: Source;
  site?: string;
  slug?: string;
  url: string;
  dnsRouted: boolean;
  protected: boolean;
  servedByTunnel: boolean;
};

type Overview = {
  mode: 'quick' | 'named' | 'token';
  main: string | null;
  tunnelName: string;
  items: DomainRow[];
};

/**
 * از کجا آمده — و برای همین قابلِ حذف است یا نه.
 * دامنه‌ای که از یک سایت می‌آید را باید در همان سایت عوض کرد، نه این‌جا؛
 * وگرنه دفعهٔ بعد که سایت هم‌گام شود دوباره برمی‌گردد.
 */
const SOURCE: Record<Source, { label: string; tone: 'good' | 'warn' | 'info' | 'neutral'; removable: boolean }> = {
  main: { label: 'آدرسِ اصلیِ سرور', tone: 'good', removable: false },
  site: { label: 'از یک سایت', tone: 'info', removable: false },
  api: { label: 'APIِ عمومی', tone: 'info', removable: false },
  manual: { label: 'دستی', tone: 'neutral', removable: true },
};

export default function TunnelDomainsPage() {
  const { t, role } = useApp();
  const canManage = role === 'admin';

  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ hostname: '', port: '' });

  const [makeMain, setMakeMain] = useState<DomainRow | null>(null);
  const [remove, setRemove] = useState<DomainRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<Overview>('/api/site-server/domains'));
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeMain(row: DomainRow) {
    setBusy(true);
    try {
      await api('/api/site-server/tunnel/named/main', { method: 'POST', body: { hostname: row.hostname } });
      toast(t('domMainChanged', { host: row.hostname }));
      await load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message || e.code : (e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  async function addDomain() {
    try {
      await api('/api/site-server/tunnel/hostname', {
        body: { hostname: form.hostname.trim(), port: Number(form.port) },
      });
      toast(t('saved'));
      setShowAdd(false);
      setForm({ hostname: '', port: '' });
      await load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message || e.code : (e as Error).message, 'bad');
    }
  }

  if (loading) return <Card><Loading /></Card>;

  const quick = data?.mode === 'quick';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">
            <Globe className="h-5 w-5" />
            {t('domains')}
          </h1>
          <p className="page-sub">{t('domSub', { n: data?.items.length ?? 0 })}</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-sm" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" />
            {t('refresh')}
          </button>
          {canManage && !quick && (
            <button className="btn btn-sm btn-primary" onClick={() => setShowAdd(true)}>
              <Plus className="h-3.5 w-3.5" />
              {t('domAdd')}
            </button>
          )}
        </div>
      </div>

      {quick && <Notice tone="warn">{t('domQuickMode')}</Notice>}

      {!data?.items.length ? (
        <Card>
          <Empty icon={<Globe className="h-8 w-8" />} title={t('domNone')} hint={t('domNoneHint')} />
        </Card>
      ) : (
        <div className="space-y-3">
          {data.items.map((row) => (
            <DomainCard
              key={row.hostname}
              row={row}
              canManage={canManage}
              quick={quick}
              busy={busy}
              onMakeMain={() => setMakeMain(row)}
              onRemove={() => setRemove(row)}
            />
          ))}
        </div>
      )}

      {/* ------------------------------ افزودن ------------------------------ */}

      <Modal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title={t('domAdd')}
        footer={
          <button
            className="btn btn-primary"
            disabled={!form.hostname.trim() || !form.port.trim()}
            onClick={() => void addDomain()}
          >
            {t('add')}
          </button>
        }
      >
        <Field label={t('domHostname')} hint={t('domHostnameHint')}>
          <input
            className="input ltr"
            placeholder="shop.vill3n.top"
            value={form.hostname}
            onChange={(e) => setForm({ ...form, hostname: e.target.value })}
            autoFocus
          />
        </Field>
        <Field label={t('domPort')} hint={t('domPortHint')}>
          <input
            className="input ltr tnum"
            inputMode="numeric"
            placeholder="8100"
            value={form.port}
            onChange={(e) => setForm({ ...form, port: e.target.value })}
          />
        </Field>
      </Modal>

      <ConfirmDialog
        open={Boolean(makeMain)}
        title={t('domMakeMainTitle')}
        message={`${makeMain?.hostname ?? ''} — ${t('domMakeMainBody')}`}
        onCancel={() => setMakeMain(null)}
        onConfirm={() => {
          const row = makeMain;
          setMakeMain(null);
          if (row) void changeMain(row);
        }}
      />

      <ConfirmDialog
        open={Boolean(remove)}
        danger
        title={t('domRemoveTitle')}
        message={`${remove?.hostname ?? ''} — ${t('domRemoveBody')}`}
        onCancel={() => setRemove(null)}
        onConfirm={async () => {
          const row = remove;
          setRemove(null);
          if (!row) return;
          try {
            await api(`/api/site-server/tunnel/hostname?hostname=${encodeURIComponent(row.hostname)}`, {
              method: 'DELETE',
            });
            toast(t('domRemoved'));
            await load();
          } catch (e) {
            toast((e as Error).message, 'bad');
          }
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  یک دامنه — همان بخشی که تا امروز فقط دامنهٔ اصلی داشت                      */
/* -------------------------------------------------------------------------- */

function DomainCard({
  row,
  canManage,
  quick,
  busy,
  onMakeMain,
  onRemove,
}: {
  row: DomainRow;
  canManage: boolean;
  quick: boolean;
  busy: boolean;
  onMakeMain: () => void;
  onRemove: () => void;
}) {
  const { t } = useApp();
  const meta = SOURCE[row.source];

  return (
    <Card className={row.main ? 'card-raised' : ''}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {row.main && <Star className="h-4 w-4 shrink-0" style={{ color: 'var(--accent)' }} />}
            <span className="ltr truncate font-mono text-[15px] font-semibold text-ink">{row.hostname}</span>
            <Badge tone={meta.tone}>{meta.label}</Badge>
            {row.site && <Badge tone="neutral">{row.site}</Badge>}
          </div>

          {/* وضعیت — سه چیزی که آدم واقعاً دنبالش می‌گردد */}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
            <StatusLine
              ok={row.dnsRouted}
              okText={t('domDnsOk')}
              badText={t('domDnsMissing')}
            />
            <StatusLine
              ok={row.servedByTunnel}
              okText={t('domServed')}
              badText={row.protected ? t('domProtected') : t('domNotServed')}
            />
            <span className="tnum text-ink-muted">
              {t('domTarget')}: <span className="ltr font-mono">127.0.0.1:{row.port}</span>
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-1.5">
          {canManage && !row.main && !quick && !row.protected && (
            <ActionButton className="btn btn-sm" busyLabel="…" disabled={busy} onClick={onMakeMain}>
              <Star className="h-3.5 w-3.5" />
              {t('domMakeMain')}
            </ActionButton>
          )}
          {canManage && meta.removable && (
            <ActionButton className="btn btn-sm btn-danger" onClick={onRemove}>
              <Trash2 className="h-3.5 w-3.5" />
            </ActionButton>
          )}
        </div>
      </div>

      {/* آدرس — دقیقاً همان چیزی که در برنامه و مرورگر به کار می‌رود */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code
          className="ltr min-w-0 flex-1 truncate rounded-lg border border-line px-3 py-2 font-mono text-xs"
          style={{ background: 'var(--surface-sunken)' }}
        >
          {row.url}
        </code>
        <button
          className="btn btn-sm"
          onClick={() => {
            navigator.clipboard?.writeText(row.url).then(
              () => toast(t('copied')),
              () => toast(t('error'), 'bad')
            );
          }}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
        <a className="btn btn-sm" href={row.url} target="_blank" rel="noreferrer">
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      {row.main && (
        <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
          <Server className="me-1 inline h-3 w-3" />
          {t('domMainHint')}
        </p>
      )}

      {row.protected && <Notice tone="warn">{t('domProtectedHint')}</Notice>}
    </Card>
  );
}

function StatusLine({ ok, okText, badText }: { ok: boolean; okText: string; badText: string }) {
  return (
    <span className="inline-flex items-center gap-1" style={{ color: ok ? 'var(--status-good)' : 'var(--status-warning)' }}>
      {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
      {ok ? okText : badText}
    </span>
  );
}
