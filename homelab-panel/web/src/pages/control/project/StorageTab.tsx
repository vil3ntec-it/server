// ---------------------------------------------------------------------------
//  زبانهٔ انبارِ یک پروژه — بکاپ، بازگردانی و انتشارها
//  ترتیبِ بازگردانی: بررسی سلامت ← پیش‌نمایش ← تأیید ← بازگردانی
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { Archive, Download, Package, Plus, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react';
import { useApp } from '../../../app-context';
import { Card, Field, Modal, toast } from '../../../components/ui';
import { bytes, dateTime } from '../../../format';
import { cc, type ProjectBundle, type RestorePreview, type ValidationResult } from '../../../control/api';
import type { Backup, Release } from '../../../control/types';
import { ActionButton, Cell, Notice, Row, Select, Table } from '../../../control/ui';

export default function StorageTab({ bundle, reload }: { bundle: ProjectBundle; reload: () => void }) {
  const { t, lang } = useApp();
  const id = bundle.project.project_id;
  const [backups, setBackups] = useState<Backup[]>(bundle.backups);
  const [releases, setReleases] = useState<Release[]>(bundle.releases);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [channels, setChannels] = useState<string[]>([]);
  const [releaseDir, setReleaseDir] = useState('');
  const [unregistered, setUnregistered] = useState<{ name: string; path: string; size: number }[]>([]);
  const [restore, setRestore] = useState<{ backup: Backup; validation: ValidationResult; preview: RestorePreview | null } | null>(null);
  const [releaseOpen, setReleaseOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [b, r] = await Promise.all([cc.projectBackups(id), cc.releases(id)]);
      setBackups(b.backups);
      setReleases(r.releases);
      setPlatforms(r.platforms);
      setChannels(r.channels);
      setReleaseDir(r.dir);
      setUnregistered(r.unregistered);
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      {/* ─────────────────────── بکاپ‌ها ─────────────────────── */}
      <Card
        title={t('ccBackups')}
        icon={<Archive className="h-4 w-4" />}
        action={
          <ActionButton
            className="btn btn-sm btn-primary"
            busyLabel="…"
            onClick={async () => {
              try {
                const res = await cc.createBackup(id);
                toast(`${res.backup.filename} · ${bytes(res.backup.size)}`);
                load();
                reload();
              } catch (e) {
                toast((e as Error).message, 'bad');
              }
            }}
          >
            <Plus className="h-4 w-4" />
            {t('ccNewBackup')}
          </ActionButton>
        }
      >
        <Table head={[t('lastUpdate'), t('ccKind'), t('size'), t('ccFiles'), t('status'), '']} empty={backups.length === 0}>
          {backups.map((b) => (
            <Row key={b.id}>
              <Cell className="text-xs">{dateTime(b.created_at, lang)}</Cell>
              <Cell>
                <span className="chip" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>{b.kind}</span>
              </Cell>
              <Cell className="tnum">{bytes(b.size)}</Cell>
              <Cell className="tnum">{b.entries ?? '—'}</Cell>
              <Cell>
                <span style={{ color: b.status === 'ok' ? 'var(--status-good)' : 'var(--status-critical)' }}>{b.status}</span>
                {b.file_exists === false && <span className="ms-1 text-[10px]" style={{ color: 'var(--status-critical)' }}>!</span>}
              </Cell>
              <Cell>
                <div className="flex flex-wrap justify-end gap-1">
                  <ActionButton
                    busyLabel="…"
                    title={t('ccRestore')}
                    onClick={async () => {
                      try {
                        const res = await cc.previewRestore(id, b.id);
                        setRestore({ backup: b, validation: res.validation, preview: res.preview });
                      } catch (e) {
                        toast((e as Error).message, 'bad');
                      }
                    }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </ActionButton>
                  <a className="btn btn-sm" href={cc.backupDownloadUrl(id, b.id)} title={t('download')}>
                    <Download className="h-3.5 w-3.5" />
                  </a>
                  <ActionButton
                    onClick={async () => {
                      await cc.deleteBackup(id, b.id);
                      load();
                      reload();
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </ActionButton>
                </div>
              </Cell>
            </Row>
          ))}
        </Table>
      </Card>

      {/* ─────────────────────── انتشارها ─────────────────────── */}
      <Card
        title={t('ccReleases')}
        icon={<Package className="h-4 w-4" />}
        action={
          <button className="btn btn-sm" onClick={() => setReleaseOpen(true)}>
            <Plus className="h-4 w-4" />
            {t('ccNewRelease')}
          </button>
        }
      >
        <p dir="ltr" className="mb-3 break-all font-mono text-[11px] text-ink-muted">{releaseDir}</p>
        <Table head={[t('ccPlatform'), t('ccVersion'), t('ccChannel'), t('size'), t('ccPublished'), '']} empty={releases.length === 0}>
          {releases.map((r) => (
            <Row key={r.id}>
              <Cell>{r.platform}</Cell>
              <Cell className="tnum font-semibold">
                {r.version}
                {r.build ? <span className="ms-1 text-[10px] text-ink-muted">({r.build})</span> : null}
              </Cell>
              <Cell>{r.channel}</Cell>
              <Cell className="tnum">{r.file_size ? bytes(r.file_size) : '—'}</Cell>
              <Cell>
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={Boolean(r.published)}
                    onChange={async (e) => {
                      await cc.updateRelease(id, r.id, { published: e.target.checked });
                      load();
                    }}
                  />
                  {r.mandatory ? <span style={{ color: 'var(--status-warning)' }}>{t('ccMandatory')}</span> : null}
                </label>
              </Cell>
              <Cell>
                <div className="flex justify-end gap-1">
                  <ActionButton
                    title={t('ccValidate')}
                    busyLabel="…"
                    onClick={async () => {
                      const res = await cc.verifyRelease(id, r.id);
                      toast(res.ok ? t('ccBackupHealthy') : res.error || t('ccBackupBroken'), res.ok ? 'good' : 'bad');
                    }}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                  </ActionButton>
                  <ActionButton onClick={async () => { await cc.deleteRelease(id, r.id); load(); }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </ActionButton>
                </div>
              </Cell>
            </Row>
          ))}
        </Table>
      </Card>

      {/* ─────────────────────── بازگردانی ─────────────────────── */}
      <Modal
        open={Boolean(restore)}
        onClose={() => setRestore(null)}
        title={t('ccRestore')}
        wide
        footer={
          <>
            <button className="btn" onClick={() => setRestore(null)}>{t('cancel')}</button>
            <ActionButton
              className="btn btn-danger"
              disabled={!restore?.validation.ok}
              busyLabel="…"
              onClick={async () => {
                if (!restore) return;
                try {
                  const res = await cc.restoreBackup(id, restore.backup.id);
                  toast(`${t('ccRestore')} ✓`);
                  void res;
                  setRestore(null);
                  load();
                  reload();
                } catch (e) {
                  toast((e as Error).message, 'bad');
                }
              }}
            >
              {t('ccRestore')}
            </ActionButton>
          </>
        }
      >
        {restore && (
          <>
            {restore.validation.ok ? (
              <Notice tone="warn">{t('ccRestoreWarn')}</Notice>
            ) : (
              <Notice tone="bad">
                {t('ccBackupBroken')}: {restore.validation.errors.join(', ')}
              </Notice>
            )}
            <div className="mb-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <Stat label={t('ccFiles')} value={restore.preview?.totalFiles ?? 0} />
              <Stat label={t('size')} value={bytes(restore.preview?.totalBytes ?? 0)} />
              <Stat label={t('ccValidate')} value={restore.validation.checksumOk ? '✓' : '—'} />
              <Stat label={t('ccUsers')} value={restore.preview?.dataset?.counts?.cc_app_users ?? 0} />
            </div>
            {restore.preview && (
              <>
                <p className="mb-1.5 text-xs font-medium text-ink-soft">{t('ccPreview')}</p>
                <ul className="mb-3 space-y-1">
                  {Object.entries(restore.preview.folders).map(([folder, info]) => (
                    <li key={folder} className="flex items-center justify-between gap-2 rounded-lg border border-line px-2.5 py-1.5 text-xs">
                      <span dir="ltr" className="font-mono">{folder}/</span>
                      <span className="tnum text-ink-muted">
                        {info.files} {t('ccFiles')} · {bytes(info.bytes)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p dir="ltr" className="break-all rounded-xl bg-surface-sunken p-2.5 font-mono text-[11px]">
                  {restore.preview.willReplace.directory}
                </p>
              </>
            )}
          </>
        )}
      </Modal>

      <ReleaseModal
        open={releaseOpen}
        onClose={() => setReleaseOpen(false)}
        projectId={id}
        platforms={platforms}
        channels={channels}
        dir={releaseDir}
        unregistered={unregistered}
        onSaved={() => {
          setReleaseOpen(false);
          load();
        }}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line p-2.5">
      <p className="text-[10px] text-ink-muted">{label}</p>
      <p className="tnum text-sm font-semibold">{value}</p>
    </div>
  );
}

function ReleaseModal({
  open, onClose, projectId, platforms, channels, dir, unregistered, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  platforms: string[];
  channels: string[];
  dir: string;
  unregistered: { name: string; path: string; size: number }[];
  onSaved: () => void;
}) {
  const { t } = useApp();
  const [form, setForm] = useState({ platform: 'android', version: '', build: '', channel: 'stable', file_path: '', min_version: '', notes: '', mandatory: false, published: false });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('ccNewRelease')}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('cancel')}</button>
          <ActionButton
            className="btn btn-primary"
            onClick={async () => {
              if (!form.version.trim()) return toast(t('ccRequired'), 'bad');
              try {
                await cc.addRelease(projectId, { ...form, file_path: form.file_path || null });
                setForm({ ...form, version: '', build: '', file_path: '', notes: '' });
                onSaved();
              } catch (e) {
                toast((e as Error).message, 'bad');
              }
            }}
          >
            {t('add')}
          </ActionButton>
        </>
      }
    >
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label={t('ccPlatform')}>
          <Select value={form.platform} onChange={(v) => setForm({ ...form, platform: v })} options={platforms.map((x) => ({ value: x, label: x }))} />
        </Field>
        <Field label={t('ccChannel')}>
          <Select value={form.channel} onChange={(v) => setForm({ ...form, channel: v })} options={channels.map((x) => ({ value: x, label: x }))} />
        </Field>
        <Field label={t('ccVersion')}>
          <input dir="ltr" className="input tnum" placeholder="1.0.0" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} autoFocus />
        </Field>
        <Field label="Build">
          <input dir="ltr" className="input tnum" value={form.build} onChange={(e) => setForm({ ...form, build: e.target.value })} />
        </Field>
      </div>
      <Field label={t('ccMinVersion')}>
        <input dir="ltr" className="input tnum" value={form.min_version} onChange={(e) => setForm({ ...form, min_version: e.target.value })} />
      </Field>
      <Field label="فایل" hint={`فایل باید داخل ${dir} باشد`}>
        {unregistered.length > 0 ? (
          <Select
            value={form.file_path}
            onChange={(v) => setForm({ ...form, file_path: v })}
            options={unregistered.map((f) => ({ value: f.path, label: `${f.name} — ${bytes(f.size)}` }))}
            placeholder="—"
          />
        ) : (
          <input dir="ltr" className="input font-mono text-xs" value={form.file_path} onChange={(e) => setForm({ ...form, file_path: e.target.value })} />
        )}
      </Field>
      <Field label={t('ccReleaseNotes')}>
        <textarea className="input" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </Field>
      <label className="mb-2 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} />
        {t('ccPublished')}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.mandatory} onChange={(e) => setForm({ ...form, mandatory: e.target.checked })} />
        {t('ccMandatory')}
      </label>
    </Modal>
  );
}
