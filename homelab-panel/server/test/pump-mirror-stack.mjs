// ---------------------------------------------------------------------------
//  پشتهٔ دستی برای سنجهٔ سرتاسریِ «آپدیت از سرورِ پمپ»
//
//      node test/pump-mirror-stack.mjs <live.json>
//      dotnet run --project PumpYaqobi.UiTests -c Release -- pumpmirror <pub> <version>   (ریپوی پمپ)
//
//  پنلِ واقعی + گیت‌هابِ ساختگی بالا می‌آید، یک انتشار (با SHA256SUMS درست)
//  می‌گذارد، کارِ آینه را یک بار می‌دواند و نشانیِ پورتِ عمومی را در live.json
//  می‌نویسد. تا Ctrl+C بالا می‌ماند. ⚠️ در CI نیست.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const LIVE = process.argv[2] || path.join(os.tmpdir(), 'pump-mirror-live.json');
const PORT = Number(process.env.TEST_PORT || 4891);
const GH = PORT + 50;
const VERSION = process.env.MIRROR_VERSION || '99.9.9';
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const files = {
  'PumpYaqobi-Setup.exe': crypto.randomBytes(2_000_000),
  'PumpYaqobi-app-ffffffff.zip': crypto.randomBytes(200_000),
};
files['SHA256SUMS.txt'] = Buffer.from(Object.entries(files).map(([n, b]) => `${sha(b)}  ${n}`).join('\n') + '\n');
const release = {
  tag_name: `v${VERSION}`, name: VERSION, body: 'آزمونِ آینه', published_at: new Date().toISOString(),
  assets: Object.entries(files).map(([name, b], i) => ({
    id: i + 1, name, size: b.length, url: `http://127.0.0.1:${GH}/blob/${name}`,
    browser_download_url: `http://127.0.0.1:${GH}/blob/${name}`,
  })),
};
http.createServer((req, res) => {
  if (req.url.endsWith('/releases/latest')) {
    res.writeHead(200, { 'content-type': 'application/json', etag: '"x"' }); return res.end(JSON.stringify(release));
  }
  const m = /^\/blob\/(.+)$/.exec(req.url);
  if (m && files[m[1]]) { res.writeHead(200); return res.end(files[m[1]]); }
  res.writeHead(404); res.end();
}).listen(GH, '127.0.0.1');

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-mirrorstack-'));
fs.mkdirSync(path.join(tmp, 'sites'));
const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning',
  path.join(import.meta.dirname, '..', 'src', 'index.js')], {
  env: { ...process.env, HLP_PORT: String(PORT), HLP_SITESYNC_PORT: String(PORT + 1), HLP_HOST: '127.0.0.1',
    HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'), HLP_TUNNEL: '0',
    HLP_AI_ENABLED: '0', HLP_SITESYNC: '1', HLP_ACCOUNT_AUTOSTART: '0',
    HLP_PUMP_MIRROR: '1', HLP_GITHUB_API: `http://127.0.0.1:${GH}` },
  stdio: 'inherit',
});
const BASE = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 125; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* */ } await wait(200); }
const j = async (u, b, t) => (await fetch(BASE + u, { method: 'POST', headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify(b) })).json();
const tok = (await j('/api/auth/setup', { username: 'admin', password: 'ControlCenter!2026' })).token;
const run = await j('/api/automation/jobs/pump-update-mirror/run', {}, tok);
console.log('mirror:', run.status);
fs.writeFileSync(LIVE, JSON.stringify({ pub: `http://127.0.0.1:${PORT + 1}`, version: VERSION }));
console.log('ready', LIVE);
process.on('SIGINT', () => { child.kill(); process.exit(0); });
process.on('SIGTERM', () => { child.kill(); process.exit(0); });
