// ---------------------------------------------------------------------------
//  مدیریتِ دیتابیس — MySQL/MariaDB و PostgreSQL
//
//  سه تصمیمِ امنیتی که کلِ این ماژول را شکل داده‌اند:
//
//  ۱) رمز هرگز روی خطِ فرمان نمی‌رود. هر کاربری روی همان ماشین با یک `ps`
//     خطِ فرمانِ همهٔ پروسه‌ها را می‌بیند؛ `mysql -pSECRET` یعنی رمزِ ریشهٔ
//     دیتابیس روی صفحهٔ او. پس:
//        MySQL     → فایلِ موقتِ defaults با دسترسیِ ۶۰۰
//        Postgres  → متغیرِ محیطیِ PGPASSWORD
//     فایلِ موقت در finally پاک می‌شود، حتی اگر دستور شکست بخورد.
//
//  ۲) نامِ دیتابیس و کاربر با الگو سنجیده می‌شوند. در SQL نمی‌شود شناسه را
//     پارامتری کرد (`CREATE DATABASE ?` وجود ندارد)، پس تنها دفاع همین است.
//     الگو عمداً تنگ است: حرف، رقم، زیرخط. نه فاصله، نه بک‌تیک، نه نقطه.
//
//  ۳) هیچ SQLی از کاربر اجرا نمی‌شود. این ماژول فقط کارهای معیّن می‌کند —
//     ساخت، حذف، فهرست، رمز. یک «کنسولِ SQL» درِ دیگری است و اگر روزی لازم
//     شد، باید جدا و با مرزِ خودش ساخته شود.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { run } from '../lib/exec.js';

const T_QUERY = 15000;
const T_DUMP = 5 * 60 * 1000; // بکاپِ یک دیتابیسِ بزرگ وقت می‌برد

export const ENGINES = ['mysql', 'postgres'];

/**
 * شناسهٔ مجاز.
 *
 * MySQL تا ۶۴ نویسه و Postgres تا ۶۳ می‌پذیرد؛ ۶۳ را می‌گیریم تا هر دو جا
 * کار کند. شروع با رقم هم رد می‌شود چون Postgres آن را بدونِ نقلِ‌قول قبول
 * نمی‌کند و ما نقلِ‌قول نمی‌گذاریم.
 */
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

export function validIdent(value) {
  return IDENT_RE.test(String(value ?? ''));
}

function fail(code, detail = null) {
  return { ok: false, error: code, detail };
}

/* -------------------------------------------------------------------------- */
/*  اجرای دستور بدونِ نشتِ رمز                                                 */
/* -------------------------------------------------------------------------- */

/**
 * MySQL: فایلِ موقتِ defaults.
 *
 * با umask امن ساخته می‌شود (0o600) و بعد از اجرا پاک. اگر پروسه وسطِ کار
 * کشته شود فایل می‌ماند، ولی چون در پوشهٔ موقتِ کاربر و با ۶۰۰ است، همان
 * محدودیتی را دارد که خودِ فایلِ ~/.my.cnf دارد.
 */
async function withMysqlDefaults(conn, fn) {
  const file = path.join(os.tmpdir(), `hlp-my-${crypto.randomBytes(9).toString('hex')}.cnf`);
  const body = [
    '[client]',
    `host=${conn.host}`,
    `port=${conn.port}`,
    `user=${conn.user}`,
    // رمز ممکن است هر نویسه‌ای داشته باشد؛ در فرمتِ ini با نقلِ‌قول امن است
    `password="${String(conn.password ?? '').replace(/"/g, '\\"')}"`,
    '',
  ].join('\n');

  await fsp.writeFile(file, body, { mode: 0o600 });
  try {
    return await fn(file);
  } finally {
    await fsp.rm(file, { force: true }).catch(() => {});
  }
}

async function mysqlQuery(conn, sql, { timeout = T_QUERY } = {}) {
  return withMysqlDefaults(conn, (file) =>
    run('mysql', [`--defaults-extra-file=${file}`, '--batch', '--raw', '--skip-column-names', '-e', sql], {
      timeout,
      maxBuffer: 8 * 1024 * 1024,
    })
  );
}

function pgEnv(conn) {
  // PGPASSWORD در محیطِ فرزند می‌ماند و در ps دیده نمی‌شود
  return { ...process.env, PGPASSWORD: String(conn.password ?? '') };
}

function pgQuery(conn, sql, { db = 'postgres', timeout = T_QUERY } = {}) {
  return run(
    'psql',
    ['-h', conn.host, '-p', String(conn.port), '-U', conn.user, '-d', db,
      '-At', '-F', '\t', '--no-psqlrc', '-c', sql],
    { timeout, env: pgEnv(conn), maxBuffer: 8 * 1024 * 1024 }
  );
}

/* -------------------------------------------------------------------------- */
/*  در دسترس بودن                                                              */
/* -------------------------------------------------------------------------- */

/** آیا کلاینتِ این موتور روی ماشین هست؟ (بدونِ اتصال، فقط وجودِ ابزار) */
export async function clients() {
  const [my, pg] = await Promise.all([
    run('mysql', ['--version'], { timeout: 5000 }),
    run('psql', ['--version'], { timeout: 5000 }),
  ]);
  return {
    ok: true,
    mysql: { installed: my.ok, version: my.ok ? my.stdout.trim().slice(0, 120) : null },
    postgres: { installed: pg.ok, version: pg.ok ? pg.stdout.trim().slice(0, 120) : null },
  };
}

/** آیا با این مشخصات واقعاً وصل می‌شویم؟ */
export async function testConnection(engine, conn) {
  if (!ENGINES.includes(engine)) return fail('unknown_engine');

  const res = engine === 'mysql'
    ? await mysqlQuery(conn, 'SELECT VERSION();')
    : await pgQuery(conn, 'SELECT version();');

  if (!res.ok) {
    const text = `${res.stderr}${res.stdout}`.trim();
    // پیامِ خامِ کلاینت بیشتر از «وصل نشد» کمک می‌کند — ولی محدود، چون
    // می‌تواند مسیرِ سوکت و نامِ کاربر را لو بدهد
    return fail('connect_failed', text.slice(0, 300) || null);
  }
  return { ok: true, version: res.stdout.trim().split('\n')[0].slice(0, 200) };
}

/* -------------------------------------------------------------------------- */
/*  فهرست‌ها                                                                   */
/* -------------------------------------------------------------------------- */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** دیتابیس‌های سیستمی که نباید مثلِ دیتابیسِ کاربر نشان داده شوند */
const SYSTEM_DBS = {
  mysql: new Set(['information_schema', 'performance_schema', 'mysql', 'sys']),
  postgres: new Set(['postgres', 'template0', 'template1']),
};

export async function listDatabases(engine, conn) {
  if (!ENGINES.includes(engine)) return fail('unknown_engine');

  if (engine === 'mysql') {
    const sql =
      'SELECT table_schema, IFNULL(SUM(data_length + index_length), 0), COUNT(*) ' +
      'FROM information_schema.tables GROUP BY table_schema ' +
      'UNION SELECT schema_name, 0, 0 FROM information_schema.schemata;';
    const res = await mysqlQuery(conn, sql);
    if (!res.ok) return fail('query_failed', `${res.stderr}`.trim().slice(0, 300) || null);

    // اسکیمای خالی از UNION دوباره می‌آید؛ بزرگ‌ترین مقدار برای هر نام برنده است
    const byName = new Map();
    for (const line of res.stdout.split('\n')) {
      if (!line.trim()) continue;
      const [name, bytes, tables] = line.split('\t');
      const prev = byName.get(name);
      const row = { name, bytes: num(bytes), tables: num(tables), system: SYSTEM_DBS.mysql.has(name) };
      if (!prev || row.bytes > prev.bytes || row.tables > prev.tables) byName.set(name, row);
    }
    return { ok: true, items: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)) };
  }

  const sql =
    "SELECT datname, pg_database_size(datname) FROM pg_database WHERE datistemplate = false;";
  const res = await pgQuery(conn, sql);
  if (!res.ok) return fail('query_failed', `${res.stderr}`.trim().slice(0, 300) || null);

  const items = res.stdout
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => {
      const [name, bytes] = line.split('\t');
      return { name, bytes: num(bytes), tables: null, system: SYSTEM_DBS.postgres.has(name) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { ok: true, items };
}

export async function listUsers(engine, conn) {
  if (!ENGINES.includes(engine)) return fail('unknown_engine');

  if (engine === 'mysql') {
    const res = await mysqlQuery(conn, 'SELECT user, host FROM mysql.user ORDER BY user;');
    if (!res.ok) return fail('query_failed', `${res.stderr}`.trim().slice(0, 300) || null);
    const items = res.stdout
      .split('\n')
      .filter((l) => l.trim())
      .map((line) => {
        const [name, host] = line.split('\t');
        return { name, host, superuser: null };
      });
    return { ok: true, items };
  }

  const res = await pgQuery(conn, 'SELECT rolname, rolsuper FROM pg_roles ORDER BY rolname;');
  if (!res.ok) return fail('query_failed', `${res.stderr}`.trim().slice(0, 300) || null);
  const items = res.stdout
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => {
      const [name, superuser] = line.split('\t');
      return { name, host: null, superuser: superuser === 't' };
    });
  return { ok: true, items };
}

/* -------------------------------------------------------------------------- */
/*  ساخت و حذف                                                                 */
/* -------------------------------------------------------------------------- */

export async function createDatabase(engine, conn, name) {
  if (!ENGINES.includes(engine)) return fail('unknown_engine');
  if (!validIdent(name)) return fail('invalid_name');

  // utf8mb4 نه utf8: «utf8» در MySQL سه‌بایتی است و ایموجی و بعضی نویسه‌های
  // فارسی/عربیِ ترکیبی را نمی‌گیرد — همان باگی که سال‌ها بعد پیدا می‌شود
  const sql = engine === 'mysql'
    ? `CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
    : `CREATE DATABASE "${name}" ENCODING 'UTF8';`;

  const res = engine === 'mysql' ? await mysqlQuery(conn, sql) : await pgQuery(conn, sql);
  if (!res.ok) {
    const text = `${res.stderr}`.trim();
    if (/exists/i.test(text)) return fail('already_exists');
    return fail('create_failed', text.slice(0, 300) || null);
  }
  return { ok: true, name };
}

export async function dropDatabase(engine, conn, name) {
  if (!ENGINES.includes(engine)) return fail('unknown_engine');
  if (!validIdent(name)) return fail('invalid_name');
  // دیتابیسِ سیستمی هرگز — حذفش یعنی خودِ موتور از کار می‌افتد
  if (SYSTEM_DBS[engine].has(name)) return fail('system_database');

  const sql = engine === 'mysql' ? `DROP DATABASE \`${name}\`;` : `DROP DATABASE "${name}";`;
  const res = engine === 'mysql' ? await mysqlQuery(conn, sql) : await pgQuery(conn, sql);
  if (!res.ok) return fail('drop_failed', `${res.stderr}`.trim().slice(0, 300) || null);
  return { ok: true, name };
}

/**
 * ساختِ کاربر و دادنِ دسترسیِ کاملِ یک دیتابیس به او.
 *
 * دسترسی عمداً به همان یک دیتابیس محدود است، نه GRANT ALL روی *.* — یک
 * برنامه‌ای که به دیتابیسِ خودش وصل می‌شود نباید بتواند بقیه را بخواند.
 */
export async function createUser(engine, conn, { name, password, database = null }) {
  if (!ENGINES.includes(engine)) return fail('unknown_engine');
  if (!validIdent(name)) return fail('invalid_name');
  if (!password || String(password).length < 8) return fail('weak_password');
  if (database && !validIdent(database)) return fail('invalid_database');

  // رمز داخلِ رشتهٔ SQL می‌رود، پس نقلِ‌قولِ تکی باید دو برابر شود
  const quoted = String(password).replace(/'/g, "''");

  if (engine === 'mysql') {
    const statements = [
      `CREATE USER '${name}'@'%' IDENTIFIED BY '${quoted}';`,
      database ? `GRANT ALL PRIVILEGES ON \`${database}\`.* TO '${name}'@'%';` : null,
      'FLUSH PRIVILEGES;',
    ].filter(Boolean).join(' ');
    const res = await mysqlQuery(conn, statements);
    if (!res.ok) {
      const text = `${res.stderr}`.trim();
      if (/exists/i.test(text)) return fail('already_exists');
      return fail('create_failed', text.slice(0, 300) || null);
    }
    return { ok: true, name };
  }

  let res = await pgQuery(conn, `CREATE ROLE "${name}" LOGIN PASSWORD '${quoted}';`);
  if (!res.ok) {
    const text = `${res.stderr}`.trim();
    if (/exists/i.test(text)) return fail('already_exists');
    return fail('create_failed', text.slice(0, 300) || null);
  }
  if (database) {
    res = await pgQuery(conn, `GRANT ALL PRIVILEGES ON DATABASE "${database}" TO "${name}";`);
    if (!res.ok) return fail('grant_failed', `${res.stderr}`.trim().slice(0, 300) || null);
  }
  return { ok: true, name };
}

export async function setPassword(engine, conn, name, password) {
  if (!ENGINES.includes(engine)) return fail('unknown_engine');
  if (!validIdent(name)) return fail('invalid_name');
  if (!password || String(password).length < 8) return fail('weak_password');

  const quoted = String(password).replace(/'/g, "''");
  const sql = engine === 'mysql'
    ? `ALTER USER '${name}'@'%' IDENTIFIED BY '${quoted}'; FLUSH PRIVILEGES;`
    : `ALTER ROLE "${name}" PASSWORD '${quoted}';`;

  const res = engine === 'mysql' ? await mysqlQuery(conn, sql) : await pgQuery(conn, sql);
  if (!res.ok) return fail('update_failed', `${res.stderr}`.trim().slice(0, 300) || null);
  return { ok: true, name };
}

export async function dropUser(engine, conn, name) {
  if (!ENGINES.includes(engine)) return fail('unknown_engine');
  if (!validIdent(name)) return fail('invalid_name');
  // کاربری که خودمان با آن وصل شده‌ایم را نمی‌شود حذف کرد — بعدش هیچ راهی
  // برای برگشت نیست
  if (name === conn.user) return fail('cannot_drop_self');

  const sql = engine === 'mysql'
    ? `DROP USER '${name}'@'%'; FLUSH PRIVILEGES;`
    : `DROP ROLE "${name}";`;

  const res = engine === 'mysql' ? await mysqlQuery(conn, sql) : await pgQuery(conn, sql);
  if (!res.ok) return fail('drop_failed', `${res.stderr}`.trim().slice(0, 300) || null);
  return { ok: true, name };
}

/* -------------------------------------------------------------------------- */
/*  بکاپ و بازگردانی                                                           */
/* -------------------------------------------------------------------------- */

/**
 * خروجی گرفتن به یک فایل.
 *
 * خروجی مستقیم به فایل می‌رود، نه به حافظهٔ Node — یک دیتابیسِ چندگیگابایتی
 * maxBuffer را می‌ترکاند و پنل را می‌خواباند.
 */
export async function dump(engine, conn, database, outFile) {
  if (!ENGINES.includes(engine)) return fail('unknown_engine');
  if (!validIdent(database)) return fail('invalid_name');

  await fsp.mkdir(path.dirname(outFile), { recursive: true });
  const handle = await fsp.open(outFile, 'w', 0o600);

  try {
    const { spawn } = await import('node:child_process');
    const finished = (child) =>
      new Promise((resolve) => {
        let err = '';
        child.stderr?.on('data', (d) => (err += d));
        child.on('error', (e) => resolve({ ok: false, err: String(e.message) }));
        child.on('exit', (code) => resolve({ ok: code === 0, err }));
      });

    let result;
    if (engine === 'mysql') {
      result = await withMysqlDefaults(conn, async (file) => {
        const child = spawn('mysqldump', [`--defaults-extra-file=${file}`, '--single-transaction', '--routines', database], {
          stdio: ['ignore', handle.fd, 'pipe'],
        });
        const timer = setTimeout(() => child.kill('SIGKILL'), T_DUMP);
        const r = await finished(child);
        clearTimeout(timer);
        return r;
      });
    } else {
      const child = spawn('pg_dump', ['-h', conn.host, '-p', String(conn.port), '-U', conn.user, database], {
        stdio: ['ignore', handle.fd, 'pipe'],
        env: pgEnv(conn),
      });
      const timer = setTimeout(() => child.kill('SIGKILL'), T_DUMP);
      result = await finished(child);
      clearTimeout(timer);
    }

    if (!result.ok) {
      await handle.close();
      await fsp.rm(outFile, { force: true }).catch(() => {});
      return fail('dump_failed', String(result.err || '').trim().slice(0, 300) || null);
    }

    await handle.close();
    const stat = await fsp.stat(outFile);
    return { ok: true, file: outFile, bytes: stat.size };
  } catch (e) {
    await handle.close().catch(() => {});
    return fail('dump_failed', String(e?.message || e).slice(0, 200));
  }
}

/** بازگردانی از یک فایلِ SQL که از قبل روی دیسک است */
export async function restore(engine, conn, database, inFile) {
  if (!ENGINES.includes(engine)) return fail('unknown_engine');
  if (!validIdent(database)) return fail('invalid_name');
  if (!fs.existsSync(inFile)) return fail('file_not_found');

  const { spawn } = await import('node:child_process');
  const handle = await fsp.open(inFile, 'r');

  const finished = (child) =>
    new Promise((resolve) => {
      let err = '';
      child.stderr?.on('data', (d) => (err += d));
      child.on('error', (e) => resolve({ ok: false, err: String(e.message) }));
      child.on('exit', (code) => resolve({ ok: code === 0, err }));
    });

  try {
    let result;
    if (engine === 'mysql') {
      result = await withMysqlDefaults(conn, async (file) => {
        const child = spawn('mysql', [`--defaults-extra-file=${file}`, database], {
          stdio: [handle.fd, 'ignore', 'pipe'],
        });
        const timer = setTimeout(() => child.kill('SIGKILL'), T_DUMP);
        const r = await finished(child);
        clearTimeout(timer);
        return r;
      });
    } else {
      const child = spawn('psql', ['-h', conn.host, '-p', String(conn.port), '-U', conn.user, '-d', database, '--no-psqlrc'], {
        stdio: [handle.fd, 'ignore', 'pipe'],
        env: pgEnv(conn),
      });
      const timer = setTimeout(() => child.kill('SIGKILL'), T_DUMP);
      result = await finished(child);
      clearTimeout(timer);
    }

    if (!result.ok) return fail('restore_failed', String(result.err || '').trim().slice(0, 300) || null);
    return { ok: true, database };
  } finally {
    await handle.close().catch(() => {});
  }
}
