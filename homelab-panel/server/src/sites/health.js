// ---------------------------------------------------------------------------
//  «آنلاین یا آفلاین؟» — جوابِ درست، نه فقط تستِ پورتِ محلی
//
//  قبلاً فقط پورتِ روی همین کامپیوتر تست می‌شد؛ برای همین سایتی که واقعاً روی
//  اینترنت بالا بود (مثلاً روی هاست دیگری یا از راه تونل) «آفلاین» نشان داده
//  می‌شد. حالا سه چیز پشت سر هم بررسی می‌شود و اولین جوابِ مثبت کافی است:
//
//      ۱) پروسه‌ای که خودِ پنل اجرا کرده، زنده است؟
//      ۲) پورتِ محلیِ سایت جواب می‌دهد؟
//      ۳) دامنه/آدرس عمومیِ سایت از اینترنت جواب می‌دهد؟
//
//  تست شبکه کند است، پس نتیجه‌اش کش می‌شود و در پس‌زمینه تازه می‌شود.
// ---------------------------------------------------------------------------
import http from 'node:http';
import https from 'node:https';
import { isRunning, probePort } from './process.js';

const REMOTE_TTL_MS = 60_000; // تا یک دقیقه از نتیجهٔ قبلی استفاده می‌شود
const REMOTE_TIMEOUT_MS = 5000;

/** url → { at, online, status, pending } */
const remoteCache = new Map();

/** یک درخواست سبک (HEAD و اگر نشد GET) — فقط برای فهمیدنِ «جواب می‌دهد؟» */
function headCheck(url, timeout = REMOTE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      return resolve(null);
    }
    const mod = target.protocol === 'https:' ? https : http;
    let settled = false;
    const done = (v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };

    const attempt = (method, then) => {
      try {
        const req = mod.request(
          {
            protocol: target.protocol,
            host: target.hostname,
            port: target.port || undefined,
            path: target.pathname || '/',
            method,
            timeout,
            rejectUnauthorized: false,
            headers: { 'User-Agent': 'homelab-panel/health' },
          },
          (res) => {
            res.resume();
            // بعضی سرورها HEAD را قبول ندارند — همان را با GET دوباره می‌پرسیم
            if (res.statusCode === 405 && then) return then();
            done({ status: res.statusCode });
          }
        );
        req.on('timeout', () => {
          req.destroy();
          then ? then() : done(null);
        });
        req.on('error', () => (then ? then() : done(null)));
        req.end();
      } catch {
        then ? then() : done(null);
      }
    };

    attempt('HEAD', () => attempt('GET', null));
  });
}

/**
 * نتیجهٔ کش‌شدهٔ تستِ اینترنتی.
 *
 * مهم: فهرست سایت‌ها هرگز منتظر شبکه نمی‌ماند. اگر دامنه‌ای جواب ندهد یا اصلاً
 * وجود نداشته باشد، هر بررسی چند ثانیه طول می‌کشد و صفحه را کند می‌کند؛ برای
 * همین بررسی در پس‌زمینه انجام می‌شود و صفحه با آخرین نتیجهٔ موجود پر می‌شود.
 * چند ثانیه بعد (چرخهٔ بعدیِ بروزرسانی) وضعیت درست نشان داده می‌شود.
 * فقط جایی که صریحاً wait خواسته شود، منتظر می‌ماند.
 */
function remoteStatus(url, { wait }) {
  const cached = remoteCache.get(url);
  const fresh = cached && Date.now() - cached.at < REMOTE_TTL_MS;
  if (fresh) return Promise.resolve(cached);

  if (!cached?.pending) {
    const pending = headCheck(url).then((res) => {
      const value = { at: Date.now(), online: Boolean(res && res.status < 500), status: res?.status ?? null };
      remoteCache.set(url, value);
      return value;
    });
    pending.catch(() => {});
    remoteCache.set(url, { ...(cached || { at: 0, online: false, status: null }), pending });
    if (wait) return pending;
  }

  return Promise.resolve(cached || { at: 0, online: false, status: null });
}

export function forgetHealth(url) {
  if (url) remoteCache.delete(url);
  else remoteCache.clear();
}

/**
 * وضعیت واقعی یک سایت.
 * @param {{slug:string, port:number|null}} site
 * @param {{ urls?: string[], wait?: boolean }} options آدرس‌های عمومیِ سایت (دامنه، تونل، …)
 */
export async function checkSiteOnline(site, { urls = [], wait = false } = {}) {
  if (isRunning(site.slug) && site.port && (await probePort(site.port))) {
    return { online: true, via: 'process', httpStatus: null };
  }
  if (site.port && (await probePort(site.port))) {
    return { online: true, via: 'port', httpStatus: null };
  }

  // آدرس‌های عمومی با هم تست می‌شوند تا انتظار طولانی نشود
  const unique = [...new Set(urls.filter(Boolean))].slice(0, 3);
  const results = await Promise.all(unique.map((url) => remoteStatus(url, { wait }).then((r) => ({ url, ...r }))));
  const hit = results.find((r) => r?.online);
  if (hit) return { online: true, via: 'public', httpStatus: hit.status ?? null, url: hit.url };

  return { online: false, via: null, httpStatus: results[0]?.status ?? null };
}
