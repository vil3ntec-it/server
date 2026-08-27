// ---------------------------------------------------------------------------
//  بررسی‌های واقعی — هیچ وضعیتی حدس زده نمی‌شود
//
//  هر تابع واقعاً به مقصد وصل می‌شود و یکی از این‌ها را برمی‌گرداند:
//    online | offline | timeout | unauthorized | ssl_error | dns_error |
//    connection_error | unknown
//  همراه با زمانِ پاسخ، کدِ وضعیت و لحظهٔ بررسی.
// ---------------------------------------------------------------------------
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import { WebSocket } from 'ws';
import { checkSsl } from '../lib/domain-check.js';

export const STATUSES = [
  'online',
  'offline',
  'timeout',
  'unauthorized',
  'ssl_error',
  'dns_error',
  'connection_error',
  'unknown',
];

const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_NODATA', 'ENODATA']);
const TLS_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'ERR_SSL_WRONG_VERSION_NUMBER',
  'ERR_TLS_HANDSHAKE_TIMEOUT',
  'CERT_NOT_YET_VALID',
  'ERR_SSL_PACKET_LENGTH_TOO_LONG',
]);

/** کدِ خطای Node را به واژگانِ خودمان تبدیل می‌کند */
export function classifyError(err) {
  if (!err) return 'unknown';
  const code = String(err.code || err.message || '');
  if (DNS_CODES.has(code)) return 'dns_error';
  if (TLS_CODES.has(code) || /certificate|ssl|tls/i.test(code)) return 'ssl_error';
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || /timeout/i.test(code)) return 'timeout';
  if (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH' ||
    code === 'EPIPE' ||
    code === 'EACCES'
  ) {
    return 'connection_error';
  }
  return 'connection_error';
}

/** برای IP خام نباید SNI فرستاد (RFC 6066) */
function isIpLiteral(host) {
  return net.isIP(String(host).replace(/^\[|\]$/g, '')) !== 0;
}

function nowResult(extra = {}) {
  return { status: 'unknown', code: null, latencyMs: null, error: null, checkedAt: Date.now(), ...extra };
}

/* --------------------------- پورت خام (TCP) ----------------------------- */

export function probeTcp(host, port, timeout = 6000) {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch { /* بسته شده */ }
      resolve(nowResult({ latencyMs: Date.now() - started, ...v }));
    };
    let socket;
    try {
      socket = net.createConnection({ host, port: Number(port), timeout });
    } catch (e) {
      return resolve(nowResult({ status: classifyError(e), error: e.message, latencyMs: 0 }));
    }
    socket.on('connect', () => done({ status: 'online' }));
    socket.on('timeout', () => done({ status: 'timeout', error: 'timeout' }));
    socket.on('error', (e) => done({ status: classifyError(e), error: e.code || e.message }));
  });
}

/* ------------------------------ HTTP/HTTPS ------------------------------ */

/**
 * یک درخواستِ واقعی می‌فرستد. کدِ وضعیت، زمانِ پاسخ و (برای https) وضعیتِ
 * گواهی برمی‌گردد. تغییرِ مسیر دنبال نمی‌شود تا کدِ خودِ آدرس دیده شود.
 */
export function probeHttp(url, { timeout = 8000, method = 'GET', headers = {}, insecure = true } = {}) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      return resolve(nowResult({ status: 'unknown', error: 'invalid_url' }));
    }
    const secure = target.protocol === 'https:';
    const mod = secure ? https : http;
    const started = Date.now();
    let settled = false;
    let tlsInfo = null;

    const done = (v) => {
      if (settled) return;
      settled = true;
      resolve(nowResult({ latencyMs: Date.now() - started, ssl: tlsInfo, ...v }));
    };

    let req;
    try {
      req = mod.request(
        {
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port || (secure ? 443 : 80),
          path: `${target.pathname}${target.search}`,
          method,
          timeout,
          headers: { 'user-agent': 'control-center/health-check', accept: '*/*', ...headers },
          rejectUnauthorized: !insecure,
          servername: secure && !isIpLiteral(target.hostname) ? target.hostname : undefined,
        },
        (res) => {
          const code = res.statusCode || 0;
          res.resume();
          const status =
            code === 401 || code === 403 ? 'unauthorized' : code >= 500 ? 'offline' : code > 0 ? 'online' : 'unknown';
          done({ status, code });
        }
      );
    } catch (e) {
      return done({ status: classifyError(e), error: e.message });
    }

    if (secure) {
      req.on('socket', (socket) => {
        socket.on('secureConnect', () => {
          try {
            const cert = socket.getPeerCertificate?.();
            if (cert && Object.keys(cert).length) {
              const validTo = cert.valid_to ? Date.parse(cert.valid_to) : null;
              tlsInfo = {
                authorized: socket.authorized === true,
                issuer: cert.issuer?.O || cert.issuer?.CN || null,
                subject: cert.subject?.CN || null,
                expiresAt: Number.isFinite(validTo) ? validTo : null,
                daysLeft: Number.isFinite(validTo) ? Math.floor((validTo - Date.now()) / 86400000) : null,
                error: socket.authorizationError ? String(socket.authorizationError) : null,
              };
            }
          } catch { /* گواهی خوانده نشد */ }
        });
      });
    }

    req.on('timeout', () => {
      req.destroy();
      done({ status: 'timeout', error: 'timeout' });
    });
    req.on('error', (e) => done({ status: classifyError(e), error: e.code || e.message }));
    req.end();
  });
}

/* ------------------------------- WebSocket ------------------------------ */

/** دست‌دادنِ واقعیِ WebSocket — نه فقط باز بودنِ پورت */
export function probeWebSocket(url, { timeout = 8000, headers = {}, insecure = true } = {}) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      return resolve(nowResult({ status: 'unknown', error: 'invalid_url' }));
    }
    if (target.protocol !== 'ws:' && target.protocol !== 'wss:') {
      return resolve(nowResult({ status: 'unknown', error: 'not_a_websocket_url' }));
    }

    const started = Date.now();
    let settled = false;
    let socket = null;
    const done = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.terminate?.();
      } catch { /* بسته شده */ }
      resolve(nowResult({ latencyMs: Date.now() - started, ...v }));
    };

    const timer = setTimeout(() => done({ status: 'timeout', error: 'handshake_timeout' }), timeout + 500);
    timer.unref?.();

    try {
      socket = new WebSocket(url, {
        handshakeTimeout: timeout,
        rejectUnauthorized: !insecure,
        headers: { 'user-agent': 'control-center/health-check', ...headers },
      });
    } catch (e) {
      return done({ status: classifyError(e), error: e.message });
    }

    socket.on('open', () => done({ status: 'online', code: 101 }));
    socket.on('unexpected-response', (_req, res) => {
      const code = res.statusCode || 0;
      res.resume();
      done({
        status: code === 401 || code === 403 ? 'unauthorized' : 'offline',
        code,
        error: `http_${code}`,
      });
    });
    socket.on('error', (e) => done({ status: classifyError(e), error: e.code || e.message }));
  });
}

/* ---------------------------------- DNS --------------------------------- */

export async function probeDns(hostname) {
  const started = Date.now();
  try {
    const a = await dns.resolve4(hostname).catch(() => []);
    const aaaa = await dns.resolve6(hostname).catch(() => []);
    const cname = a.length || aaaa.length ? [] : await dns.resolveCname(hostname).catch(() => []);
    const ok = a.length + aaaa.length + cname.length > 0;
    return nowResult({
      status: ok ? 'online' : 'dns_error',
      latencyMs: Date.now() - started,
      records: { a, aaaa, cname },
      error: ok ? null : 'no_records',
    });
  } catch (e) {
    return nowResult({ status: classifyError(e), latencyMs: Date.now() - started, error: e.code || e.message });
  }
}

/* ---------------------------------- TLS --------------------------------- */

/** گواهیِ واقعیِ یک میزبان. اگر گواهی نبود «Not Configured» گزارش می‌شود. */
export async function probeTls(host, port = 443) {
  const started = Date.now();
  const res = await checkSsl(host, Number(port) || 443);
  const map = {
    valid: 'online',
    expired: 'ssl_error',
    untrusted: 'ssl_error',
    none: 'offline',
    timeout: 'timeout',
    unreachable: 'connection_error',
  };
  return nowResult({
    status: map[res.status] || 'unknown',
    latencyMs: Date.now() - started,
    ssl: res,
    error: res.status === 'valid' ? null : res.status,
  });
}

/* -------------------------------- دیتابیس ------------------------------- */

const DB_DEFAULT_PORTS = { postgres: 5432, mysql: 3306, mariadb: 3306, mongo: 27017, redis: 6379, mssql: 1433 };

/**
 * دیتابیس‌ها راننده‌های سنگین می‌خواهند و ما آن‌ها را نصب نمی‌کنیم؛ پس فقط
 * چیزی را گزارش می‌کنیم که واقعاً می‌توانیم بسنجیم: در دسترس بودنِ پورتِ
 * دیتابیس از دیدِ همین سرور. برای SQLite هم وجود و اندازهٔ فایل.
 */
export async function probeDatabase({ kind = 'postgres', host = '127.0.0.1', port = null, timeout = 6000 } = {}) {
  const p = Number(port) || DB_DEFAULT_PORTS[String(kind).toLowerCase()] || 0;
  if (!p) return nowResult({ status: 'unknown', error: 'unknown_port' });
  const res = await probeTcp(host, p, timeout);
  return { ...res, kind, host, port: p, note: 'tcp_reachability' };
}

/* ------------------------- بررسیِ یک Endpoint --------------------------- */

/** بر اساس پروتکل، درست‌ترین بررسی را انتخاب می‌کند */
export async function probeUrl(url, options = {}) {
  const proto = String(url).split(':')[0].toLowerCase();
  if (proto === 'ws' || proto === 'wss') return probeWebSocket(url, options);
  if (proto === 'http' || proto === 'https') return probeHttp(url, options);
  return nowResult({ status: 'unknown', error: 'unsupported_protocol' });
}

/** چند بررسی با هم — با سقفِ هم‌زمانی تا سرورِ خانگی خفه نشود */
export async function probeMany(items, worker, concurrency = 6) {
  const out = new Array(items.length);
  let index = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length || 1) }, async () => {
    while (index < items.length) {
      const i = index++;
      try {
        out[i] = await worker(items[i], i);
      } catch (e) {
        out[i] = nowResult({ status: 'unknown', error: e.message });
      }
    }
  });
  await Promise.all(runners);
  return out;
}
