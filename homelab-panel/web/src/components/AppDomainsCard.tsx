// ---------------------------------------------------------------------------
//  «دامنه‌های هر برنامه» (1.50.99) — سرور: ‎/api/app-domains‎ (routes/app-domains.js، src/app-hosts.js)
//
//  هر برنامهٔ همین سرور (سرورِ حساب، هر سایت، پمپ‌ها — فقط داده) یک نامِ اصلی و هر چند نامِ دیگر. افزودن، برداشتن و «اصلی
//  کن» فقط مالک؛ هر کدام احرازِ دوباره می‌خواهد (`api()` خودش پنجرهٔ رمز را باز می‌کند) و در دفتر می‌نشیند. سرور نام را
//  می‌سنجد (punycode، بی ستاره…)، «یک نام یک صاحب» و «آخرین نامِ برنامهٔ روشن» را نگه می‌دارد، و اگر مسیرِ تونل نوشته نشود
//  همه را برمی‌گرداند — این صفحه فقط همان پیام‌ها را نشان می‌دهد.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { Globe, Plus, Star, Trash2 } from 'lucide-react';
import { api, ApiError } from '../api';
import { useLive } from '../useLive';
import { useApp } from '../app-context';
import { Badge, Card, ConfirmDialog, CopyButton, toast } from './ui';
import { Notice } from '../control/ui';

type Host = { hostname: string; display: string; primary: boolean; auto: boolean };
type AppHosts = {
  app: string;
  kind: 'site' | 'account' | 'stations';
  label: string;
  running: boolean;
  primary: string | null;
  hostnames: Host[];
  dataOnly?: boolean;
  count?: number;
};
type RouteStep = { hostname: string | null; how: 'auto' | 'cname' | 'public-hostname' | 'a-record' | 'no-hostname'; done: boolean; tunnel?: string | null; command?: string; port?: number | null };
type View = { apps: AppHosts[]; route: { mode: string; tunnelName: string | null; auto: boolean }; publicBaseUrls: string[]; maxPerApp: number };

function errText(e: unknown): string {
  if (e instanceof ApiError) return e.message && e.message !== e.code ? e.message : e.code;
  return e instanceof Error ? e.message : String(e);
}

export function AppDomainsCard() {
  const { t } = useApp();
  const [data, setData] = useState<View | null>(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [asPrimary, setAsPrimary] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState('');
  const [steps, setSteps] = useState<{ app: string; steps: RouteStep[] } | null>(null);
  const [removing, setRemoving] = useState<{ app: AppHosts; host: Host } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<View>('/api/app-domains'));
      setError('');
    } catch (e) {
      setError(errText(e));
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  //  هر تغییرِ نام ‎fleet‎ و ‎sites‎ را بیدار می‌کند (app-hosts.js)
  useLive(['fleet', 'sites'], load, 0);

  const add = async (a: AppHosts) => {
    const hostname = (draft[a.app] || '').trim();
    if (!hostname) return;
    setBusy(a.app);
    try {
      const r = await api<{ hostname: string; display: string; protected?: boolean; accountRestarted?: boolean; route?: { steps: RouteStep[]; manual: number } }>(
        '/api/app-domains', { body: { app: a.app, hostname, primary: Boolean(asPrimary[a.app]) } },
      );
      setDraft((d) => ({ ...d, [a.app]: '' }));
      toast(t('adAdded', { h: r.display }));
      if (r.protected) toast(t('adProtected'));
      if (r.accountRestarted) toast(t('adAccountRestarted'));
      setSteps(r.route && r.route.manual > 0 ? { app: a.app, steps: r.route.steps.filter((s) => !s.done) } : null);
    } catch (e) {
      toast(errText(e), 'bad');
    } finally {
      setBusy('');
      load();
    }
  };

  const makePrimary = async (a: AppHosts, h: Host) => {
    setBusy(a.app);
    try {
      await api('/api/app-domains/primary', { method: 'PUT', body: { app: a.app, hostname: h.hostname } });
      toast(t('adPrimarySet', { h: h.display }));
    } catch (e) {
      toast(errText(e), 'bad');
    } finally {
      setBusy('');
      load();
    }
  };

  const remove = async () => {
    const p = removing;
    setRemoving(null);
    if (!p) return;
    setBusy(p.app.app);
    try {
      await api('/api/app-domains', { method: 'DELETE', body: { app: p.app.app, hostname: p.host.hostname } });
      toast(t('adRemoved', { h: p.host.display }));
    } catch (e) {
      toast(errText(e), 'bad');
    } finally {
      setBusy('');
      load();
    }
  };

  if (!data) return error ? <Card title={t('adTitle')} icon={<Globe className="h-4 w-4" />}><Notice tone="bad">{error}</Notice></Card> : null;

  return (
    <>
      <Card title={t('adTitle')} icon={<Globe className="h-4 w-4" />}>
        <p className="mb-2 text-xs leading-6 text-ink-soft">{t('adIntro', { n: data.maxPerApp })}</p>
        <Notice tone={data.route.auto ? 'good' : 'warn'}>
          {data.route.auto ? t('adRouteAuto', { name: data.route.tunnelName || '' }) : t('adRouteManual')}
        </Notice>

        <div className="mt-3 flex flex-col gap-3">
          {data.apps.map((a) => (
            <div key={a.app} className="rounded-xl border border-line p-3" style={{ background: 'var(--surface-0)' }}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink">{a.label}</span>
                <Badge tone={a.running ? 'good' : 'neutral'}>{a.running ? t('adRunning') : t('adStopped')}</Badge>
                {a.dataOnly && <span className="text-[11px] text-ink-muted">{t('adDataOnly')}</span>}
              </div>

              {a.hostnames.length ? (
                <ul className="mb-2 space-y-1.5">
                  {a.hostnames.map((h) => (
                    <li key={h.hostname} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-2.5 py-1.5">
                      <span className="min-w-0 flex-1 truncate font-mono text-xs" dir="ltr" title={h.hostname}>
                        {h.display}{h.display !== h.hostname ? <span className="text-ink-muted"> ({h.hostname})</span> : null}
                      </span>
                      {h.primary && <Badge tone="info">{t('adPrimary')}</Badge>}
                      {h.auto && <Badge>{t('adAuto')}</Badge>}
                      {!h.primary && (
                        <button className="btn btn-sm" disabled={busy === a.app} onClick={() => makePrimary(a, h)}>
                          <Star className="h-3.5 w-3.5" /> {t('adMakePrimary')}
                        </button>
                      )}
                      {!h.auto && (
                        <button className="btn btn-sm" disabled={busy === a.app} onClick={() => setRemoving({ app: a, host: h })} aria-label={t('adRemove')}>
                          <Trash2 className="h-3.5 w-3.5" /> {t('adRemove')}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mb-2 text-[11px] text-ink-muted">{t('adNone')}</p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="input min-w-[14rem] flex-1 font-mono text-xs"
                  dir="ltr"
                  placeholder="shop.example.com"
                  value={draft[a.app] || ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [a.app]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') add(a); }}
                  aria-label={`${t('adAdd')} — ${a.label}`}
                />
                <label className="flex items-center gap-1 text-[11px] text-ink-soft">
                  <input type="checkbox" checked={Boolean(asPrimary[a.app])} onChange={(e) => setAsPrimary((p) => ({ ...p, [a.app]: e.target.checked }))} />
                  {t('adAsPrimary')}
                </label>
                <button className="btn btn-primary btn-sm" disabled={busy === a.app || !(draft[a.app] || '').trim()} onClick={() => add(a)}>
                  <Plus className="h-3.5 w-3.5" /> {t('adAdd')}
                </button>
              </div>

              {steps?.app === a.app && steps.steps.length > 0 && (
                <div className="mt-2">
                  <Notice tone="warn">
                    <p className="mb-1 font-medium">{t('adManualStep')}</p>
                    <ul className="space-y-1 text-[11px] leading-5">
                      {steps.steps.map((s) => (
                        <li key={`${s.hostname}-${s.how}`}>
                          {s.how === 'cname' && <>{t('adStepCname', { h: s.hostname || '', tunnel: s.tunnel || '' })} <code dir="ltr" className="font-mono">{s.command}</code></>}
                          {s.how === 'public-hostname' && t('adStepPublic', { h: s.hostname || '', port: String(s.port ?? '') })}
                          {s.how === 'a-record' && t('adStepA', { h: s.hostname || '' })}
                        </li>
                      ))}
                    </ul>
                  </Notice>
                </div>
              )}

              {a.kind === 'account' && data.publicBaseUrls.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
                  <span>{t('adPublicUrls')}</span>
                  <code dir="ltr" className="font-mono text-ink">{data.publicBaseUrls.join(',')}</code>
                  <CopyButton value={data.publicBaseUrls.join(',')} />
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>
      <ConfirmDialog
        open={Boolean(removing)}
        title={removing ? t('adRemoveQ', { h: removing.host.display, app: removing.app.label }) : ''}
        message={t('adRemoveMsg')}
        danger
        onConfirm={remove}
        onCancel={() => setRemoving(null)}
      />
    </>
  );
}
