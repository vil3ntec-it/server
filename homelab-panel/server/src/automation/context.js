// ---------------------------------------------------------------------------
//  ctxِ هر اجرا — همان چیزی که run(ctx) و onFail(ctx, err) می‌گیرند
//
//  هر کار به همان ماژول‌های واقعیِ پنل دست دارد (پشتیبان، پایش، نگهبان،
//  گزارش، متریک، سایت‌ها) — نه رونوشتی از منطقشان. قاعدهٔ همیشگی: کارِ
//  اتوماسیون **صدا می‌زند**، دوباره نمی‌نویسد.
// ---------------------------------------------------------------------------
import { db, getSetting, setSetting, logEvent } from '../db.js';
import { config, paths } from '../config.js';
import { createBackup as panelBackup, listBackups as panelBackups, pruneBackups as prunePanelBackups } from '../backup/index.js';
import * as storageBackup from '../storage/backup.js';
import { isConfigured as libraryConfigured, cleanTemp, libraryRoot } from '../storage/library.js';
import * as alerts from '../control/alerts.js';
import * as monitor from '../control/monitor.js';
import * as guard from '../agent/guard.js';
import * as reports from '../agent/reports.js';
import * as metrics from '../metrics/index.js';
import * as siteRegistry from '../sites/registry.js';
import * as siteProcess from '../sites/process.js';
import { workspacePaths } from '../sites/workspace.js';

export const modules = Object.freeze({
  db, config, paths, getSetting, setSetting, logEvent,
  alerts, monitor, guard, reports, metrics,
  sites: siteRegistry, siteProcess, workspacePaths,
  storage: { ...storageBackup, cleanTemp, libraryConfigured, libraryRoot },
  panelBackup: { create: panelBackup, list: panelBackups, prune: prunePanelBackups },
});

/** پروژه‌های مرکز فرمان — همان جدولِ cc_projects، بی هیچ فیلتری */
function listProjects() {
  try {
    return db.prepare('SELECT id, project_id, name, type, status, server_id FROM cc_projects ORDER BY name COLLATE NOCASE').all();
  } catch {
    return [];
  }
}

const backup = {
  /** پشتیبانِ دیتابیسِ پنل (VACUUM INTO) */
  panel: ({ reason = 'scheduled', note = null } = {}) => panelBackup({ reason, note }),
  /** پشتیبانِ انبار: دیتابیس + site-sync + پمپ‌ها + .env — فقط اگر انبار تنظیم شده باشد */
  storage: async ({ kind = 'Daily', note = null } = {}) => {
    if (!libraryConfigured()) return { ok: false, error: 'library_not_configured' };
    return storageBackup.createBackup({ kind, note });
  },
  /** دور ریختنِ کهنه‌ها */
  rotate: async ({ panel = config.backupKeep, Daily = 7, Weekly = 4, Manual = 10 } = {}) => {
    const removedPanel = prunePanelBackups(panel);
    const removedStorage = libraryConfigured() ? (await storageBackup.pruneBackups({ Daily, Weekly, Manual })).removed : [];
    return { panel: removedPanel, storage: removedStorage };
  },
  list: () => ({ panel: panelBackups() }),
};

export function buildContext({ def, runId, trigger, payload, attempt, log, notify, emit }) {
  return {
    job: def.name,
    title: def.title,
    runId,
    trigger,
    payload: payload ?? {},
    attempt,
    log,
    notify,
    emit,
    listProjects,
    listSites: () => siteRegistry.listSitesRaw(),
    backup,
    modules,
  };
}
