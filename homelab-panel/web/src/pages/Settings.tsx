import { useEffect, useRef, useState } from 'react';
import { Image, KeyRound, Monitor, Moon, Palette, Save, Server, Sun, Trash2 } from 'lucide-react';
import { useApp } from '../app-context';
import { api, ApiError, getToken, logoUrl } from '../api';
import { LANGUAGES, type Lang } from '../i18n';
import { Card, Field, Loading, toast } from '../components/ui';
import { dateTime } from '../format';

type SettingsPayload = {
  settings: {
    serverName: string;
    language: Lang;
    theme: 'dark' | 'light' | 'system';
    scanRoots: string[] | null;
    extraFileRoots: string[];
    hasLogo: boolean;
    siteAutoSetup: boolean;
    sitesBaseDomain: string | null;
  };
  paths: {
    dataDir: string;
    sitesRoot: string;
    sitesRootDefault: string;
    sitesRootNextToServer: string;
    uploads: string;
  };
  system: {
    hostname: string;
    platform: string;
    node: string;
    panelPort: number;
    panelVersion: string | null;
    panelBuild: string | null;
    panelRoot: string | null;
  };
};

export default function Settings() {
  const { t, lang, setLang, theme, setTheme, refreshPublic } = useApp();
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [serverName, setServerName] = useState('');
  const [scanRoots, setScanRoots] = useState('');
  const [extraRoots, setExtraRoots] = useState('');
  const [autoSetup, setAutoSetup] = useState(true);
  const [baseDomain, setBaseDomain] = useState('');
  const [sitesRootValue, setSitesRootValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [logoVersion, setLogoVersion] = useState(0);
  const logoRef = useRef<HTMLInputElement>(null);

  const [sessions, setSessions] = useState<{ id: string; created_at: number; user_agent: string; ip: string }[]>([]);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  useEffect(() => {
    api<SettingsPayload>('/api/settings').then((res) => {
      setData(res);
      setServerName(res.settings.serverName);
      setScanRoots((res.settings.scanRoots || []).join('\n'));
      setExtraRoots((res.settings.extraFileRoots || []).join('\n'));
      setAutoSetup(res.settings.siteAutoSetup !== false);
      setBaseDomain(res.settings.sitesBaseDomain || '');
      setSitesRootValue(res.paths.sitesRoot);
    });
    api<{ sessions: any[] }>('/api/auth/me').then((r) => setSessions(r.sessions));
  }, []);

  if (!data) return <Loading />;

  async function save() {
    setBusy(true);
    try {
      await api('/api/settings', {
        method: 'PUT',
        body: {
          serverName,
          language: lang,
          theme,
          scanRoots: scanRoots.split('\n').map((s) => s.trim()).filter(Boolean),
          extraFileRoots: extraRoots.split('\n').map((s) => s.trim()).filter(Boolean),
          siteAutoSetup: autoSetup,
          sitesBaseDomain: baseDomain.trim(),
          sitesRoot: sitesRootValue.trim(),
        },
      });
      await refreshPublic();
      toast(t('saved'));
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      toast(
        code === 'invalid_domain' ? t('invalidDomain') : code === 'cannot_create' ? t('folderNotCreated') : t('error'),
        'bad'
      );
    } finally {
      setBusy(false);
    }
  }

  async function uploadLogo(file: File) {
    try {
      const res = await fetch('/api/settings/logo', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': file.type },
        body: file,
      });
      if (!res.ok) throw new Error();
      setLogoVersion((v) => v + 1);
      await refreshPublic();
      toast(t('saved'));
    } catch {
      toast(t('error'), 'bad');
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-base font-semibold">{t('settings')}</h1>

      <Card title={t('general')} icon={<Server className="h-4 w-4" />}>
        <Field label={t('serverName')}>
          <input className="input" value={serverName} onChange={(e) => setServerName(e.target.value)} />
        </Field>

        <Field label={t('logo')}>
          <div className="flex items-center gap-3">
            {data.settings.hasLogo || logoVersion ? (
              <img
                key={logoVersion}
                src={logoUrl()}
                alt=""
                className="h-12 w-12 rounded-xl border border-line object-cover"
              />
            ) : (
              <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-line text-ink-muted">
                <Image className="h-5 w-5" />
              </span>
            )}
            <button className="btn btn-sm" onClick={() => logoRef.current?.click()}>
              {t('uploadLogo')}
            </button>
            <button
              className="btn btn-sm"
              onClick={async () => {
                await api('/api/settings/logo', { method: 'DELETE' });
                setLogoVersion((v) => v + 1);
                await refreshPublic();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t('removeLogo')}
            </button>
            <input
              ref={logoRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])}
            />
          </div>
        </Field>

        <Field label={t('scanRoots')} hint={t('onePerLine')}>
          <textarea
            className="input h-20 font-mono text-xs"
            dir="ltr"
            value={scanRoots}
            onChange={(e) => setScanRoots(e.target.value)}
            placeholder={data.paths.sitesRoot}
          />
        </Field>

        <Field label={t('extraFileRoots')} hint={t('onePerLine')}>
          <textarea
            className="input h-20 font-mono text-xs"
            dir="ltr"
            value={extraRoots}
            onChange={(e) => setExtraRoots(e.target.value)}
          />
        </Field>

        {/* کجای درایو، پوشهٔ هر سایت ساخته شود */}
        <Field label={t('sitesRoot')} hint={t('sitesRootHint')}>
          <input
            className="input font-mono text-xs"
            dir="ltr"
            value={sitesRootValue}
            onChange={(e) => setSitesRootValue(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-sm mt-2"
            onClick={() => setSitesRootValue(data.paths.sitesRootNextToServer)}
          >
            {t('putNextToServer')}
          </button>
        </Field>

        {/* راه‌اندازی خودکار سایت تازه */}
        <div className="mb-4 rounded-xl border border-line p-3" style={{ background: 'var(--surface-0)' }}>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
              checked={autoSetup}
              onChange={(e) => setAutoSetup(e.target.checked)}
            />
            <span>
              {t('autoSetup')}
              <span className="mt-0.5 block text-[11px] font-normal leading-relaxed text-ink-muted">
                {t('autoSetupHint')}
              </span>
            </span>
          </label>

          <div className="mt-3">
            <label className="label">{t('baseDomain')}</label>
            <p className="mb-1.5 text-[11px] leading-relaxed text-ink-muted">{t('baseDomainHint')}</p>
            <input
              className="input font-mono text-xs"
              dir="ltr"
              placeholder="yaqobipump.top"
              value={baseDomain}
              onChange={(e) => setBaseDomain(e.target.value)}
            />
          </div>
        </div>

        <button className="btn btn-primary" disabled={busy} onClick={save}>
          <Save className="h-3.5 w-3.5" />
          {t('save')}
        </button>
      </Card>

      <Card title={t('theme')} icon={<Palette className="h-4 w-4" />}>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['dark', t('dark'), Moon],
              ['light', t('light'), Sun],
              ['system', t('system'), Monitor],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              className={`btn ${theme === value ? 'btn-primary' : ''}`}
              onClick={() => setTheme(value)}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        <div className="mt-5">
          <span className="label">{t('language')}</span>
          <div className="flex flex-wrap gap-2">
            {LANGUAGES.map((l) => (
              <button
                key={l.code}
                className={`btn ${lang === l.code ? 'btn-primary' : ''}`}
                onClick={() => setLang(l.code)}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card title={t('security')} icon={<KeyRound className="h-4 w-4" />}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('currentPassword')}>
            <input
              className="input"
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              autoComplete="current-password"
            />
          </Field>
          <Field label={t('newPassword')}>
            <input
              className="input"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
        </div>
        <button
          className="btn btn-primary"
          disabled={!oldPassword || newPassword.length < 8}
          onClick={async () => {
            try {
              await api('/api/auth/change-password', { body: { oldPassword, newPassword } });
              setOldPassword('');
              setNewPassword('');
              toast(t('saved'));
            } catch (e) {
              toast(e instanceof ApiError ? e.code : t('error'), 'bad');
            }
          }}
        >
          {t('changePassword')}
        </button>

        {sessions.length > 0 && (
          <>
            <p className="label mt-5">{t('sessions')}</p>
            <ul className="divide-y divide-line text-xs">
              {sessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="truncate text-ink-soft">{s.user_agent || '—'}</span>
                  <span className="tnum shrink-0 text-ink-muted">{dateTime(s.created_at, lang)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card title={t('dataDir')} icon={<Server className="h-4 w-4" />}>
        <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <Row label={t('dataDir')} value={data.paths.dataDir} />
          <Row label={t('sitesRoot')} value={data.paths.sitesRoot} />
          {/* نسخهٔ همین سرورِ در حال اجرا — تا معلوم باشد نسخهٔ تازه بالاست یا قدیمی */}
          <Row
            label={t('panelVersion')}
            value={`${data.system.panelVersion ?? '—'}${data.system.panelBuild ? ` · ${data.system.panelBuild}` : ''}`}
          />
          {data.system.panelRoot && <Row label={t('runningFrom')} value={data.system.panelRoot} />}
          <Row label="hostname" value={data.system.hostname} />
          <Row label="Node.js" value={data.system.node} />
          <Row label={t('port')} value={String(data.system.panelPort)} />
          <Row label="platform" value={data.system.platform} />
        </dl>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-ink-muted">{label}</dt>
      <dd className="truncate font-mono" dir="ltr">
        {value}
      </dd>
    </div>
  );
}
