// ---------------------------------------------------------------------------
// تشخیص نوع پروژه از روی فایل‌های واقعیِ داخل پوشه + پیشنهاد دستور اجرا و پورت
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';

function has(dir, name) {
  try {
    return fs.existsSync(path.join(dir, name));
  } catch {
    return false;
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// پورت را از فایل‌های واقعی پروژه بیرون می‌کشیم (.env یا اسکریپت‌ها) — حدس بی‌پایه نمی‌زنیم
function portFromEnvFile(dir) {
  for (const name of ['.env', '.env.local', '.env.production']) {
    const f = path.join(dir, name);
    if (!fs.existsSync(f)) continue;
    try {
      const txt = fs.readFileSync(f, 'utf8');
      const m = txt.match(/^\s*(?:PORT|APP_PORT|SERVER_PORT)\s*=\s*"?(\d{2,5})"?\s*$/m);
      if (m) return Number(m[1]);
    } catch { /* بی‌خیال */ }
  }
  return null;
}

function portFromScript(cmd) {
  if (!cmd) return null;
  const m = String(cmd).match(/(?:--port[= ]|-p\s+|:)(\d{2,5})\b/);
  return m ? Number(m[1]) : null;
}

export function detectProject(dir) {
  const result = {
    kind: null,
    name: path.basename(dir),
    startCommand: null,
    port: null,
    hasIndex: false,
  };

  const pkgFile = path.join(dir, 'package.json');
  const pkg = fs.existsSync(pkgFile) ? readJson(pkgFile) : null;

  if (pkg) {
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (deps.next) result.kind = 'next';
    else if (deps.nuxt) result.kind = 'nuxt';
    else if (deps.express || deps.fastify || deps.koa || deps['@nestjs/core']) result.kind = 'node';
    else if (deps.vite || deps.react || deps.vue) result.kind = 'node';
    else result.kind = 'node';

    if (pkg.name) result.name = pkg.name;
    const scripts = pkg.scripts || {};
    if (scripts.start) result.startCommand = 'npm start';
    else if (scripts.serve) result.startCommand = 'npm run serve';
    else if (pkg.main) result.startCommand = `node ${pkg.main}`;
    else if (fs.existsSync(path.join(dir, 'server.js'))) result.startCommand = 'node server.js';
    else if (fs.existsSync(path.join(dir, 'index.js'))) result.startCommand = 'node index.js';

    result.port = portFromEnvFile(dir) || portFromScript(scripts.start) || null;
    return result;
  }

  if (has(dir, 'artisan')) {
    result.kind = 'laravel';
    result.startCommand = 'php artisan serve --host=0.0.0.0 --port=${PORT}';
    result.port = portFromEnvFile(dir);
    return result;
  }

  if (has(dir, 'manage.py')) {
    result.kind = 'django';
    result.startCommand = 'python3 manage.py runserver 0.0.0.0:${PORT}';
    return result;
  }

  if (has(dir, 'wp-config.php') || has(dir, 'wp-load.php')) {
    result.kind = 'wordpress';
    result.startCommand = 'php -S 0.0.0.0:${PORT} -t .';
    return result;
  }

  if (has(dir, 'index.php')) {
    result.kind = 'php';
    result.startCommand = 'php -S 0.0.0.0:${PORT} -t .';
    return result;
  }

  if (has(dir, 'index.html') || has(dir, 'public/index.html') || has(dir, 'dist/index.html')) {
    result.kind = 'static';
    result.hasIndex = true;
    result.startCommand = null; // سرور استاتیک داخلی خودِ پنل استفاده می‌شود
    return result;
  }

  return result; // kind = null یعنی پوشه پروژهٔ وب شناخته‌شده‌ای نیست
}

// ریشهٔ فایل‌های استاتیک یک سایت (public/dist/ خودِ پوشه)
export function staticRootOf(dir) {
  for (const sub of ['public', 'dist', 'build', '_site', 'www']) {
    const p = path.join(dir, sub);
    if (fs.existsSync(path.join(p, 'index.html'))) return p;
  }
  return dir;
}

// پوشه‌هایی که به‌طور استاندارد روی سرورهای وب، سایت در آن‌ها نگه‌داری می‌شود
export function defaultScanRoots(sitesRoot) {
  const roots = [sitesRoot];
  if (process.platform === 'win32') {
    for (const d of [
      'C:\\xampp\\htdocs',
      'C:\\laragon\\www',
      'C:\\wamp64\\www',
      'C:\\wamp\\www',
      'C:\\inetpub\\wwwroot',
    ]) {
      roots.push(d);
    }
  } else {
    for (const d of ['/var/www', '/srv/www', '/usr/share/nginx/html', '/opt/sites']) {
      roots.push(d);
    }
  }
  return roots.filter((d, i, arr) => arr.indexOf(d) === i);
}
