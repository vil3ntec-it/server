// ---------------------------------------------------------------------------
//  به‌روزرسانی از GitHub — بررسی، نصب، برگشت
//  پیش از هر نصب، از کلِ برنامه بکاپ گرفته می‌شود و data/ و .env دست نمی‌خورند.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { Download, GitBranch, RefreshCw, RotateCcw, Tag } from 'lucide-react';
import { useApp } from '../../app-context';
import { Card, Field, Loading, Modal, toast } from '../../components/ui';
import { dateTime, relative } from '../../format';
import { cc } from '../../control/api';
import type { UpdateInfo, UpdateStatus } from '../../control/types';
import { ActionButton, KV, Notice, Select } from '../../control/ui';

type Step = { name: string; status: string; detail: unknown; at: number };

export default function Updates() {
  const { t, lang } = useApp();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [pending, setPending] = useState<{ latest: string; at: number } | null>(null);
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [restarting, setRestarting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await cc.updateStatus();
      setStatus(res.status);
      setPending(res.pending);
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // بعد از نصب، پنل خودش را بالا می‌آورد؛ منتظر می‌مانیم تا برگردد
  useEffect(() => {
    if (!restarting) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch('/health', { cache: 'no-store' });
        if (res.ok) {
          setRestarting(false);
          window.location.reload();
        }
      } catch {
        /* هنوز بالا نیامده */
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [restarting]);

  if (loading || !status) return <Loading />;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">{t('ccUpdates')}</h1>

      {restarting && <Notice tone="warn">{t('ccRestartNotice')}</Notice>}

      <Card
        title={t('ccUpdates')}
        icon={status.channel === 'branch' ? <GitBranch className="h-4 w-4" /> : <Tag className="h-4 w-4" />}
        action={
          <div className="flex gap-2">
            <button className="btn btn-sm" onClick={() => setSettingsOpen(true)}>
              {t('settings')}
            </button>
            <ActionButton
              className="btn btn-sm"
              busyLabel="…"
              onClick={async () => {
                try {
                  const res = await cc.checkUpdate();
                  setInfo(res);
                  if (res.error) toast(res.error, 'bad');
                  else toast(res.available ? t('ccUpdateAvailable') : t('ccUpToDate'), res.available ? 'bad' : 'good');
                  load();
                } catch (e) {
                  const message = (e as Error).message;
                  toast(
                    message.includes('package_incomplete')
                      ? t('ccUpdateIncomplete')
                      : message.includes('needs_installer')
                        ? t('ccUpdateNeedsInstaller')
                        : message,
                    'bad',
                  );
                }
              }}
            >
              <RefreshCw className="h-4 w-4" />
              {t('ccCheckUpdate')}
            </ActionButton>
          </div>
        }
      >
        <Notice>{t('ccUpdateWarn')}</Notice>

        <KV label={t('ccRepository')} mono>{status.repo}</KV>
        <KV label={t('ccUpdateChannelRelease')}>{status.channel === 'branch' ? `${t('ccUpdateChannelBranch')} · ${status.branch}` : t('ccUpdateChannelRelease')}</KV>
        <KV label={t('ccCurrentVersion')} mono>{status.current || '—'}{status.build ? ` (${status.build})` : ''}</KV>
        <KV label={t('ccLatestVersion')} mono>{info?.latest || pending?.latest || '—'}</KV>
        <KV label={t('ccLastCheck')}>{status.lastCheck ? relative(status.lastCheck, lang) : t('ccNever')}</KV>
        <KV label={t('lastUpdate')}>{status.installedAt ? dateTime(status.installedAt, lang) : t('ccNever')}</KV>
        <KV label={t('path')} mono>{status.installRoot}</KV>

        {status.layout === 'packaged' && (
          <div className="mt-3">
            <Notice>
              <span className="font-medium">{t('ccUpdateApp')}</span> — {t('ccUpdateAppHow')} {t('ccUpdateAppDeps')}
            </Notice>
          </div>
        )}

        {(info?.available || pending) && (
          <div className="mt-4 rounded-xl border p-3" style={{ borderColor: 'color-mix(in srgb, var(--series-1) 35%, transparent)' }}>
            <p className="mb-2 text-sm font-medium">
              {t('ccUpdateAvailable')} — <span className="tnum">{info?.latest || pending?.latest}</span>
            </p>
            {info?.publishedAt && <p className="mb-2 text-[11px] text-ink-muted">{dateTime(info.publishedAt, lang)}</p>}
            {info?.notes && (
              <pre dir="ltr" className="mb-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-sunken p-2.5 text-[11px] leading-relaxed">
                {info.notes}
              </pre>
            )}
            <ActionButton
              className="btn btn-sm btn-primary"
              busyLabel={t('ccInstalling')}
              onClick={async () => {
                try {
                  const res = await cc.installUpdate();
                  if (!res.ok) {
                    toast(res.reason || 'error', 'bad');
                    return;
                  }
                  setSteps((res.steps as Step[]) || []);
                  if (res.restart) setRestarting(true);
                } catch (e) {
                  toast((e as Error).message, 'bad');
                }
              }}
            >
              <Download className="h-4 w-4" />
              {t('ccInstallUpdate')}
            </ActionButton>
          </div>
        )}

        {info && !info.available && !info.error && (
          <p className="mt-3 text-sm" style={{ color: 'var(--status-good)' }}>
            {t('ccUpToDate')}
          </p>
        )}
        {info?.error && (
          <p className="mt-3 text-sm" style={{ color: 'var(--status-critical)' }}>
            {info.error}
          </p>
        )}

        {/*
            برگشت، همسایهٔ دکمهٔ به‌روزرسانی است و کارش درست عکسِ آن: سرور را
            به نسخهٔ قبل می‌برد. یک ضربه بدونِ پرسش، یعنی کسی که اشتباهی زدش
            تازه بعد از راه‌اندازیِ دوباره می‌فهمد چه شد. پس هم می‌گوید چه
            می‌کند، هم یک بار می‌پرسد.
        */}
        {status.lastBackup && (
          <div className="mt-4 border-t border-line pt-3">
            <p className="mb-2 text-[11px] text-ink-muted">{t('ccUpdateRollbackWhat')}</p>
            <p dir="ltr" className="mb-2 break-all font-mono text-[11px] text-ink-muted">{status.lastBackup}</p>
            <ActionButton
              className="btn btn-sm btn-danger"
              busyLabel="…"
              onClick={async () => {
                if (!window.confirm(t('ccUpdateRollbackConfirm'))) return;
                try {
                  await cc.rollbackUpdate();
                  setRestarting(true);
                } catch (e) {
                  toast((e as Error).message, 'bad');
                }
              }}
            >
              <RotateCcw className="h-4 w-4" />
              {t('ccUpdateRollback')}
            </ActionButton>
          </div>
        )}
      </Card>

      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} status={status} onSaved={() => { setSettingsOpen(false); load(); }} />

      <Modal open={Boolean(steps)} onClose={() => setSteps(null)} title={t('ccInstallUpdate')} wide>
        <ul className="space-y-2">
          {steps?.map((s, i) => {
            const color = s.status === 'ok' ? 'var(--status-good)' : s.status === 'error' ? 'var(--status-critical)' : 'var(--status-warning)';
            return (
              <li key={i} className="flex items-start gap-2 rounded-xl border border-line p-2.5 text-xs">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium" style={{ color }}>{s.name} — {s.status}</p>
                  {s.detail != null && (
                    <p dir="ltr" className="mt-0.5 break-all font-mono text-[10px] text-ink-muted">
                      {typeof s.detail === 'string' ? s.detail : JSON.stringify(s.detail)}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {restarting && <Notice tone="warn">{t('ccRestartNotice')}</Notice>}
      </Modal>
    </div>
  );
}

function Settings({ open, onClose, status, onSaved }: { open: boolean; onClose: () => void; status: UpdateStatus; onSaved: () => void }) {
  const { t } = useApp();
  const [form, setForm] = useState({ repo: status.repo, channel: status.channel, branch: status.branch, autoCheck: status.autoCheck, token: '' });

  useEffect(() => {
    if (open) setForm({ repo: status.repo, channel: status.channel, branch: status.branch, autoCheck: status.autoCheck, token: '' });
  }, [open, status]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('settings')}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('cancel')}</button>
          <ActionButton
            className="btn btn-primary"
            onClick={async () => {
              try {
                await cc.updateSettings({
                  repo: form.repo,
                  channel: form.channel,
                  branch: form.branch,
                  autoCheck: form.autoCheck,
                  token: form.token || undefined,
                });
                toast(t('ccSave'));
                onSaved();
              } catch (e) {
                toast((e as Error).message, 'bad');
              }
            }}
          >
            {t('ccSave')}
          </ActionButton>
        </>
      }
    >
      <Field label={t('ccRepository')} hint="owner/repo">
        <input dir="ltr" className="input font-mono text-xs" value={form.repo} onChange={(e) => setForm({ ...form, repo: e.target.value })} />
      </Field>
      <Field label={t('ccUpdateChannelRelease')}>
        <Select
          value={form.channel}
          onChange={(v) => setForm({ ...form, channel: v as UpdateStatus['channel'] })}
          options={[
            { value: 'release', label: t('ccUpdateChannelRelease') },
            { value: 'branch', label: t('ccUpdateChannelBranch') },
          ]}
        />
      </Field>
      {form.channel === 'branch' && (
        <Field label={t('ccUpdateChannelBranch')}>
          <input dir="ltr" className="input font-mono text-xs" value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} />
        </Field>
      )}
      <Field label="GitHub Token" hint={t('ccSecretHint')}>
        <input dir="ltr" type="password" className="input font-mono text-xs" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.autoCheck} onChange={(e) => setForm({ ...form, autoCheck: e.target.checked })} />
        {t('ccAutoCheck')}
      </label>
    </Modal>
  );
}
