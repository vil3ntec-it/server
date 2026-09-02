// ---------------------------------------------------------------------------
//  مسیرهای مدیریتِ دیتابیس
//
//      viewer     فهرستِ دیتابیس‌ها و کاربران را می‌بیند
//      operator   دیتابیس و کاربر می‌سازد، بکاپ می‌گیرد
//      admin      حذف می‌کند و بازگردانی
//
//  رمزِ اتصال در گاوصندوقِ پنل می‌نشیند، نه در جدولِ تنظیمات — همان‌جایی که
//  بقیهٔ رازها هستند و رمزگذاری‌شده است. در پاسخِ HTTP هرگز برنمی‌گردد.
// ---------------------------------------------------------------------------
import path from 'node:path';
import { Router } from 'express';
import { requireAuth, requireWriteRole } from '../auth.js';
import { audit } from '../lib/audit.js';
import { config } from '../config.js';
import { getSetting, setSetting } from '../db.js';
import { listSecrets, putSecret, readSecret, deleteSecret } from '../control/vault.js';
import {
  ENGINES, clients, testConnection, listDatabases, listUsers,
  createDatabase, dropDatabase, createUser, setPassword, dropUser,
  dump, restore, validIdent,
} from '../system/database.js';

const router = Router();
router.use(requireAuth);

const SETTING_KEY = 'db_connections';
const secretName = (engine) => `db_${engine}_password`;

/* -------------------------------------------------------------------------- */
/*  پیکربندیِ اتصال                                                            */
/* -------------------------------------------------------------------------- */

const DEFAULTS = {
  mysql: { host: '127.0.0.1', port: 3306, user: 'root', enabled: false },
  postgres: { host: '127.0.0.1', port: 5432, user: 'postgres', enabled: false },
};

function readConfig() {
  let saved = {};
  try {
    saved = JSON.parse(getSetting(SETTING_KEY, '{}')) || {};
  } catch { saved = {}; }
  return {
    mysql: { ...DEFAULTS.mysql, ...(saved.mysql || {}) },
    postgres: { ...DEFAULTS.postgres, ...(saved.postgres || {}) },
  };
}

/** مشخصاتِ کاملِ اتصال، با رمزی که از گاوصندوق درمی‌آید */
function connectionFor(engine) {
  const cfg = readConfig()[engine];
  if (!cfg) return null;
  const row = listSecrets({ scope: 'global' }).find((s) => s.name === secretName(engine));
  const password = row ? readSecret(row.id) : '';
  return { ...cfg, password: password || '' };
}

/** آن‌چه به رابط کاربری برمی‌گردد — بدونِ رمز، فقط «هست یا نیست» */
function publicConfig() {
  const cfg = readConfig();
  const names = new Set(listSecrets({ scope: 'global' }).map((s) => s.name));
  for (const engine of ENGINES) {
    cfg[engine].passwordSet = names.has(secretName(engine));
  }
  return cfg;
}

function send(res, result) {
  if (result.ok) return res.json(result);
  const status =
    ['invalid_name', 'invalid_database', 'weak_password', 'unknown_engine'].includes(result.error) ? 400
      : ['already_exists'].includes(result.error) ? 409
        : ['system_database', 'cannot_drop_self'].includes(result.error) ? 403
          : ['file_not_found'].includes(result.error) ? 404
            : ['connect_failed', 'query_failed'].includes(result.error) ? 503
              : 500;
  return res.status(status).json(result);
}

function guardEngine(req, res) {
  const { engine } = req.params;
  if (!ENGINES.includes(engine)) {
    res.status(400).json({ ok: false, error: 'unknown_engine' });
    return null;
  }
  return engine;
}

/* -------------------------------------------------------------------------- */
/*  وضعیت و پیکربندی                                                           */
/* -------------------------------------------------------------------------- */

router.get('/clients', async (req, res) => {
  res.json(await clients());
});

router.get('/config', (req, res) => {
  res.json({ ok: true, config: publicConfig() });
});

router.put('/config/:engine', requireWriteRole('admin'), (req, res) => {
  const engine = guardEngine(req, res);
  if (!engine) return;

  const { host, port, user, password, enabled } = req.body || {};
  const cfg = readConfig();

  cfg[engine] = {
    ...cfg[engine],
    host: String(host ?? cfg[engine].host).trim() || '127.0.0.1',
    port: Number(port) || cfg[engine].port,
    user: String(user ?? cfg[engine].user).trim() || cfg[engine].user,
    enabled: enabled === undefined ? cfg[engine].enabled : Boolean(enabled),
  };
  setSetting(SETTING_KEY, JSON.stringify(cfg));

  // رمز فقط وقتی عوض می‌شود که فرستاده شده باشد؛ فرستادنِ رشتهٔ خالی یعنی
  // «پاکش کن»، و ندادنِ فیلد یعنی «دست نزن»
  if (password !== undefined) {
    const existing = listSecrets({ scope: 'global' }).find((s) => s.name === secretName(engine));
    if (existing) deleteSecret(existing.id, req.user?.username || 'admin');
    if (password) {
      putSecret({
        name: secretName(engine),
        kind: 'database',
        scope: 'global',
        value: String(password),
        note: `رمزِ اتصالِ پنل به ${engine}`,
        actor: req.user?.username || 'admin',
      });
    }
  }

  audit(req, 'database.config', { target: engine, detail: { host: cfg[engine].host, user: cfg[engine].user } });
  res.json({ ok: true, config: publicConfig() });
});

router.post('/:engine/test', async (req, res) => {
  const engine = guardEngine(req, res);
  if (!engine) return;
  send(res, await testConnection(engine, connectionFor(engine)));
});

/* -------------------------------------------------------------------------- */
/*  دیتابیس‌ها                                                                 */
/* -------------------------------------------------------------------------- */

router.get('/:engine/databases', async (req, res) => {
  const engine = guardEngine(req, res);
  if (!engine) return;
  send(res, await listDatabases(engine, connectionFor(engine)));
});

router.post('/:engine/databases', requireWriteRole('operator'), async (req, res) => {
  const engine = guardEngine(req, res);
  if (!engine) return;

  const name = String(req.body?.name || '').trim();
  const result = await createDatabase(engine, connectionFor(engine), name);
  audit(req, 'database.create', { target: `${engine}:${name}`, ok: result.ok, detail: result.ok ? null : result });
  send(res, result);
});

router.delete('/:engine/databases/:name', requireWriteRole('admin'), async (req, res) => {
  const engine = guardEngine(req, res);
  if (!engine) return;

  const { name } = req.params;
  const result = await dropDatabase(engine, connectionFor(engine), name);
  audit(req, 'database.drop', { target: `${engine}:${name}`, ok: result.ok, detail: result.ok ? null : result });
  send(res, result);
});

/* -------------------------------------------------------------------------- */
/*  کاربران                                                                    */
/* -------------------------------------------------------------------------- */

router.get('/:engine/users', async (req, res) => {
  const engine = guardEngine(req, res);
  if (!engine) return;
  send(res, await listUsers(engine, connectionFor(engine)));
});

router.post('/:engine/users', requireWriteRole('operator'), async (req, res) => {
  const engine = guardEngine(req, res);
  if (!engine) return;

  const name = String(req.body?.name || '').trim();
  const result = await createUser(engine, connectionFor(engine), {
    name,
    password: req.body?.password,
    database: req.body?.database || null,
  });
  // رمز هرگز در دفترِ کارها نمی‌رود — فقط اینکه کاربری ساخته شد
  audit(req, 'database.user.create', {
    target: `${engine}:${name}`,
    ok: result.ok,
    detail: { database: req.body?.database || null },
  });
  send(res, result);
});

router.post('/:engine/users/:name/password', requireWriteRole('operator'), async (req, res) => {
  const engine = guardEngine(req, res);
  if (!engine) return;

  const { name } = req.params;
  const result = await setPassword(engine, connectionFor(engine), name, req.body?.password);
  audit(req, 'database.user.password', { target: `${engine}:${name}`, ok: result.ok });
  send(res, result);
});

router.delete('/:engine/users/:name', requireWriteRole('admin'), async (req, res) => {
  const engine = guardEngine(req, res);
  if (!engine) return;

  const { name } = req.params;
  const result = await dropUser(engine, connectionFor(engine), name);
  audit(req, 'database.user.drop', { target: `${engine}:${name}`, ok: result.ok, detail: result.ok ? null : result });
  send(res, result);
});

/* -------------------------------------------------------------------------- */
/*  بکاپ و بازگردانی                                                           */
/* -------------------------------------------------------------------------- */

/** بکاپ‌ها کنارِ بقیهٔ بکاپ‌های پنل می‌نشینند، نه در یک گوشهٔ تازه */
function dumpPath(engine, database) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(config.dataDir, 'backups', 'databases', `${engine}-${database}-${stamp}.sql`);
}

router.post('/:engine/databases/:name/dump', requireWriteRole('operator'), async (req, res) => {
  const engine = guardEngine(req, res);
  if (!engine) return;

  const { name } = req.params;
  if (!validIdent(name)) return send(res, { ok: false, error: 'invalid_name' });

  const target = dumpPath(engine, name);
  const result = await dump(engine, connectionFor(engine), name, target);
  audit(req, 'database.dump', {
    target: `${engine}:${name}`,
    ok: result.ok,
    detail: result.ok ? { file: path.basename(target), bytes: result.bytes } : result,
  });
  send(res, result);
});

router.post('/:engine/databases/:name/restore', requireWriteRole('admin'), async (req, res) => {
  const engine = guardEngine(req, res);
  if (!engine) return;

  const { name } = req.params;
  const file = String(req.body?.file || '');

  // فقط از پوشهٔ بکاپِ خودِ پنل — وگرنه این مسیر تبدیل می‌شد به «هر فایلی از
  // هر جای دیسک را به دیتابیس بده»
  const root = path.join(config.dataDir, 'backups', 'databases');
  const resolved = path.resolve(root, path.basename(file));
  if (!resolved.startsWith(root + path.sep)) return send(res, { ok: false, error: 'invalid_name' });

  const result = await restore(engine, connectionFor(engine), name, resolved);
  audit(req, 'database.restore', {
    target: `${engine}:${name}`,
    ok: result.ok,
    detail: { file: path.basename(resolved), ...(result.ok ? {} : result) },
  });
  send(res, result);
});

export default router;
