// ---------------------------------------------------------------------------
//  جابه‌جایی پروژه — از سرورِ خانگی به VPS (یا برعکس)
//
//  ترتیبِ کار عوض نمی‌شود:
//      ۱) بکاپِ کامل (فایل‌ها + ردیف‌های دیتابیس)
//      ۲) انتقالِ بستهٔ بکاپ به سرورِ مقصد
//      ۳) به‌روزرسانیِ Endpointها، IPها و مسیرها روی سرورِ تازه
//      ۴) نسخهٔ تازهٔ پیکربندی (تا برنامه‌ها آدرسِ جدید را بگیرند)
//      ۵) Health Check واقعی
//
//  گامِ انتقال دو حالت دارد و هر دو صادقانه گزارش می‌شوند:
//      • اگر scp روی همین سرور باشد و اطلاعاتِ SSH داده شده باشد → واقعاً منتقل می‌شود.
//      • وگرنه گام «دستی» علامت می‌خورد و دستورِ دقیقش نوشته می‌شود.
//    هیچ‌وقت گامی که انجام نشده «موفق» ثبت نمی‌شود.
// ---------------------------------------------------------------------------
import path from 'node:path';
import fs from 'node:fs';
import { db } from '../db.js';
import { audit } from './audit.js';
import { createBackup } from './backup.js';
import { getServer, endpointUrl } from './models.js';
import { saveVersion, resolvedConfig } from './config-store.js';
import { probeUrl } from './checks.js';
import { run } from '../lib/exec.js';

const STEP = (name, status, detail = null) => ({ name, status, detail, at: Date.now() });

function saveSteps(id, steps, status, error = null) {
  db.prepare('UPDATE cc_migrations SET steps = ?, status = ?, error = ? WHERE id = ?').run(
    JSON.stringify(steps),
    status,
    error,
    id
  );
}

/** پیش از هر کاری: نقشهٔ کار را نشان بده تا مدیر بداند چه اتفاقی می‌افتد */
export function planMigration(project, toServerId) {
  const from = project.server_id ? getServer(project.server_id) : null;
  const to = getServer(toServerId);
  if (!to) throw new Error('target_server_not_found');
  if (from && Number(from.id) === Number(to.id)) throw new Error('same_server');

  const endpoints = db.prepare('SELECT * FROM cc_endpoints WHERE project_id = ?').all(project.id);
  const ips = db.prepare('SELECT * FROM cc_ips WHERE project_id = ?').all(project.id);
  const routes = db.prepare('SELECT * FROM cc_routes WHERE project_id = ?').all(project.id);

  const newHost = to.hostname || to.ip;
  return {
    from,
    to,
    willBackup: true,
    endpoints: endpoints.map((e) => ({
      id: e.id,
      environment: e.environment,
      current: endpointUrl(e),
      // فقط Endpointهایی که با IP یا نامِ سرورِ قدیم کار می‌کنند عوض می‌شوند؛
      // آن‌هایی که روی دامنهٔ ثابت‌اند دست‌نخورده می‌مانند — همان چیزی که می‌خواهید.
      willChange: Boolean(from && (e.host === from.ip || e.host === from.hostname || e.ip === from.ip)),
      next: newHost,
    })),
    ips: ips.map((i) => ({ id: i.id, address: i.address, kind: i.kind, willReassign: Boolean(from && i.server_id === from.id) })),
    routes: routes.map((r) => ({ id: r.id, hostname: r.hostname, service: r.service, note: 'دامنه و مسیر ثابت می‌ماند' })),
    stableUrls: routes.map((r) => `https://${r.hostname}`),
    transfer: transferSupport(),
  };
}

function transferSupport() {
  const hasScp = process.platform !== 'win32' || fs.existsSync('C:\\Windows\\System32\\OpenSSH\\scp.exe');
  return {
    scpLikelyAvailable: hasScp,
    note: 'اگر SSH در دسترس نباشد، بستهٔ بکاپ را خودتان می‌برید و روی مقصد بازگردانی می‌کنید.',
  };
}

/**
 * اجرای واقعیِ جابه‌جایی.
 * @param {object} options.ssh { host, user, port, targetDir } — اگر نباشد، گامِ انتقال دستی می‌شود
 */
export async function migrateProject(project, { toServerId, actor = 'admin', ssh = null, confirm = false, updateEndpoints = true } = {}) {
  if (!confirm) throw new Error('confirmation_required');
  const to = getServer(toServerId);
  if (!to) throw new Error('target_server_not_found');
  const from = project.server_id ? getServer(project.server_id) : null;

  const migrationId = Number(
    db
      .prepare('INSERT INTO cc_migrations(project_id, from_server, to_server, status, started_at) VALUES(?,?,?,?,?)')
      .run(project.id, from?.id ?? null, to.id, 'planned', Date.now()).lastInsertRowid
  );

  const steps = [];
  const fail = (message, detail = null) => {
    steps.push(STEP('failed', 'error', detail || message));
    saveSteps(migrationId, steps, 'failed', message);
    db.prepare('UPDATE cc_migrations SET finished_at = ? WHERE id = ?').run(Date.now(), migrationId);
    audit({ actor, action: 'project.migrate', projectId: project.id, result: 'failed', detail: { migrationId, error: message } });
    const err = new Error(message);
    err.steps = steps;
    throw err;
  };

  // ── گام ۱: بکاپ ──────────────────────────────────────────────────────────
  let backup;
  try {
    backup = await createBackup(project, { kind: 'pre-migrate', note: `پیش از انتقال به ${to.name}`, actor });
    steps.push(STEP('backup', 'ok', { id: backup.id, filename: backup.filename, size: backup.size }));
    db.prepare('UPDATE cc_migrations SET backup_id = ?, status = ? WHERE id = ?').run(backup.id, 'backed_up', migrationId);
  } catch (e) {
    fail(`backup_failed: ${e.message}`);
  }
  saveSteps(migrationId, steps, 'backed_up');

  // ── گام ۲: انتقالِ بسته ─────────────────────────────────────────────────
  const targetDir = ssh?.targetDir || `/opt/control-center/incoming`;
  const remote = ssh ? `${ssh.user || 'root'}@${ssh.host || to.hostname || to.ip}:${targetDir}/` : null;
  if (ssh && (ssh.host || to.hostname || to.ip)) {
    const args = ['-P', String(ssh.port || to.ssh_port || 22), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', backup.path, remote];
    const res = await run('scp', args, { timeout: 30 * 60 * 1000 });
    if (res.ok) {
      steps.push(STEP('transfer', 'ok', { method: 'scp', to: remote }));
    } else {
      // نه ادعای موفقیت، نه توقفِ کلِ کار: گام «دستی» می‌ماند و بکاپ سرِ جایش است
      steps.push(
        STEP('transfer', 'manual', {
          method: 'scp',
          error: (res.stderr || res.error?.message || 'scp_failed').slice(0, 300),
          command: `scp -P ${ssh.port || to.ssh_port || 22} "${backup.path}" ${remote}`,
        })
      );
    }
  } else {
    steps.push(
      STEP('transfer', 'manual', {
        reason: 'no_ssh_details',
        file: backup.path,
        hint: 'این فایل را روی سرورِ مقصد ببرید و در همان پروژه «بازگردانی» کنید.',
      })
    );
  }
  saveSteps(migrationId, steps, 'moved');

  // ── گام ۳: به‌روزرسانیِ آدرس‌ها ─────────────────────────────────────────
  const newHost = to.hostname || to.ip;
  const changed = [];
  if (updateEndpoints && newHost) {
    const endpoints = db.prepare('SELECT * FROM cc_endpoints WHERE project_id = ?').all(project.id);
    for (const e of endpoints) {
      const pointsAtOldServer = from && (e.host === from.ip || e.host === from.hostname || e.ip === from.ip);
      if (!pointsAtOldServer) continue; // دامنهٔ ثابت دست نمی‌خورد
      db.prepare('UPDATE cc_endpoints SET host = ?, ip = ?, server_id = ?, status = ?, updated_at = ? WHERE id = ?').run(
        newHost,
        to.ip || null,
        to.id,
        'unknown',
        Date.now(),
        e.id
      );
      changed.push({ id: e.id, from: e.host, to: newHost });
    }
    db.prepare('UPDATE cc_ips SET server_id = ? WHERE project_id = ? AND server_id = ?').run(
      to.id,
      project.id,
      from?.id ?? -1
    );
    db.prepare('UPDATE cc_ports SET server_id = ? WHERE project_id = ? AND server_id = ?').run(
      to.id,
      project.id,
      from?.id ?? -1
    );
    db.prepare('UPDATE cc_routes SET server_id = ?, updated_at = ? WHERE project_id = ? AND server_id = ?').run(
      to.id,
      Date.now(),
      project.id,
      from?.id ?? -1
    );
  }
  db.prepare('UPDATE cc_projects SET server_id = ?, updated_at = ? WHERE id = ?').run(to.id, Date.now(), project.id);
  steps.push(STEP('rewire', 'ok', { endpoints: changed, server: to.name }));
  saveSteps(migrationId, steps, 'moved');

  // ── گام ۴: نسخهٔ تازهٔ پیکربندی ─────────────────────────────────────────
  const fresh = { ...project, server_id: to.id };
  try {
    const current = resolvedConfig(fresh, 'production');
    saveVersion(fresh, {
      environment: 'production',
      data: current.config,
      note: `پس از انتقال به ${to.name}`,
      actor,
      activate: true,
    });
    steps.push(STEP('config', 'ok', { environment: 'production', keys: Object.keys(current.config) }));
  } catch (e) {
    steps.push(STEP('config', 'error', e.message));
  }

  // ── گام ۵: Health Check واقعی ───────────────────────────────────────────
  const endpoints = db.prepare('SELECT * FROM cc_endpoints WHERE project_id = ? AND monitored = 1').all(project.id);
  const health = [];
  for (const e of endpoints) {
    const url = endpointUrl(e);
    if (!url) continue;
    const res = await probeUrl(url);
    db.prepare('UPDATE cc_endpoints SET status = ?, status_code = ?, latency_ms = ?, error = ?, checked_at = ? WHERE id = ?').run(
      res.status,
      res.code ?? null,
      res.latencyMs ?? null,
      res.error ?? null,
      Date.now(),
      e.id
    );
    health.push({ url, status: res.status, code: res.code, latencyMs: res.latencyMs });
  }
  const allGood = health.length > 0 && health.every((h) => h.status === 'online');
  steps.push(STEP('health', allGood ? 'ok' : health.length ? 'warn' : 'skipped', health));

  const finalStatus = allGood ? 'done' : 'verified';
  saveSteps(migrationId, steps, finalStatus);
  db.prepare('UPDATE cc_migrations SET finished_at = ? WHERE id = ?').run(Date.now(), migrationId);

  audit({
    actor,
    action: 'project.migrate',
    entity: 'project',
    entityId: project.project_id,
    projectId: project.id,
    detail: { migrationId, from: from?.name || null, to: to.name, backup: backup.filename, health },
  });

  return {
    id: migrationId,
    status: finalStatus,
    steps,
    backup: { id: backup.id, filename: backup.filename, path: backup.path, size: backup.size },
    health,
  };
}

export function listMigrations(projectId = null) {
  const sql = projectId
    ? 'SELECT * FROM cc_migrations WHERE project_id = ? ORDER BY started_at DESC'
    : 'SELECT * FROM cc_migrations ORDER BY started_at DESC LIMIT 100';
  const rows = projectId ? db.prepare(sql).all(Number(projectId)) : db.prepare(sql).all();
  return rows.map((r) => ({
    ...r,
    steps: (() => {
      try {
        return JSON.parse(r.steps || '[]');
      } catch {
        return [];
      }
    })(),
    from_name: r.from_server ? getServer(r.from_server)?.name || null : null,
    to_name: r.to_server ? getServer(r.to_server)?.name || null : null,
  }));
}
