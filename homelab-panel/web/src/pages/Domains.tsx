import { useCallback, useEffect, useState } from 'react';
import { Globe, Pencil, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { useApp } from '../app-context';
import { api, ApiError } from '../api';
import type { Domain, Site } from '../types';
import { Badge, Card, ConfirmDialog, Empty, Field, Loading, Modal, StatusDot, toast } from '../components/ui';
import { dateOnly } from '../format';

export default function Domains() {
  const { t, lang } = useApp();
  const [domains, setDomains] = useState<Domain[] | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [checking, setChecking] = useState<number | 'all' | null>(null);
  const [deleteFor, setDeleteFor] = useState<Domain | null>(null);
  const [renameFor, setRenameFor] = useState<Domain | null>(null);

  const load = useCallback(async () => {
    const [d, s] = await Promise.all([
      api<{ domains: Domain[] }>('/api/domains'),
      api<{ sites: Site[] }>('/api/sites'),
    ]);
    setDomains(d.domains);
    setSites(s.sites);
  }, []);

  useEffect(() => {
    load().catch(() => setDomains([]));
  }, [load]);

  async function check(id: number) {
    setChecking(id);
    try {
      await api(`/api/domains/${id}/check`, { method: 'POST' });
      await load();
    } catch {
      toast(t('error'), 'bad');
    } finally {
      setChecking(null);
    }
  }

  async function checkAll() {
    setChecking('all');
    try {
      const res = await api<{ domains: Domain[] }>('/api/domains/check-all', { method: 'POST' });
      setDomains(res.domains);
    } catch {
      toast(t('error'), 'bad');
    } finally {
      setChecking(null);
    }
  }

  /** همان دامنه، سایتِ دیگر — بدون حذف و ساخت دوباره */
  async function repoint(domain: Domain, value: string) {
    const siteId = value ? Number(value) : null;
    if (siteId === domain.siteId) return;
    try {
      await api(`/api/domains/${domain.id}`, { method: 'PUT', body: { siteId } });
      await load();
      toast(t('domainMoved'));
    } catch {
      toast(t('error'), 'bad');
    }
  }

  if (!domains) return <Loading />;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-base font-semibold">{t('domains')}</h1>
        <div className="flex gap-2">
          <button className="btn btn-sm" disabled={checking === 'all' || !domains.length} onClick={checkAll}>
            <RefreshCw className={`h-3.5 w-3.5 ${checking === 'all' ? 'animate-spin' : ''}`} />
            {checking === 'all' ? t('checking') : t('checkAll')}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            {t('addDomain')}
          </button>
        </div>
      </div>

      {!domains.length ? (
        <Card>
          <Empty icon={<Globe className="h-8 w-8" />} title={t('noDomains')} />
        </Card>
      ) : (
        <Card className="!p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] text-ink-muted">
                  <Th>{t('domain')}</Th>
                  <Th>{t('status')}</Th>
                  <Th>{t('dns')}</Th>
                  <Th>{t('ssl')}</Th>
                  <Th>{t('sslExpiry')}</Th>
                  <Th>{t('registrationExpiry')}</Th>
                  <Th>{t('connectedSite')}</Th>
                  <Th>{t('actions')}</Th>
                </tr>
              </thead>
              <tbody>
                {domains.map((d) => (
                  <tr key={d.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2.5">
                      <a
                        className="font-medium hover:underline"
                        href={`https://${d.name}`}
                        target="_blank"
                        rel="noreferrer"
                        dir="ltr"
                      >
                        {d.name}
                      </a>
                      {/*
                        آدرسی که در برنامهٔ موبایل گذاشته می‌شود. همین‌جا
                        نشان داده می‌شود تا کسی دنبالش نگردد — خودکار از
                        همین دامنه ساخته شده.
                      */}
                      {d.apiUrl && (
                        <div className="mt-0.5 text-[11px] text-ink-muted" dir="ltr">
                          <span className="font-mono">{d.apiUrl}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusDot online={d.online} label={d.online ? t('online') : t('offline')} />
                    </td>
                    <td className="px-3 py-2.5">
                      {d.dns ? (
                        <Badge tone={d.dns.status === 'ok' ? 'good' : 'bad'}>
                          {d.dns.status}
                          {d.dns.records?.a?.length ? ` · ${d.dns.records.a[0]}` : ''}
                        </Badge>
                      ) : (
                        <span className="text-[11px] text-ink-muted">{t('neverChecked')}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {d.ssl ? (
                        <Badge tone={d.ssl.status === 'valid' ? 'good' : d.ssl.status === 'expired' ? 'bad' : 'warn'}>
                          <ShieldCheck className="h-3 w-3" />
                          {d.ssl.status}
                        </Badge>
                      ) : (
                        <span className="text-[11px] text-ink-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <Expiry ts={d.ssl?.expiresAt ?? null} days={d.ssl?.daysLeft ?? null} lang={lang} t={t} />
                    </td>
                    <td className="px-3 py-2.5">
                      <Expiry ts={d.registrationExpiresAt} days={d.registrationDaysLeft} lang={lang} t={t} />
                    </td>
                    <td className="px-3 py-2.5">
                      {/* همین دامنه، سایتِ دیگر — فقط با عوض کردن همین انتخاب */}
                      <select
                        className="input !py-1 text-xs"
                        value={d.siteId ?? ''}
                        onChange={(e) => repoint(d, e.target.value)}
                      >
                        <option value="">{t('notConnected')}</option>
                        {sites.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                            {s.port ? ` · ${s.port}` : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex gap-1.5">
                        <button className="btn btn-sm" disabled={checking === d.id} onClick={() => check(d.id)}>
                          <RefreshCw className={`h-3.5 w-3.5 ${checking === d.id ? 'animate-spin' : ''}`} />
                        </button>
                        <button className="btn btn-sm" onClick={() => setRenameFor(d)} title={t('renameDomain')}>
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button className="btn btn-sm" onClick={() => setDeleteFor(d)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <AddDomainModal open={addOpen} onClose={() => setAddOpen(false)} onDone={load} sites={sites} />
      {renameFor && (
        <RenameDomainModal domain={renameFor} onClose={() => setRenameFor(null)} onDone={load} />
      )}
      <ConfirmDialog
        open={Boolean(deleteFor)}
        danger
        title={t('delete')}
        message={t('deleteConfirm', { name: deleteFor?.name || '' })}
        onCancel={() => setDeleteFor(null)}
        onConfirm={async () => {
          if (!deleteFor) return;
          await api(`/api/domains/${deleteFor.id}`, { method: 'DELETE' });
          setDeleteFor(null);
          await load();
        }}
      />
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-start font-medium">{children}</th>;
}

function Expiry({
  ts,
  days,
  lang,
  t,
}: {
  ts: number | null;
  days: number | null;
  lang: any;
  t: (k: any, v?: any) => string;
}) {
  if (!ts) return <span className="text-[11px] text-ink-muted">—</span>;
  const tone = days == null ? 'neutral' : days < 0 ? 'bad' : days < 21 ? 'warn' : 'good';
  return (
    <div className="flex flex-col gap-0.5">
      <span className="tnum text-xs">{dateOnly(ts, lang)}</span>
      <Badge tone={tone as any}>{days != null && days < 0 ? t('expired') : t('daysLeft', { n: days ?? 0 })}</Badge>
    </div>
  );
}

/** تغییر نامِ خودِ دامنه — بدون این که وصل بودنش به سایت از دست برود */
function RenameDomainModal({
  domain,
  onClose,
  onDone,
}: {
  domain: Domain;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { t } = useApp();
  const [name, setName] = useState(domain.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal
      open
      onClose={onClose}
      title={t('renameDomain')}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || !name.trim() || name.trim() === domain.name}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await api(`/api/domains/${domain.id}`, { method: 'PUT', body: { name: name.trim() } });
                await onDone();
                onClose();
                toast(t('saved'));
              } catch (e) {
                const code = e instanceof ApiError ? e.code : 'error';
                setError(code === 'invalid_domain' ? t('invalidDomain') : code);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('save')}
          </button>
        </>
      }
    >
      <Field label={t('domain')}>
        <input className="input font-mono" dir="ltr" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      {error && <p className="text-xs" style={{ color: 'var(--status-critical)' }}>{error}</p>}
    </Modal>
  );
}

function AddDomainModal({
  open,
  onClose,
  onDone,
  sites,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => Promise<void>;
  sites: Site[];
}) {
  const { t } = useApp();
  const [name, setName] = useState('');
  const [siteId, setSiteId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('addDomain')}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || !name.trim()}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await api('/api/domains', { body: { name, siteId: siteId ? Number(siteId) : null } });
                await onDone();
                setName('');
                setSiteId('');
                onClose();
              } catch (e) {
                setError(e instanceof ApiError ? e.code : t('error'));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('add')}
          </button>
        </>
      }
    >
      <Field label={t('domain')}>
        <input className="input" dir="ltr" value={name} onChange={(e) => setName(e.target.value)} placeholder="example.com" autoFocus />
      </Field>
      <Field label={t('connectedSite')}>
        <select className="input" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
          <option value="">—</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      {error && <p className="text-xs" style={{ color: 'var(--status-critical)' }}>{error}</p>}
    </Modal>
  );
}
