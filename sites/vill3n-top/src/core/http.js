'use strict';
// هستهٔ HTTP: مسیریاب، فشرده‌سازی، سرآیندهای امنیتی، فایل ایستا، دانلود با Range و محدودیت نرخ.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { ipKey } = require('./util');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'inline-speculation-rules'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

function isLoopback(addr) {
  return !addr || addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

class Limiter {
  constructor() {
    this.m = new Map();
    const t = setInterval(() => { const now = Date.now(); for (const [k, v] of this.m) if (v.reset < now) this.m.delete(k); }, 60000);
    if (t.unref) t.unref();
  }
  // true یعنی مجاز است
  hit(key, max, windowMs) {
    const now = Date.now();
    let e = this.m.get(key);
    if (!e || e.reset < now) { e = { n: 0, reset: now + windowMs }; this.m.set(key, e); }
    e.n++;
    return e.n <= max;
  }
  peek(key, max) { const e = this.m.get(key); return !e || e.reset < Date.now() || e.n < max; }
  retry(key) { const e = this.m.get(key); return e ? Math.max(1, Math.ceil((e.reset - Date.now()) / 1000)) : 0; }
  clear(key) { this.m.delete(key); }
}

class Ctx {
  constructor(app, req, res) {
    this.app = app; this.req = req; this.res = res;
    let u;
    try { u = new URL(req.url, 'http://x'); } catch (_) { throw new HttpError(400, 'نشانی درخواست درست نیست'); }
    if (u.host !== 'x') throw new HttpError(400, 'نشانی درخواست درست نیست');
    this.path = decodePath(u.pathname);
    this.query = u.searchParams;
    this.method = req.method;
    this.params = {};
    const h = req.headers;
    const peer = req.socket.remoteAddress;
    this.viaProxy = !!(h['x-forwarded-for'] || h['cf-connecting-ip'] || h['x-real-ip'] || h['forwarded'] || h['via'] || h['cf-ray'] || h['cdn-loop']);
    const trusted = isLoopback(peer) || app.trustProxy;
    let ip = peer || '';
    let secure = !!req.socket.encrypted;
    if (trusted && this.viaProxy) {
      // نشانی بازدیدکننده را فقط از چیزی می‌خوانیم که واسطِ خودمان نوشته است، نه چیزی که بازدیدکننده بتواند جعل کند:
      // آخرین نشانیِ X-Forwarded-For را همیشه نزدیک‌ترین واسط (cloudflared، Caddy، Nginx) اضافه می‌کند.
      // CF-Connecting-IP فقط وقتی پذیرفته می‌شود که در config.json نوشته باشید پشت Cloudflare هستید ("proxy": "cloudflare").
      const xff = String(h['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
      const cf = app.proxy === 'cloudflare' ? String(h['cf-connecting-ip'] || '') : '';
      ip = cf || xff[xff.length - 1] || (xff.length ? '' : String(h['x-real-ip'] || '')) || ip;
      if (h['x-forwarded-proto']) secure = String(h['x-forwarded-proto']).split(',')[0].trim() === 'https';
      else if (/https/.test(String(h['cf-visitor'] || ''))) secure = true;
    }
    this.ip = String(ip || '').replace(/^::ffff:/, '').replace(/[^0-9a-fA-F:.]/g, '').slice(0, 64);
    // اگر نشانی واقعی بازدیدکننده در دست نباشد (مثلاً بعضی هاست‌ها)، محدودیتِ «به‌ازای هر نشانی» قفل همگانی نمی‌سازد
    this.ipKnown = !!this.ip && !isLoopback(this.ip);
    this.ipKey = ipKey(this.ip) || 'local';
    this.secure = secure;
    this.local = isLoopback(peer) && !this.viaProxy;
    this.host = String(h['x-forwarded-host'] && app.trustProxy ? h['x-forwarded-host'] : h.host || '').split(',')[0].trim().toLowerCase().slice(0, 200);
    this.origin = `${secure ? 'https' : 'http'}://${this.host}`;
    this.ua = String(h['user-agent'] || '').slice(0, 300);
    this.cookies = parseCookies(h.cookie);
  }

  header(k, v) { this.res.setHeader(k, v); return this; }

  send(status, body, type, extra) {
    const res = this.res;
    if (res.headersSent) return;
    let buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''), 'utf8');
    res.statusCode = status;
    if (type) res.setHeader('Content-Type', type);
    if (extra) for (const k of Object.keys(extra)) res.setHeader(k, extra[k]);
    const compressible = /^(text\/|application\/(json|javascript|xml|manifest\+json)|image\/svg)/.test(String(res.getHeader('Content-Type') || ''));
    if (compressible && buf.length > 900 && !res.getHeader('Content-Encoding')) {
      const ae = String(this.req.headers['accept-encoding'] || '');
      res.setHeader('Vary', 'Accept-Encoding');
      if (/\bbr\b/.test(ae)) { buf = zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } }); res.setHeader('Content-Encoding', 'br'); }
      else if (/\bgzip\b/.test(ae)) { buf = zlib.gzipSync(buf, { level: 6 }); res.setHeader('Content-Encoding', 'gzip'); }
    }
    res.setHeader('Content-Length', buf.length);
    res.end(this.method === 'HEAD' ? undefined : buf);
  }

  // پاسخ از پیش فشرده‌شده (صفحه‌های کش‌شده و فایل‌های ایستا)
  sendPre(status, pre, type, extra) {
    const res = this.res;
    const inm = this.req.headers['if-none-match'];
    if (extra) for (const k of Object.keys(extra)) res.setHeader(k, extra[k]);
    res.setHeader('ETag', pre.etag);
    res.setHeader('Vary', 'Accept-Encoding');
    if (status === 200 && inm && inm === pre.etag) { res.statusCode = 304; res.end(); return; }
    const ae = String(this.req.headers['accept-encoding'] || '');
    let buf = pre.raw;
    if (pre.br && /\bbr\b/.test(ae)) { buf = pre.br; res.setHeader('Content-Encoding', 'br'); }
    else if (pre.gz && /\bgzip\b/.test(ae)) { buf = pre.gz; res.setHeader('Content-Encoding', 'gzip'); }
    res.statusCode = status;
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', buf.length);
    res.end(this.method === 'HEAD' ? undefined : buf);
  }

  json(obj, status = 200) { this.send(status, JSON.stringify(obj), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' }); }
  html(str, status = 200, extra) { this.send(status, str, 'text/html; charset=utf-8', extra); }
  redirect(loc, code = 302) { this.res.statusCode = code; this.res.setHeader('Location', loc); this.res.setHeader('Content-Length', 0); this.res.end(); }

  readBody(limit = 1024 * 1024) {
    return new Promise((resolve, reject) => {
      const len = Number(this.req.headers['content-length'] || 0);
      if (len > limit) return reject(new HttpError(413, 'حجم درخواست زیاد است'));
      const chunks = [];
      let size = 0;
      this.req.on('data', (c) => {
        size += c.length;
        if (size > limit) { reject(new HttpError(413, 'حجم درخواست زیاد است')); this.req.destroy(); return; }
        chunks.push(c);
      });
      this.req.on('end', () => resolve(Buffer.concat(chunks)));
      this.req.on('aborted', () => reject(new HttpError(400, 'درخواست قطع شد')));
      this.req.on('error', () => reject(new HttpError(400, 'درخواست قطع شد')));
    });
  }

  async readJson(limit) {
    const buf = await this.readBody(limit);
    if (!buf.length) return {};
    try {
      const v = JSON.parse(buf.toString('utf8'));
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not object');
      return v;
    } catch (_) { throw new HttpError(400, 'دادهٔ فرستاده‌شده درست نیست'); }
  }

  setCookie(name, value, { maxAge, path: p = '/' } = {}) {
    let c = `${name}=${encodeURIComponent(value)}; Path=${p}; HttpOnly; SameSite=Strict`;
    if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
    if (this.secure) c += '; Secure';
    const prev = this.res.getHeader('Set-Cookie');
    this.res.setHeader('Set-Cookie', prev ? [].concat(prev, c) : c);
  }
}

function decodePath(p) {
  try { p = decodeURIComponent(p); } catch (_) { /* همان خام */ }
  p = p.replace(/\/{2,}/g, '/');
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

function parseCookies(h) {
  const out = {};
  if (!h) return out;
  for (const part of String(h).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch (_) { out[k] = part.slice(i + 1).trim(); }
  }
  return out;
}

function precompress(raw) {
  const pre = { raw, etag: `"${crypto.createHash('sha1').update(raw).digest('base64url').slice(0, 20)}"` };
  if (raw.length > 600) {
    pre.br = zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } });
    pre.gz = zlib.gzipSync(raw, { level: 9 });
  }
  return pre;
}

// فایل‌های ایستای خودِ سایت (CSS/JS/فونت) در حافظه و از پیش فشرده
class Assets {
  constructor(dir) { this.dir = dir; this.cache = new Map(); }
  get(name) {
    if (!/^[\w][\w./\-[\]]*$/.test(name) || name.includes('..')) return null;
    const file = path.join(this.dir, name);
    let st;
    try { st = fs.statSync(file); } catch (_) { this.cache.delete(name); return null; }
    if (!st.isFile()) return null;
    const hit = this.cache.get(name);
    if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit;
    const raw = fs.readFileSync(file);
    const ext = path.extname(name).toLowerCase();
    const textual = /\.(css|js|svg|json|html|txt|xml|webmanifest)$/.test(ext);
    const pre = textual ? precompress(raw) : { raw, etag: `"${crypto.createHash('sha1').update(raw).digest('base64url').slice(0, 20)}"` };
    const item = Object.assign(pre, { mtime: st.mtimeMs, size: st.size, type: MIME[ext] || 'application/octet-stream', hash: pre.etag.slice(1, 9) });
    this.cache.set(name, item);
    return item;
  }
  url(name) { const a = this.get(name); return a ? `/assets/${name}?v=${a.hash}` : `/assets/${name}`; }
}

// ارسال فایل بزرگ با پشتیبانی از ادامهٔ دانلود (Range)
function sendFile(ctx, file, { type = 'application/octet-stream', downloadName, cache = 'no-store', onStart, etag } = {}) {
  let st;
  try { st = fs.statSync(file); } catch (_) { throw new HttpError(404, 'فایل پیدا نشد'); }
  const res = ctx.res;
  const size = st.size;
  let start = 0, end = size - 1, status = 200;
  let range = ctx.req.headers.range;
  // ادامهٔ دانلود فقط وقتی مجاز است که فایل همان فایلِ قبلی باشد (وگرنه دو نسخه به هم می‌چسبند)
  const ifRange = ctx.req.headers['if-range'];
  if (range && ifRange && ifRange !== etag && ifRange !== st.mtime.toUTCString()) range = '';
  if (etag) res.setHeader('ETag', etag);
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
    if (m && (m[1] || m[2])) {
      if (m[1]) { start = Number(m[1]); if (m[2]) end = Math.min(Number(m[2]), size - 1); }
      else { start = Math.max(0, size - Number(m[2])); }
      if (start > end || start >= size) {
        res.statusCode = 416; res.setHeader('Content-Range', `bytes */${size}`); res.end(); return;
      }
      status = 206;
    }
  }
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Length', end - start + 1);
  res.setHeader('Cache-Control', cache);
  res.setHeader('Last-Modified', st.mtime.toUTCString());
  if (status === 206) res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  if (downloadName) {
    const ascii = downloadName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`);
  }
  if (onStart && start === 0) onStart();
  if (ctx.method === 'HEAD') { res.end(); return; }
  const rs = fs.createReadStream(file, { start, end });
  rs.on('error', () => res.destroy());
  res.on('close', () => rs.destroy());
  rs.pipe(res);
}

class App {
  constructor({ trustProxy = false, proxy = '' } = {}) {
    this.routes = [];
    this.trustProxy = trustProxy;
    this.proxy = proxy;
    this.limiter = new Limiter();
  }

  on(method, pattern, handler) {
    const keys = [];
    const rx = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }).replace(/\*$/, '(.*)') + '$');
    if (pattern.endsWith('*')) keys.push('rest');
    this.routes.push({ method, rx, keys, handler });
    return this;
  }
  get(p, h) { return this.on('GET', p, h); }
  post(p, h) { return this.on('POST', p, h); }
  put(p, h) { return this.on('PUT', p, h); }
  del(p, h) { return this.on('DELETE', p, h); }

  baseHeaders(ctx) {
    const res = ctx.res;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', this.csp || CSP);
    if (ctx.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  }

  async handle(req, res) {
    let ctx;
    try {
      ctx = new Ctx(this, req, res);
      this.baseHeaders(ctx);
      const method = req.method === 'HEAD' ? 'GET' : req.method;
      if (this.before) { const done = await this.before(ctx); if (done === true || res.writableEnded) return; }
      let pathMatched = false;
      for (const r of this.routes) {
        const m = r.rx.exec(ctx.path);
        if (!m) continue;
        pathMatched = true;
        if (r.method !== method) continue;
        r.keys.forEach((k, i) => { ctx.params[k] = m[i + 1]; });
        await r.handler(ctx);
        return;
      }
      if (pathMatched) throw new HttpError(405, 'این روش برای این نشانی مجاز نیست');
      if (this.notFound) await this.notFound(ctx); else throw new HttpError(404, 'پیدا نشد');
    } catch (err) {
      this.fail(ctx, req, res, err);
    }
  }

  fail(ctx, req, res, err) {
    const status = err && err.status ? err.status : 500;
    if (status >= 500) console.error(`[خطا] ${req.method} ${String(req.url).slice(0, 200)}\n`, err && err.stack ? err.stack : err);
    if (res.headersSent || res.writableEnded) { try { res.destroy(); } catch (_) { /* بسته */ } return; }
    const message = status >= 500 ? 'خطای داخلی سرور. دوباره تلاش کنید.' : err.message;
    const wantsJson = String(req.url).startsWith('/api/') || /json/.test(String(req.headers.accept || ''));
    try {
      if (wantsJson || !ctx || !this.errorPage) {
        const body = JSON.stringify(Object.assign({ ok: false, error: message }, err && err.extra));
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Length', Buffer.byteLength(body));
        res.end(body);
      } else {
        ctx.html(this.errorPage(ctx, status, message), status, { 'Cache-Control': 'no-store' });
      }
    } catch (_) { try { res.destroy(); } catch (__) { /* بسته */ } }
  }
}

module.exports = { App, Ctx, HttpError, Limiter, Assets, sendFile, precompress, MIME, isLoopback, CSP };
