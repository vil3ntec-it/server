#!/usr/bin/env node
// ---------------------------------------------------------------------------
//  cloudflaredِ ساختگی — دقیقاً مثل نسخهٔ واقعی رفتار می‌کند
//
//  با این می‌شود کلِ مسیرِ «آدرس ثابت» را بدون حساب Cloudflare و بدون اینترنت
//  آزمود؛ از جمله همان حالتی که کاربر گیر کرد:
//
//      تونل از قبل هست  →  «tunnel create» فایل اعتبار نمی‌نویسد
//                       →  فایل قبلی گم شده  →  credentials_not_found
//
//  رفتارش با متغیرهای محیطی کنترل می‌شود تا هر سناریو ساخته شود:
//      FAKE_CF_STATE       مسیر فایلی که وضعیت تونل‌ها در آن نگه داشته می‌شود
//      FAKE_CF_NO_TOKEN=1  دستور «tunnel token» را ناموفق کن
//      FAKE_CF_NO_DELETE=1 دستور «tunnel delete» را ناموفق کن
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const STATE_FILE = process.env.FAKE_CF_STATE || path.join(process.cwd(), 'fake-cf-state.json');

const readState = () => {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { tunnels: [], dns: [] };
  }
};
const writeState = (s) => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), 'utf8');

/** فایل اعتبار را همان‌جایی می‌نویسد که cloudflared واقعی می‌نویسد */
function writeCreds(dir, uuid) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${uuid}.json`),
    JSON.stringify({ AccountTag: 'fake', TunnelSecret: 'c2VjcmV0', TunnelID: uuid }),
    'utf8'
  );
}

const originCert = process.env.TUNNEL_ORIGIN_CERT || '';
const certDir = originCert ? path.dirname(originCert) : process.cwd();

let keepRunning = false;
const sub = args[0];
const verb = args[1];

// ------------------------------- tunnel ------------------------------------
if (sub === 'tunnel') {
  const state = readState();

  if (verb === 'create') {
    const name = args[2];
    const existing = state.tunnels.find((t) => t.name === name);
    if (existing) {
      // نسخهٔ واقعی هم دقیقاً همین را می‌گوید و فایل تازه‌ای نمی‌نویسد
      process.stderr.write(`tunnel with name ${name} already exists\n`);
      process.exit(1);
    }
    const uuid = crypto.randomUUID();
    state.tunnels.push({ name, uuid });
    writeState(state);
    writeCreds(certDir, uuid);
    process.stdout.write(`Created tunnel ${name} with id ${uuid}\n`);
    process.exit(0);
  }

  if (verb === 'list') {
    process.stdout.write(JSON.stringify(state.tunnels.map((t) => ({ id: t.uuid, name: t.name }))) + '\n');
    process.exit(0);
  }

  if (verb === 'token') {
    if (process.env.FAKE_CF_NO_TOKEN === '1') {
      process.stderr.write('failed to get tunnel token\n');
      process.exit(1);
    }
    const credFlag = args.indexOf('--cred-file');
    const target = credFlag >= 0 ? args[credFlag + 1] : null;
    const ref = args[args.length - 1];
    const t = state.tunnels.find((x) => x.name === ref || x.uuid === ref);
    if (!t) {
      process.stderr.write(`tunnel ${ref} not found\n`);
      process.exit(1);
    }
    if (target) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(
        target,
        JSON.stringify({ AccountTag: 'fake', TunnelSecret: 'c2VjcmV0', TunnelID: t.uuid }),
        'utf8'
      );
    }
    process.stdout.write('eyJhIjoiZmFrZSJ9\n');
    process.exit(0);
  }

  if (verb === 'delete') {
    if (process.env.FAKE_CF_NO_DELETE === '1') {
      process.stderr.write('cannot delete tunnel\n');
      process.exit(1);
    }
    const name = args[args.length - 1];
    const before = state.tunnels.length;
    state.tunnels = state.tunnels.filter((t) => t.name !== name);
    writeState(state);
    process.stdout.write(before === state.tunnels.length ? 'not found\n' : `Deleted tunnel ${name}\n`);
    process.exit(0);
  }

  if (verb === 'cleanup') process.exit(0);

  if (verb === 'route') {
    const host = args[args.length - 1];
    state.dns = [...new Set([...(state.dns || []), host])];
    writeState(state);
    process.stdout.write(`Added CNAME ${host}\n`);
    process.exit(0);
  }

  if (verb === 'login') {
    fs.mkdirSync(certDir, { recursive: true });
    fs.writeFileSync(originCert || path.join(certDir, 'cert.pem'), 'FAKE CERT', 'utf8');
    process.stdout.write('https://dash.cloudflare.com/argotunnel?fake=1\n');
    process.exit(0);
  }

  // «tunnel --config ... run» یا «tunnel run --token ...» — همان چیزی که سرور
  // منتظرش است تا آدرس ثابت را فعال بداند
  if (args.includes('run') || args.includes('--config')) {
    const configFlag = args.indexOf('--config');
    if (configFlag >= 0) {
      const cfg = fs.readFileSync(args[configFlag + 1], 'utf8');
      const cred = cfg.match(/^credentials-file:\s*(.+)$/m)?.[1]?.trim();
      // نسخهٔ واقعی هم اگر فایل اعتبار نباشد، همین‌جا می‌میرد
      if (!cred || !fs.existsSync(cred)) {
        process.stderr.write(`Cannot find credentials file ${cred}\n`);
        process.exit(1);
      }
    }
    process.stderr.write('Registered tunnel connection connIndex=0\n');
    // روی پا می‌ماند تا وقتی کشته شود — دقیقاً مثل cloudflared واقعی.
    // مهم: اینجا نباید به process.exit پایینِ فایل برسیم.
    setInterval(() => {}, 1 << 30);
    keepRunning = true;
  }
}

if (!keepRunning) process.exit(0);
