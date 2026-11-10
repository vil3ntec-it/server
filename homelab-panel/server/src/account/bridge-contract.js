// ---------------------------------------------------------------------------
//  S18 (۱.۵۰.۷۵): قراردادِ نسخه‌دارِ پل ⇄ درهای مدیرِ سرورِ حساب — «سازگار است؟» و «کدام درِ پل آن‌جا نیست؟»
//
//  سرورِ حسابی که `admin-contract.v1` را اعلام کرده ‎GET /api/admin/contract‎ دارد:
//    { version, routesHash, count, capabilities, routes: [{ method, path, superadmin }] }
//  و سرِ هر پاسخِ ‎/api/admin/*‎ ‎X-Admin-API-Version‎ (فقط با شکستنِ یک درِ موجود بالا می‌رود).
//
//  پل این‌جا:
//    • قرارداد را ده دقیقه نگه می‌دارد و سنجشِ «کدام نیست» را به **‎routesHash‎** می‌بندد (همان اثرِ انگشت ⇒ همان نتیجه)؛
//    • «فهرستِ سفید» ِ پل را از **سورسِ خودش** می‌خواند — هر ‎cloudRaw|cloudRawBytes|cloudRawText('METHOD', '/api/admin/…')‎،
//      جدولِ ‎ALLOWED‎ ِ ‎stations/cloud.js‎ و جفت‌های ‎['/محلی', '/api/admin/…']‎ ِ خواندنی‌ها؛ `${CONST}` ِ رشته‌ایِ همان
//      پرونده جایگزین و هر `${…}` ِ دیگر یک پارامتر می‌شود. مقصدی که از سورس خوانده نمی‌شود (مسیرِ متغیر) فقط **شمرده**
//      می‌شود (`unresolved`)، نه حدس؛
//    • ⇒ ‎{ apiVersion, compatible: version <= 1, routesHash, count, checked, unresolved, missing: [...] }‎.
//  ⛔ این گزارش است، نه قفل: پل با سرورِ ناسازگار هم کار می‌کند (هر در خطای خودش را می‌دهد)؛ رابط فقط می‌گوید.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BRIDGE_API_VERSION = 1;
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const METHODS = 'GET|POST|PUT|PATCH|DELETE';
const CONTRACT_TTL = 10 * 60_000;

function filesUnder(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) filesUnder(p, out);
    else if (e.isFile() && e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const norm = (p) => p.replace(/\$\{[^}]*\}/g, ':p').replace(/\?.*$/, '').replace(/\/+$/, '');

let scanned = null;
/** مقصدهای پل از سورسِ خودش — یک بار در هر پروسه. */
export function bridgeUpstream() {
  if (scanned) return scanned;
  const seen = new Map();
  let unresolved = 0;
  const add = (method, p) => {
    const n = norm(p);
    if (!/^\/api\/admin\/[A-Za-z0-9_\-/:.]+$/.test(n)) { unresolved++; return; }
    seen.set(`${method} ${n}`, { method, path: n });
  };
  for (const file of filesUnder(SRC)) {
    const src = fs.readFileSync(file, 'utf8');
    if (!/cloudRaw|ALLOWED/.test(src)) continue;
    const consts = new Map([...src.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*'(\/api\/admin\/[^']*)'/g)].map((m) => [m[1], m[2]]));
    const sub = (t) => t.replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (all, k) => consts.get(k) ?? all);
    for (const m of src.matchAll(new RegExp(`\\bcloudRaw(?:Bytes|Text)?\\(\\s*'(${METHODS})'\\s*,\\s*(?:'([^']*)'|\`([^\`]*)\`|([A-Za-z_$][\\w$.]*))`, 'g'))) {
      if (m[4]) { unresolved++; continue; }
      add(m[1], sub(m[2] ?? m[3]));
    }
    //  ‎ALLOWED‎ ِ ‎cloudCall‎ و جفت‌های «محلی ⇒ بالادست» ِ خواندنی‌ها (‎account-admin.js‎)
    for (const m of src.matchAll(new RegExp(`\\[\\s*'(${METHODS})'\\s*,\\s*'(\\/api\\/admin\\/[^']*)'\\s*\\]`, 'g'))) add(m[1], m[2]);
    for (const m of src.matchAll(/\[\s*'\/[a-z][^']*'\s*,\s*'(\/api\/admin\/[^']*)'\s*\]/g)) add('GET', m[1]);
  }
  scanned = { routes: [...seen.values()].sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`)), unresolved };
  return scanned;
}

/** هر تکهٔ «:x» در هر طرف با هر تکه‌ای جور است. */
function same(a, b) {
  const x = a.split('/');
  const y = b.split('/');
  return x.length === y.length && x.every((s, i) => s === y[i] || s.startsWith(':') || y[i].startsWith(':'));
}

export function missingFrom(contractRoutes, upstream = bridgeUpstream().routes) {
  const list = (Array.isArray(contractRoutes) ? contractRoutes : [])
    .filter((r) => r && typeof r.path === 'string' && typeof r.method === 'string')
    .map((r) => ({ method: r.method.toUpperCase(), path: norm(r.path) }));
  return upstream.filter((u) => !list.some((r) => r.method === u.method && same(r.path, u.path))).map((u) => `${u.method} ${u.path}`);
}

let cache = null;     // { at, routesHash, body }
const byHash = new Map();

/**
 * @param {string[]} caps      توانایی‌های همین لحظهٔ سرورِ حساب
 * @param {(path: string) => Promise<object>} get   همان ‎cloudRaw('GET', …)‎
 * @param {{ version: number } | null} seen          آخرین ‎X-Admin-API-Version‎ ِ دیده‌شده
 */
export async function contractStatus(caps, get, seen = null, { refresh = false } = {}) {
  if (!caps.includes('admin-contract.v1')) {
    return { available: false, reason: 'capability_missing', capability: 'admin-contract.v1', bridgeVersion: BRIDGE_API_VERSION,
      apiVersionSeen: seen?.version ?? null };
  }
  if (refresh || !cache || Date.now() - cache.at > CONTRACT_TTL) {
    const body = await get('/api/admin/contract');
    const routesHash = /^[A-Za-z0-9_-]{4,128}$/.test(String(body?.routesHash || '')) ? String(body.routesHash) : '';
    cache = { at: Date.now(), routesHash, body };
  }
  const { body, routesHash } = cache;
  const version = Number.isSafeInteger(Number(body?.version)) ? Number(body.version) : null;
  let missing = routesHash ? byHash.get(routesHash) : null;
  if (!missing) {
    missing = missingFrom(body?.routes);
    if (routesHash) { byHash.clear(); byHash.set(routesHash, missing); }
  }
  const up = bridgeUpstream();
  return {
    available: true, fetchedAt: cache.at, bridgeVersion: BRIDGE_API_VERSION,
    apiVersion: version, apiVersionSeen: seen?.version ?? null,
    compatible: version !== null && version <= BRIDGE_API_VERSION,
    routesHash: routesHash || null, count: Array.isArray(body?.routes) ? body.routes.length : null,
    serverVersion: /^[0-9A-Za-z.+-]{1,40}$/.test(String(body?.serverVersion || '')) ? String(body.serverVersion) : null,
    checked: up.routes.length, unresolved: up.unresolved, missing: missing.slice(0, 300),
  };
}

/** برای آزمون. */
export function contractReset() { cache = null; byHash.clear(); }
