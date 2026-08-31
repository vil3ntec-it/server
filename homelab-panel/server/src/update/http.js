// ---------------------------------------------------------------------------
//  درخواستِ HTTP برای به‌روزرسانی — با پشتیبانیِ پراکسی
//
//  چرا خودمان نوشتیم: fetch داخلیِ Node متغیرهای HTTPS_PROXY را نادیده می‌گیرد.
//  روی سرورِ خانگی معمولاً پراکسی‌ای در کار نیست، ولی روی شبکهٔ اداری یا
//  کانتینری که فقط از راهِ پراکسی به اینترنت می‌رسد، بدونِ این، به‌روزرسانی
//  اصلاً کار نمی‌کند.
//
//  فقط از ماژول‌های خودِ Node استفاده می‌شود.
// ---------------------------------------------------------------------------
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';

/** آیا این میزبان در فهرستِ «بدونِ پراکسی» است؟ */
function bypassed(hostname) {
  const list = String(process.env.NO_PROXY || process.env.no_proxy || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.some((rule) => {
    if (rule === '*') return true;
    const clean = rule.startsWith('.') ? rule.slice(1) : rule;
    return hostname === clean || hostname.endsWith(`.${clean}`);
  });
}

/** پراکسیِ مناسب برای این آدرس، یا null */
export function proxyFor(target) {
  if (bypassed(target.hostname)) return null;
  const raw =
    target.protocol === 'https:'
      ? process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy
      : process.env.HTTP_PROXY || process.env.http_proxy || process.env.ALL_PROXY || process.env.all_proxy;
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** گواهی‌های اضافیِ سیستم (اگر مسیرشان داده شده باشد) */
function extraCa() {
  const path = process.env.NODE_EXTRA_CA_CERTS;
  if (!path) return undefined;
  try {
    return fs.readFileSync(path);
  } catch {
    return undefined;
  }
}

/** تونلِ CONNECT تا میزبانِ مقصد باز می‌کند و سوکتِ TLS برمی‌گرداند */
function connectThroughProxy(proxy, target, timeout) {
  return new Promise((resolve, reject) => {
    const port = Number(proxy.port) || (proxy.protocol === 'https:' ? 443 : 80);
    const targetPort = Number(target.port) || (target.protocol === 'https:' ? 443 : 80);
    const headers = { host: `${target.hostname}:${targetPort}` };
    if (proxy.username) {
      const auth = Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password || '')}`).toString('base64');
      headers['proxy-authorization'] = `Basic ${auth}`;
    }

    const req = (proxy.protocol === 'https:' ? https : http).request({
      host: proxy.hostname,
      port,
      method: 'CONNECT',
      path: `${target.hostname}:${targetPort}`,
      headers,
      timeout,
      rejectUnauthorized: false,
    });

    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        return reject(new Error(`proxy_connect_${res.statusCode}`));
      }
      resolve(socket);
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('proxy_timeout'));
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * یک درخواستِ GET با دنبال کردنِ تغییرِ مسیر.
 * @returns {{status:number, headers:object, stream:import('node:stream').Readable}}
 */
export async function get(url, { headers = {}, timeout = 30000, maxRedirects = 5 } = {}) {
  let target = typeof url === 'string' ? new URL(url) : url;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const proxy = proxyFor(target);
    const secure = target.protocol === 'https:';
    const port = Number(target.port) || (secure ? 443 : 80);
    const path = `${target.pathname}${target.search}`;
    const ca = extraCa();

    const options = {
      method: 'GET',
      headers: { host: target.host, ...headers },
      timeout,
      ...(ca ? { ca } : {}),
    };

    let res;
    if (proxy && secure) {
      const socket = await connectThroughProxy(proxy, target, timeout);
      res = await sendOn(https, { ...options, socket, servername: target.hostname, path, createConnection: () => tls.connect({ socket, servername: target.hostname, ...(ca ? { ca } : {}) }) });
    } else if (proxy) {
      // برای http ساده، پراکسی خودش مسیرِ کامل را می‌گیرد
      res = await sendOn(http, {
        ...options,
        host: proxy.hostname,
        port: Number(proxy.port) || 80,
        path: target.toString(),
      });
    } else {
      res = await sendOn(secure ? https : http, { ...options, host: target.hostname, port, path });
    }

    const status = res.statusCode || 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      target = new URL(res.headers.location, target);
      continue;
    }
    return { status, headers: res.headers, stream: res, url: target.toString() };
  }

  throw new Error('too_many_redirects');
}

function sendOn(mod, options) {
  return new Promise((resolve, reject) => {
    const req = mod.request(options, resolve);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('request_timeout'));
    });
    req.on('error', reject);
    req.end();
  });
}

/** همان get، ولی بدنه را به‌صورت متن برمی‌گرداند */
export async function getText(url, options = {}) {
  const res = await get(url, options);
  let body = '';
  for await (const chunk of res.stream) body += chunk;
  return { status: res.status, headers: res.headers, body };
}

/** همان get، ولی JSON */
export async function getJson(url, options = {}) {
  const res = await getText(url, options);
  let json = null;
  try {
    json = res.body ? JSON.parse(res.body) : null;
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, json, body: res.body };
}
