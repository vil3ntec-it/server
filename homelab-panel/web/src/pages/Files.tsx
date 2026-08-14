import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Download,
  File as FileIcon,
  FilePen,
  Folder,
  FolderPlus,
  HardDrive,
  RefreshCw,
  Scissors,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { useApp } from '../app-context';
import { api, ApiError, downloadUrl, getToken } from '../api';
import type { FileItem } from '../types';
import { Card, ConfirmDialog, Empty, Field, Loading, Modal, toast } from '../components/ui';
import { bytes, dateTime } from '../format';

type Listing = { path: string; root: string; parent: string | null; items: FileItem[] };

export default function Files() {
  const { t, lang, dir } = useApp();
  const [roots, setRoots] = useState<{ path: string; exists: boolean; label: string }[]>([]);
  const [listing, setListing] = useState<Listing | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FileItem[] | null>(null);
  const [editing, setEditing] = useState<{ path: string; content: string } | null>(null);
  const [renaming, setRenaming] = useState<FileItem | null>(null);
  const [deleting, setDeleting] = useState<FileItem | null>(null);
  const [clipboard, setClipboard] = useState<{ item: FileItem; mode: 'copy' | 'move' } | null>(null);
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (path?: string) => {
    setError(null);
    try {
      const res = await api<Listing>(`/api/files/list${path ? `?path=${encodeURIComponent(path)}` : ''}`);
      setListing(res);
      setCurrent(res.path);
      setResults(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.code : 'error');
    }
  }, []);

  useEffect(() => {
    api<{ roots: { path: string; exists: boolean; label: string }[] }>('/api/files/roots')
      .then((r) => {
        setRoots(r.roots);
        const first = r.roots.find((x) => x.exists) || r.roots[0];
        if (first) load(first.path);
      })
      .catch(() => setError('error'));
  }, [load]);

  async function upload(files: FileList) {
    if (!current) return;
    for (const file of Array.from(files)) {
      try {
        const res = await fetch(
          `/api/files/upload?dir=${encodeURIComponent(current)}&name=${encodeURIComponent(file.name)}`,
          {
            method: 'PUT',
            headers: { Authorization: `Bearer ${getToken()}` },
            body: file,
          }
        );
        if (!res.ok) throw new Error(String(res.status));
      } catch {
        toast(`${file.name} — ${t('error')}`, 'bad');
      }
    }
    toast(t('saved'));
    load(current);
  }

  async function paste() {
    if (!clipboard || !current) return;
    try {
      await api(`/api/files/${clipboard.mode}`, { body: { from: clipboard.item.path, to: current } });
      setClipboard(null);
      load(current);
      toast(t('saved'));
    } catch (e) {
      toast(e instanceof ApiError ? e.code : t('error'), 'bad');
    }
  }

  async function search() {
    if (!current || query.trim().length < 2) return;
    try {
      const res = await api<{ results: FileItem[] }>(
        `/api/files/search?path=${encodeURIComponent(current)}&q=${encodeURIComponent(query.trim())}`
      );
      setResults(res.results);
    } catch (e) {
      toast(e instanceof ApiError ? e.code : t('error'), 'bad');
    }
  }

  const items = results ?? listing?.items ?? [];
  const Back = dir === 'rtl' ? ChevronRight : ChevronLeft;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-base font-semibold">{t('files')}</h1>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-sm" onClick={() => current && load(current)}>
            <RefreshCw className="h-3.5 w-3.5" />
            {t('refresh')}
          </button>
          <button className="btn btn-sm" onClick={() => setMkdirOpen(true)} disabled={!current}>
            <FolderPlus className="h-3.5 w-3.5" />
            {t('newFolder')}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => uploadRef.current?.click()} disabled={!current}>
            <Upload className="h-3.5 w-3.5" />
            {t('upload_')}
          </button>
          <input
            ref={uploadRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && upload(e.target.files)}
          />
        </div>
      </div>

      {/* ریشه‌های مجاز */}
      <div className="flex flex-wrap gap-1.5">
        {roots.map((r) => (
          <button
            key={r.path}
            className={`btn btn-sm ${current?.startsWith(r.path) ? 'btn-primary' : ''}`}
            disabled={!r.exists}
            onClick={() => load(r.path)}
            title={r.path}
          >
            <HardDrive className="h-3.5 w-3.5" />
            <span className="max-w-[180px] truncate font-mono text-[11px]">{r.path}</span>
          </button>
        ))}
      </div>

      <Card className="!p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <button className="btn btn-sm" disabled={!listing?.parent} onClick={() => listing?.parent && load(listing.parent)}>
            <Back className="h-3.5 w-3.5" />
          </button>
          <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-soft" dir="ltr">
            {current || '—'}
          </p>
          {clipboard && (
            <button className="btn btn-sm btn-primary" onClick={paste}>
              <Clipboard className="h-3.5 w-3.5" />
              {clipboard.mode === 'copy' ? t('copyHere') : t('moveHere')}
            </button>
          )}
          <div className="flex items-center gap-1.5">
            <input
              className="input w-40 py-1.5 text-xs sm:w-56"
              placeholder={t('searchPlaceholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()}
            />
            <button className="btn btn-sm" onClick={search}>
              <Search className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {error ? (
          <Empty title={t('error')} hint={error} />
        ) : !listing ? (
          <Loading />
        ) : !items.length ? (
          <Empty icon={<Folder className="h-8 w-8" />} title={results ? t('noData') : t('emptyFolder')} />
        ) : (
          <ul className="divide-y divide-line">
            {items.map((item) => (
              <li key={item.path} className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-raised">
                {item.isDir ? (
                  <Folder className="h-4 w-4 shrink-0" style={{ color: 'var(--series-1)' }} />
                ) : (
                  <FileIcon className="h-4 w-4 shrink-0 text-ink-muted" />
                )}
                <button
                  className="min-w-0 flex-1 truncate text-start text-sm"
                  onClick={() => {
                    if (item.isDir) load(item.path);
                    else if (item.editable) {
                      api<{ content: string }>(`/api/files/read?path=${encodeURIComponent(item.path)}`)
                        .then((r) => setEditing({ path: item.path, content: r.content }))
                        .catch((e) => toast(e instanceof ApiError ? e.code : t('error'), 'bad'));
                    }
                  }}
                >
                  {item.name}
                </button>
                <span className="tnum hidden w-24 text-end text-[11px] text-ink-muted sm:block">
                  {item.isDir ? '—' : bytes(item.size)}
                </span>
                <span className="tnum hidden w-36 text-end text-[11px] text-ink-muted md:block">
                  {dateTime(item.modified, lang)}
                </span>
                <div className="flex shrink-0 gap-1">
                  {!item.isDir && (
                    <a className="btn btn-sm" href={downloadUrl(item.path)} title={t('downloadFile')}>
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  )}
                  <button className="btn btn-sm" title={t('rename')} onClick={() => setRenaming(item)}>
                    <FilePen className="h-3.5 w-3.5" />
                  </button>
                  <button
                    className="btn btn-sm"
                    title={t('copy')}
                    onClick={() => {
                      setClipboard({ item, mode: 'copy' });
                      toast(t('pasteTarget', { action: t('copyHere') }));
                    }}
                  >
                    <Clipboard className="h-3.5 w-3.5" />
                  </button>
                  <button
                    className="btn btn-sm"
                    title={t('move')}
                    onClick={() => {
                      setClipboard({ item, mode: 'move' });
                      toast(t('pasteTarget', { action: t('moveHere') }));
                    }}
                  >
                    <Scissors className="h-3.5 w-3.5" />
                  </button>
                  <button className="btn btn-sm" title={t('delete')} onClick={() => setDeleting(item)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ویرایشگر فایل */}
      {editing && (
        <Modal
          open
          wide
          onClose={() => setEditing(null)}
          title={editing.path.split(/[\\/]/).pop() || t('edit')}
          footer={
            <>
              <button className="btn" onClick={() => setEditing(null)}>
                {t('cancel')}
              </button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  try {
                    await api('/api/files/write', { method: 'PUT', body: editing });
                    setEditing(null);
                    toast(t('saved'));
                    current && load(current);
                  } catch (e) {
                    toast(e instanceof ApiError ? e.code : t('error'), 'bad');
                  }
                }}
              >
                {t('save')}
              </button>
            </>
          }
        >
          <textarea
            className="input h-[55vh] font-mono text-xs leading-relaxed"
            dir="ltr"
            value={editing.content}
            onChange={(e) => setEditing({ ...editing, content: e.target.value })}
          />
        </Modal>
      )}

      {/* تغییر نام */}
      {renaming && (
        <RenameModal
          item={renaming}
          onClose={() => setRenaming(null)}
          onDone={() => {
            setRenaming(null);
            current && load(current);
          }}
        />
      )}

      {/* پوشهٔ جدید */}
      {mkdirOpen && current && (
        <MkdirModal
          path={current}
          onClose={() => setMkdirOpen(false)}
          onDone={() => {
            setMkdirOpen(false);
            load(current);
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        danger
        title={t('delete')}
        message={t('deleteConfirm', { name: deleting?.name || '' })}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await api(`/api/files?path=${encodeURIComponent(deleting.path)}`, { method: 'DELETE' });
            toast(t('saved'));
          } catch (e) {
            toast(e instanceof ApiError ? e.code : t('error'), 'bad');
          }
          setDeleting(null);
          current && load(current);
        }}
      />
    </div>
  );
}

function RenameModal({ item, onClose, onDone }: { item: FileItem; onClose: () => void; onDone: () => void }) {
  const { t } = useApp();
  const [name, setName] = useState(item.name);
  return (
    <Modal
      open
      onClose={onClose}
      title={t('rename')}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button
            className="btn btn-primary"
            onClick={async () => {
              try {
                await api('/api/files/rename', { body: { path: item.path, newName: name } });
                onDone();
              } catch (e) {
                toast(e instanceof ApiError ? e.code : t('error'), 'bad');
              }
            }}
          >
            {t('save')}
          </button>
        </>
      }
    >
      <Field label={t('name')}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus dir="ltr" />
      </Field>
    </Modal>
  );
}

function MkdirModal({ path, onClose, onDone }: { path: string; onClose: () => void; onDone: () => void }) {
  const { t } = useApp();
  const [name, setName] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title={t('newFolder')}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button
            className="btn btn-primary"
            disabled={!name.trim()}
            onClick={async () => {
              try {
                await api('/api/files/mkdir', { body: { path, name } });
                onDone();
              } catch (e) {
                toast(e instanceof ApiError ? e.code : t('error'), 'bad');
              }
            }}
          >
            {t('add')}
          </button>
        </>
      }
    >
      <Field label={t('name')}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus dir="ltr" />
      </Field>
    </Modal>
  );
}
