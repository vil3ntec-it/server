// ---------------------------------------------------------------------------
//  آزمونِ واقعیِ Agent — خودِ اسکریپت اجرا می‌شود و گزارشِ واقعی می‌فرستد
//      node test/agent.mjs
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.TEST_PORT || 4799);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-agent-'));

let pass = 0;
let fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 300) : ''}`);
  }
};

const panel = spawn(
  process.execPath,
  ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')],
  {
    env: {
      ...process.env,
      HLP_PORT: String(PORT),
      HLP_HOST: '127.0.0.1',
      HLP_DATA_DIR: path.join(tmp, 'data'),
      HLP_SITES_ROOT: path.join(tmp, 'sites'),
      HLP_SITESYNC: '0',
      HLP_AI_ENABLED: '0',
      HLP_TUNNEL: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }
);
let panelOut = '';
panel.stdout.on('data', (d) => (panelOut += d));
panel.stderr.on('data', (d) => (panelOut += d));

let agent = null;
let agentOut = '';
let token = null;

async function api(method, url, body) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch { /* JSON نبود */ }
  return { status: res.status, json, text };
}

try {
  // صبر تا بالا آمدنِ پنل
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) break;
    } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log('\n── آماده‌سازی ──');
  let r = await api('POST', '/api/auth/setup', { username: 'admin', password: 'ControlCenter!2026' });
  token = r.json?.token;
  check('پنل بالا آمد', Boolean(token), r.text);

  r = await api('POST', '/api/control/servers', { name: 'سرورِ آزمایشی', kind: 'vps', ip: '127.0.0.1' });
  const server = r.json.server;
  check('سرور ثبت شد', r.status === 201, r.text);

  r = await api('POST', `/api/control/servers/${server.server_id}/agent/key`, { panelUrl: BASE });
  const key = r.json?.key;
  check('کلیدِ Agent ساخته شد', typeof key === 'string' && key.length === 64, r.text);

  console.log('\n── اجرای واقعیِ Agent ──');
  agent = spawn(process.execPath, [path.join(import.meta.dirname, '..', '..', 'agent', 'agent.mjs')], {
    env: {
      ...process.env,
      CC_PANEL_URL: BASE,
      CC_SERVER_ID: server.server_id,
      CC_AGENT_KEY: key,
      CC_INTERVAL: '10',
      CC_SERVICES: `panel:${PORT}:127.0.0.1,closed:9`,
      CC_HEALTH_HTTP: `${BASE}/health`,
      CC_VERBOSE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  agent.stdout.on('data', (d) => (agentOut += d));
  agent.stderr.on('data', (d) => (agentOut += d));

  // منتظرِ اولین گزارش
  let info = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const res = await api('GET', `/api/control/servers/${server.server_id}/agent`);
    if (res.json?.lastSeen) {
      info = res.json;
      break;
    }
  }
  check('گزارشِ Agent رسید', Boolean(info), agentOut.slice(-500));

  if (info) {
    const rep = info.report;
    console.log('\n── محتوای گزارش ──');
    check('نامِ ماشین آمد', rep.os?.hostname === os.hostname(), JSON.stringify(rep.os));
    check('تعدادِ هسته درست است', rep.cpu?.cores === os.cpus().length, String(rep.cpu?.cores));
    check('حافظهٔ کل درست است', Math.abs((rep.memory?.total || 0) - os.totalmem()) < 1024 * 1024, String(rep.memory?.total));
    check('درصدِ حافظه منطقی است', rep.memory?.usage >= 0 && rep.memory?.usage <= 100, String(rep.memory?.usage));
    check('اطلاعاتِ دیسک آمد', Array.isArray(rep.storage) && rep.storage.length > 0 && rep.storage[0].total > 0, JSON.stringify(rep.storage?.[0]));
    check('نسخهٔ Node آمد', rep.runtimes?.node === process.version, String(rep.runtimes?.node));
    check('مدتِ روشن بودن آمد', rep.uptime > 0, String(rep.uptime));

    const svc = rep.services || [];
    const open = svc.find((s) => s.name === 'panel');
    const closed = svc.find((s) => s.name === 'closed');
    check('سرویسِ باز، online گزارش شد', open?.status === 'online', JSON.stringify(open));
    check('سرویسِ بسته، offline گزارش شد', closed?.status === 'offline', JSON.stringify(closed));
    check('سلامتِ HTTP واقعاً سنجیده شد', rep.health?.http?.status === 'online' && rep.health.http.code === 200, JSON.stringify(rep.health));

    const res = await api('GET', `/api/control/servers/${server.server_id}`);
    check('وضعیتِ سرور online شد', res.json?.server?.status === 'online', res.text);
    check('کلیدِ Agent از API بیرون نمی‌رود', res.json?.server?.agent_key === undefined, res.text);
  }

  console.log('\n── کلیدِ باطل‌شده ──');
  await api('DELETE', `/api/control/servers/${server.server_id}/agent/key`);
  const rejected = await fetch(`${BASE}/api/control/agent/report`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-agent-server': server.server_id,
      'x-agent-timestamp': String(Math.floor(Date.now() / 1000)),
      'x-agent-signature': 'x'.repeat(64),
    },
    body: '{}',
  });
  check('بعد از باطل کردنِ کلید، گزارش پذیرفته نمی‌شود', rejected.status === 401, String(rejected.status));
} catch (e) {
  fail++;
  console.log(`\n❌ خطای غیرمنتظره: ${e.stack}`);
  console.log(panelOut.slice(-1500));
  console.log(agentOut.slice(-1000));
} finally {
  try {
    agent?.kill('SIGKILL');
  } catch { /* بسته */ }
  panel.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 800));
  panel.kill('SIGKILL');
  await fsp.rm(tmp, { recursive: true, force: true });
}

console.log('\n════════════════════════════════════');
console.log(`  موفق: ${pass}    ناموفق: ${fail}`);
console.log('════════════════════════════════════\n');
process.exit(fail ? 1 : 0);
