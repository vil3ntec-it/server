// ---------------------------------------------------------------------------
//  آزمونِ پیکربندیِ VPS با داکر — deploy/docker
//      node test/deploy-compose.mjs
//
//  ۱) قاعده‌های امنیتی از روی خودِ فایل‌ها (همه جا اجرا می‌شود):
//     پورتِ پنل فقط روی ‎127.0.0.1‎، اینترنت فقط ۸۰/۴۴۳ِ Caddy، Caddy به پورتِ
//     عمومی (۴۷۰۱)، سرآیندِ جعلیِ IP پاک، نمایهٔ docker، هیچ رازی در فایل‌ها.
//  ۲) ‎docker compose config‎ — اگر CLIِ داکر باشد (بی دیمن هم کار می‌کند).
//  ۳) ‎caddy validate‎ هر دو Caddyfile در کانتینرِ رسمیِ Caddy — فقط اگر دیمنِ
//     داکر جواب بدهد (رانرِ CI بله). وگرنه صریح «سنجیده نشد»، نه «درست».
// ---------------------------------------------------------------------------
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..', '..', '..');
const DIR = path.join(REPO, 'deploy', 'docker');
let passed = 0;
let failed = 0;
let skipped = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 600) : ''}`); }
};
const skip = (name, why) => { skipped++; console.log(`  ⏭ ${name} — سنجیده نشد: ${why}`); };

const compose = fs.readFileSync(path.join(DIR, 'docker-compose.yml'), 'utf8');
const apps = fs.readFileSync(path.join(DIR, 'caddy', 'apps.caddy'), 'utf8');
const caddyPanel = fs.readFileSync(path.join(DIR, 'caddy', 'Caddyfile.panel'), 'utf8');
const envEx = fs.readFileSync(path.join(DIR, '.env.example'), 'utf8');
const dockerfile = fs.readFileSync(path.join(REPO, 'homelab-panel', 'server', 'Dockerfile'), 'utf8');

console.log('── ۱) قاعده‌ها از روی فایل ──');
const portLines = compose.split('\n').filter((l) => /^\s*-\s*"[^"]*:\d+(\/udp)?"\s*$/.test(l)).map((l) => l.trim());
check('پورتِ پنل فقط روی 127.0.0.1ِ خودِ سرور', portLines.some((l) => l.includes('127.0.0.1:${PANEL_LOCAL_PORT:-4700}:4700'))
  && !portLines.some((l) => /"(0\.0\.0\.0:)?(\$\{[^}]+\}|4700):4700"/.test(l) && !l.includes('127.0.0.1')), portLines.join(' '));
check('پورتِ عمومیِ پنل (4701) مستقیم منتشر نمی‌شود — فقط از Caddy', !portLines.some((l) => l.includes(':4701')));
check('اینترنت فقط ۸۰ و ۴۴۳', portLines.filter((l) => !l.includes('127.0.0.1')).every((l) => /"(80:80|443:443|443:443\/udp)"/.test(l)), portLines.join(' '));
check('Caddy برنامه‌ها را به پورتِ عمومی (4701) می‌برد، نه پنل', /reverse_proxy panel:4701/.test(apps) && !/reverse_proxy panel:4700/.test(apps));
check('Caddy سرآیندهای جعلیِ IP را پاک می‌کند (CF-Connecting-IP، X-Real-IP)', /header_up -Cf-Connecting-Ip/.test(apps) && /header_up -X-Real-Ip/.test(apps));
check('پنل روی دامنه فقط در Caddyfile.panel و پشتِ TLS', /\{\$PANEL_HOST\}/.test(caddyPanel) && /reverse_proxy panel:4700/.test(caddyPanel) && /Strict-Transport-Security/.test(caddyPanel));
check('نمایهٔ docker و پراکسیِ مورد اعتماد در compose', /HLP_DEPLOY: docker/.test(compose) && /HLP_TRUST_PROXY: "1"/.test(compose));
check('بازگشتِ خودکار و خاموش‌سازیِ تمیز', (compose.match(/restart: unless-stopped/g) || []).length === 2 && /stop_grace_period/.test(compose));
check('دادهٔ پنل و پشتیبان‌ها در volumeِ جدا', /panel-data:\/data/.test(compose) && /panel-backups:\/backups/.test(compose));
check('Caddy تا پنل سالم نشده بالا نمی‌آید', /condition: service_healthy/.test(compose));
check('.env.example هیچ رازِ پرشده‌ای ندارد', /^HLP_ADMIN_PASSWORD=\s*$/m.test(envEx) && /^HLP_SECRET_KEY=\s*$/m.test(envEx) && !/SECRET_ACCESS_KEY=\S/.test(envEx));
check('.env در گیت نمی‌رود', fs.readFileSync(path.join(DIR, '.gitignore'), 'utf8').split('\n').includes('.env'));
check('ایمیج: سرورِ حساب کنارِ پنل (/account-server) و نمایهٔ docker', /COPY --from=account \/account-server \/account-server/.test(dockerfile) && /HLP_DEPLOY=docker/.test(dockerfile));
check('ایمیج: کاربرِ غیرِ root و سلامت', /^USER node$/m.test(dockerfile) && /HEALTHCHECK/.test(dockerfile));

console.log('── ۲) docker compose config ──');
const hasCli = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8', timeout: 15000 }).status === 0;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-compose-'));
try {
  if (!hasCli) {
    skip('docker compose config', 'CLIِ docker compose روی این ماشین نیست');
  } else {
    //  کپیِ پوشه با .env از روی نمونه — فایلِ اصلی دست نمی‌خورد
    const work = path.join(tmp, 'deploy', 'docker');
    await fsp.cp(DIR, work, { recursive: true });
    await fsp.mkdir(path.join(tmp, 'homelab-panel', 'server'), { recursive: true });
    await fsp.writeFile(path.join(work, '.env'), envEx.replace(/^HLP_DOMAIN=.*$/m, 'HLP_DOMAIN=example.org'));
    const r = spawnSync('docker', ['compose', 'config', '--format', 'json'], { cwd: work, encoding: 'utf8', timeout: 60000 });
    check('docker compose config بی خطا', r.status === 0, r.stderr);
    if (r.status === 0) {
      const cfg = JSON.parse(r.stdout);
      const panel = cfg.services.panel;
      check('محیطِ پنل: نمایهٔ docker، پوشهٔ داده، دامنه از .env', panel.environment.HLP_DEPLOY === 'docker' && panel.environment.HLP_DATA_DIR === '/data' && panel.environment.HLP_DOMAIN === 'example.org');
      check('پورتِ منتشرشدهٔ پنل فقط 127.0.0.1', panel.ports.length === 1 && panel.ports[0].host_ip === '127.0.0.1' && String(panel.ports[0].target) === '4700', JSON.stringify(panel.ports));
      check('Caddy نشانی‌های api. و admin. را از دامنه می‌سازد', cfg.services.caddy.environment.API_HOST === 'api.example.org' && cfg.services.caddy.environment.ADMIN_HOST === 'admin.example.org');
      const noDomain = path.join(work, '.env');
      await fsp.writeFile(noDomain, envEx.replace(/^HLP_DOMAIN=.*$/m, ''));
      const r2 = spawnSync('docker', ['compose', 'config', '--quiet'], { cwd: work, encoding: 'utf8', timeout: 60000 });
      check('بی دامنه ⇒ compose با پیامِ روشن رد می‌کند', r2.status !== 0 && /HLP_DOMAIN/.test(r2.stderr), r2.stderr);
    }
  }

  console.log('── ۳) caddy validate ──');
  const daemon = hasCli && spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8', timeout: 8000 }).status === 0;
  if (!daemon) {
    skip('caddy validate (هر دو Caddyfile)', 'دیمنِ داکر جواب نداد — روی رانرِ CI سنجیده می‌شود');
  } else {
    for (const file of ['Caddyfile', 'Caddyfile.panel']) {
      const r = spawnSync('docker', ['run', '--rm', '-v', `${path.join(DIR, 'caddy')}:/etc/caddy:ro`,
        '-e', 'API_HOST=api.example.org', '-e', 'ADMIN_HOST=admin.example.org', '-e', 'PANEL_HOST=panel.example.org',
        'caddy:2.8-alpine', 'caddy', 'validate', '--config', `/etc/caddy/${file}`, '--adapter', 'caddyfile'], { encoding: 'utf8', timeout: 180000 });
      check(`caddy validate ${file}`, r.status === 0, `${r.stdout}\n${r.stderr}`.slice(-600));
    }
  }
} finally {
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${failed ? '❌' : '✅'} پیکربندیِ داکر: ${passed} درست، ${failed} نادرست، ${skipped} سنجیده‌نشده`);
process.exit(failed ? 1 : 0);
