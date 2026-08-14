// ---------------------------------------------------------------------------
// بررسی واقعی دامنه: DNS، گواهی SSL، تاریخ انقضای ثبت (WHOIS) و وضعیت HTTP
// همه با ابزارهای خود Node انجام می‌شود — بدون سرویس یا کتابخانهٔ بیرونی.
// ---------------------------------------------------------------------------
import dns from 'node:dns/promises';
import tls from 'node:tls';
import net from 'node:net';
import https from 'node:https';
import http from 'node:http';

export async function checkDns(domain) {
  const out = { status: 'unknown', a: [], cname: [], ns: [], error: null };
  try {
    out.a = await dns.resolve4(domain);
    out.status = out.a.length ? 'ok' : 'no_records';
  } catch (e) {
    if (e.code === 'ENOTFOUND' || e.code === 'ENODATA') {
      try {
        out.cname = await dns.resolveCname(domain);
        out.status = out.cname.length ? 'ok' : 'no_records';
      } catch {
        out.status = e.code === 'ENOTFOUND' ? 'not_found' : 'no_records';
        out.error = e.code;
      }
    } else {
      out.status = 'error';
      out.error = e.code || e.message;
    }
  }
  try {
    out.ns = await dns.resolveNs(domain);
  } catch { /* ممکن است ساب‌دامین باشد */ }
  return out;
}

export function checkSsl(domain, port = 443, timeout = 6000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    let socket;
    try {
      socket = tls.connect(
        { host: domain, port, servername: domain, timeout, rejectUnauthorized: false },
        () => {
          const cert = socket.getPeerCertificate();
          const authorized = socket.authorized;
          const validTo = cert?.valid_to ? Date.parse(cert.valid_to) : null;
          const validFrom = cert?.valid_from ? Date.parse(cert.valid_from) : null;
          socket.end();
          if (!cert || !Object.keys(cert).length) return done({ status: 'none', issuer: null, expiresAt: null });
          done({
            status: authorized ? 'valid' : validTo && validTo < Date.now() ? 'expired' : 'untrusted',
            issuer: cert.issuer?.O || cert.issuer?.CN || null,
            subject: cert.subject?.CN || null,
            expiresAt: Number.isFinite(validTo) ? validTo : null,
            issuedAt: Number.isFinite(validFrom) ? validFrom : null,
            daysLeft: Number.isFinite(validTo) ? Math.floor((validTo - Date.now()) / 86400000) : null,
          });
        }
      );
      socket.on('timeout', () => {
        socket.destroy();
        done({ status: 'timeout', issuer: null, expiresAt: null });
      });
      socket.on('error', () => done({ status: 'unreachable', issuer: null, expiresAt: null }));
    } catch {
      done({ status: 'unreachable', issuer: null, expiresAt: null });
    }
  });
}

// WHOIS از طریق پورت ۴۳ — بدون کتابخانه
function whoisQuery(server, query, timeout = 7000) {
  return new Promise((resolve) => {
    let data = '';
    let settled = false;
    const done = (v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const socket = net.createConnection({ host: server, port: 43, timeout }, () => {
      socket.write(query + '\r\n');
    });
    socket.setEncoding('utf8');
    socket.on('data', (c) => {
      data += c;
      if (data.length > 200000) socket.destroy();
    });
    socket.on('end', () => done(data));
    socket.on('timeout', () => {
      socket.destroy();
      done(data || null);
    });
    socket.on('error', () => done(data || null));
  });
}

function parseWhoisDate(text, keys) {
  if (!text) return null;
  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    if (!keys.includes(key)) continue;
    const value = line.slice(idx + 1).trim();
    const ts = Date.parse(value);
    if (Number.isFinite(ts)) return ts;
  }
  return null;
}

export async function checkWhois(domain) {
  const tld = String(domain).split('.').pop().toLowerCase();
  // پیدا کردن سرور whois از IANA (واقعی، بدون جدول دستی)
  const ianaText = await whoisQuery('whois.iana.org', tld);
  let server = null;
  if (ianaText) {
    const m = ianaText.match(/^whois:\s*(\S+)/mi);
    if (m) server = m[1];
  }
  if (!server) return { status: 'unknown', expiresAt: null, registrar: null };

  const text = await whoisQuery(server, domain);
  if (!text) return { status: 'unknown', expiresAt: null, registrar: null };

  const expiresAt = parseWhoisDate(text, [
    'registry expiry date',
    'expiry date',
    'expiration date',
    'registrar registration expiration date',
    'paid-till',
    'expires',
    'expire',
    'expires on',
  ]);
  let registrar = null;
  const rm = text.match(/^registrar:\s*(.+)$/mi);
  if (rm) registrar = rm[1].trim();

  const notFound = /no match|not found|no data found|no entries found/i.test(text);
  return {
    status: notFound ? 'not_registered' : expiresAt ? 'ok' : 'unknown',
    expiresAt,
    registrar,
    daysLeft: expiresAt ? Math.floor((expiresAt - Date.now()) / 86400000) : null,
  };
}

export function checkHttp(domain, timeout = 6000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const tryOnce = (mod, proto) => {
      try {
        const req = mod.request(
          { host: domain, path: '/', method: 'HEAD', timeout, rejectUnauthorized: false },
          (res) => {
            res.resume();
            done({ status: res.statusCode, protocol: proto });
          }
        );
        req.on('timeout', () => {
          req.destroy();
          done(null);
        });
        req.on('error', () => done(null));
        req.end();
      } catch {
        done(null);
      }
    };
    tryOnce(https, 'https');
    setTimeout(() => {
      if (!settled) tryOnce(http, 'http');
    }, timeout + 100);
  });
}

export async function checkDomain(domain, { whois = true } = {}) {
  const name = String(domain).trim().toLowerCase();
  const [dnsRes, sslRes, httpRes] = await Promise.all([
    checkDns(name),
    checkSsl(name),
    checkHttp(name),
  ]);
  const whoisRes = whois ? await checkWhois(name) : { status: 'skipped', expiresAt: null };
  return {
    domain: name,
    checkedAt: Date.now(),
    dns: dnsRes,
    ssl: sslRes,
    whois: whoisRes,
    http: httpRes,
    online: Boolean(httpRes && httpRes.status && httpRes.status < 500),
  };
}
