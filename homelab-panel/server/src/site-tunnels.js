// ---------------------------------------------------------------------------
//  آدرس اینترنتی برای «هر سایت» — نه فقط یکی
//
//  تونلِ اصلی فقط سرورِ داده را به اینترنت می‌رساند. اینجا برای هر سایتی که
//  بخواهید یک تونلِ جدا بالا می‌آید که مستقیم به پورتِ همان سایت وصل است؛
//  پس هر سایت آدرسِ https مستقلِ خودش را می‌گیرد:
//
//      سایت A (پورت 8100) → https://xxxx.trycloudflare.com
//      سایت B (پورت 8101) → https://yyyy.trycloudflare.com
//
//  اگر دامنهٔ خودتان را به سایت وصل کرده باشید، آدرس ثابتِ همان دامنه از راه
//  تونلِ نام‌دار می‌آید (tunnel.js) و دیگر به این تونل‌های سریع نیازی نیست.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { ensureBinary, binaryPath } from './tunnel.js';
import { logEvent, getSetting, setSetting } from './db.js';

export const siteTunnelEvents = new EventEmitter();

const QUICK_TUNNEL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const RESTART_DELAY_MS = 10000;

/** slug → { status, url, error, port, startedAt, restarts, child, timer, log } */
const tunnels = new Map();

function blank(slug, port) {
  return {
    slug,
    port: port ?? null,
    status: 'stopped', // stopped | installing | starting | running | error
    url: null,
    error: null,
    startedAt: null,
    restarts: 0,
    log: [],
    child: null,
    timer: null,
    stopping: false,
  };
}

function entry(slug, port) {
  let item = tunnels.get(slug);
  if (!item) {
    item = blank(slug, port);
    tunnels.set(slug, item);
  }
  if (port != null) item.port = port;
  return item;
}

export function siteTunnelState(slug) {
  const item = tunnels.get(slug);
  if (!item) return { slug, status: 'stopped', url: null, error: null, port: null, startedAt: null, restarts: 0 };
  return {
    slug: item.slug,
    port: item.port,
    status: item.status,
    url: item.url,
    error: item.error,
    startedAt: item.startedAt,
    restarts: item.restarts,
    log: item.log.slice(-8),
  };
}

export function allSiteTunnels() {
  return [...tunnels.keys()].map(siteTunnelState);
}

function emit(slug) {
  siteTunnelEvents.emit('change', siteTunnelState(slug));
}

function setStatus(item, status, extra = {}) {
  Object.assign(item, { status, ...extra });
  emit(item.slug);
}

// --------------------------- فهرستِ روشن‌ماندن‌ها ---------------------------
// تا بعد از خاموش و روشن شدنِ سرور، تونلِ همان سایت‌ها دوباره بالا بیاید
const wantedList = () => getSetting('site_tunnels', []) || [];

function remember(slug, wanted) {
  const list = new Set(wantedList());
  if (wanted) list.add(slug);
  else list.delete(slug);
  setSetting('site_tunnels', [...list]);
}

export function siteTunnelWanted(slug) {
  return wantedList().includes(slug);
}

// -------------------------------- اجرا -------------------------------------
export async function startSiteTunnel(site) {
  const slug = site.slug;
  if (!site.port) return { ok: false, error: 'no_port' };

  const item = entry(slug, site.port);
  remember(slug, true);
  if (item.child) return { ok: true, already: true, ...siteTunnelState(slug) };

  item.stopping = false;
  clearTimeout(item.timer);

  try {
    setStatus(item, 'installing', { error: null });
    await ensureBinary();
  } catch (e) {
    setStatus(item, 'error', { error: `cloudflared آماده نشد: ${e.message}` });
    logEvent('error', 'panel', `تونل سایت ${site.name}: ${item.error}`, site.id);
    return { ok: false, error: item.error };
  }

  setStatus(item, 'starting', { url: null, error: null });

  const child = spawn(
    binaryPath(),
    ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${site.port}`, '--loglevel', 'info'],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
  );
  item.child = child;

  const onData = (chunk) => {
    for (const raw of chunk.toString().split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      item.log.push(line.slice(0, 240));
      if (item.log.length > 30) item.log.shift();
      const found = item.url ? null : line.match(QUICK_TUNNEL_RE);
      if (found) {
        setStatus(item, 'running', { url: found[0], startedAt: Date.now(), error: null });
        logEvent('info', 'panel', `آدرس اینترنتی سایت «${site.name}»: ${found[0]}`, site.id);
      }
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData); // cloudflared بیشتر روی stderr می‌نویسد

  child.on('error', (e) => {
    item.child = null;
    setStatus(item, 'error', { error: e.message, url: null });
    logEvent('error', 'panel', `تونل سایت ${site.name} اجرا نشد: ${e.message}`, site.id);
  });

  child.on('exit', (code) => {
    item.child = null;
    if (item.stopping) {
      setStatus(item, 'stopped', { url: null, error: null });
      return;
    }
    item.restarts++;
    setStatus(item, 'error', { url: null, error: `تونل بسته شد (کد ${code ?? '-'}) — دوباره تلاش می‌شود` });
    item.timer = setTimeout(() => startSiteTunnel(site).catch(() => {}), RESTART_DELAY_MS);
    item.timer.unref?.();
  });

  return { ok: true, ...siteTunnelState(slug) };
}

export function stopSiteTunnel(slug, { forget = true } = {}) {
  const item = tunnels.get(slug);
  if (forget) remember(slug, false);
  if (!item) return { ok: true, already: true, ...siteTunnelState(slug) };

  item.stopping = true;
  clearTimeout(item.timer);
  if (item.child) {
    try {
      item.child.kill();
    } catch { /* بسته شده */ }
    item.child = null;
  }
  setStatus(item, 'stopped', { url: null, error: null });
  return { ok: true, ...siteTunnelState(slug) };
}

/** وقتی پورت سایت عوض شد، تونلش باید با پورت تازه دوباره بالا بیاید */
export async function restartSiteTunnel(site) {
  stopSiteTunnel(site.slug, { forget: false });
  return startSiteTunnel(site);
}

export function stopAllSiteTunnels() {
  for (const slug of [...tunnels.keys()]) stopSiteTunnel(slug, { forget: false });
}

/** بعد از راه‌اندازی سرور: تونلِ سایت‌هایی که قبلاً روشن بودند دوباره بالا می‌آید */
export async function autostartSiteTunnels(sites) {
  const wanted = new Set(wantedList());
  for (const site of sites) {
    if (!wanted.has(site.slug) || !site.port) continue;
    try {
      await startSiteTunnel(site);
    } catch (e) {
      logEvent('error', 'panel', `تونل سایت ${site.name} بالا نیامد: ${e.message}`, site.id);
    }
  }
}
